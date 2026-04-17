"""
DNS Updater Lambda.

Triggered by EventBridge on ECS Task State Change events.

For non-HTTPS games (direct connection):
  - RUNNING → resolve ENI public IP → upsert Route 53 A record
  - STOPPED → delete Route 53 A record

For HTTPS games (ALB-fronted):
  - RUNNING → resolve ENI private IP → register with ALB target group
  - STOPPED → deregister from ALB target group
  (DNS for HTTPS games is a static alias to the ALB, managed by Terraform)

Game name is derived from the task's group field ("family:{game}-server").
"""

import json
import os
import time
import logging

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

HOSTED_ZONE_ID = os.environ["HOSTED_ZONE_ID"]
DOMAIN_NAME    = os.environ["DOMAIN_NAME"]       # e.g. "codercoco.com"
GAME_NAMES     = os.environ.get("GAME_NAMES", "").split(",")
DNS_TTL        = int(os.environ.get("DNS_TTL", "30"))
AWS_REGION     = os.environ.get("AWS_REGION_", "us-east-1")

# HTTPS / ALB support
HTTPS_GAMES       = set(filter(None, os.environ.get("HTTPS_GAMES", "").split(",")))
ALB_TARGET_GROUPS = json.loads(os.environ.get("ALB_TARGET_GROUPS", "{}"))

# Map task family → game name  e.g. "palworld-server" → "palworld"
FAMILY_TO_GAME = {f"{g}-server": g for g in GAME_NAMES if g}

ec2     = boto3.client("ec2",                          region_name=AWS_REGION)
ecs     = boto3.client("ecs",                          region_name=AWS_REGION)
elbv2   = boto3.client("elbv2",                        region_name=AWS_REGION)
route53 = boto3.client("route53")


def handler(event, context):
    logger.info("DNS updater triggered: %s", event)

    detail      = event.get("detail", {})
    last_status = detail.get("lastStatus", "")
    task_arn    = detail.get("taskArn", "")
    cluster_arn = detail.get("clusterArn", "")

    # Derive the game name from the task group
    group  = detail.get("group", "")
    family = group.replace("family:", "")
    game   = FAMILY_TO_GAME.get(family)

    if not game:
        logger.info("Task family %s is not a known game server — skipping.", family)
        return {"status": "skipped", "reason": f"unknown family: {family}"}

    dns_name = f"{game}.{DOMAIN_NAME}"
    is_https = game in HTTPS_GAMES
    logger.info("Game: %s | DNS: %s | Status: %s | HTTPS: %s",
                game, dns_name, last_status, is_https)

    if is_https:
        return _handle_https_game(game, task_arn, cluster_arn, last_status)
    else:
        return _handle_direct_game(game, dns_name, task_arn, cluster_arn, last_status)


# ── Direct (non-HTTPS) game handler ──────────────────────────────────────────

def _handle_direct_game(game, dns_name, task_arn, cluster_arn, last_status):
    if last_status == "RUNNING":
        public_ip = _resolve_public_ip(task_arn, cluster_arn)
        if public_ip:
            _upsert_dns(dns_name, public_ip)
            return {"status": "upserted", "game": game, "ip": public_ip}
        else:
            logger.warning("Could not resolve public IP for %s", task_arn)
            return {"status": "error", "reason": "no_ip"}

    elif last_status == "STOPPED":
        _delete_dns(dns_name)
        return {"status": "deleted", "game": game}

    return {"status": "no_action", "lastStatus": last_status}


# ── HTTPS (ALB-fronted) game handler ────────────────────────────────────────

def _handle_https_game(game, task_arn, cluster_arn, last_status):
    tg_arn = ALB_TARGET_GROUPS.get(game)
    if not tg_arn:
        logger.error("No ALB target group configured for HTTPS game %s", game)
        return {"status": "error", "reason": "no_target_group"}

    if last_status == "RUNNING":
        private_ip = _resolve_private_ip(task_arn, cluster_arn)
        if private_ip:
            _register_alb_target(tg_arn, private_ip)
            return {"status": "registered", "game": game, "ip": private_ip}
        else:
            logger.warning("Could not resolve private IP for %s", task_arn)
            return {"status": "error", "reason": "no_ip"}

    elif last_status == "STOPPED":
        private_ip = _resolve_private_ip(task_arn, cluster_arn)
        if private_ip:
            _deregister_alb_target(tg_arn, private_ip)
        return {"status": "deregistered", "game": game}

    return {"status": "no_action", "lastStatus": last_status}


# ── ALB target helpers ───────────────────────────────────────────────────────

def _register_alb_target(target_group_arn: str, ip: str):
    logger.info("Registering target %s with %s", ip, target_group_arn)
    elbv2.register_targets(
        TargetGroupArn=target_group_arn,
        Targets=[{"Id": ip}],
    )


def _deregister_alb_target(target_group_arn: str, ip: str):
    logger.info("Deregistering target %s from %s", ip, target_group_arn)
    try:
        elbv2.deregister_targets(
            TargetGroupArn=target_group_arn,
            Targets=[{"Id": ip}],
        )
    except Exception as e:
        logger.warning("Could not deregister target %s: %s", ip, e)


# ── IP resolution ─────────────────────────────────────────────────────────────

def _resolve_public_ip(task_arn: str, cluster_arn: str) -> str | None:
    """Retry a few times since ENI association can lag behind the RUNNING event."""
    for attempt in range(5):
        try:
            resp  = ecs.describe_tasks(cluster=cluster_arn, tasks=[task_arn])
            tasks = resp.get("tasks", [])
            if not tasks:
                logger.warning("No task details returned (attempt %d)", attempt + 1)
                time.sleep(3)
                continue

            eni_id = _extract_eni_id(tasks[0])
            if not eni_id:
                logger.info("ENI not yet attached (attempt %d)", attempt + 1)
                time.sleep(3)
                continue

            ip = _get_eni_public_ip(eni_id)
            if ip:
                logger.info("Resolved IP: %s via ENI %s", ip, eni_id)
                return ip
        except Exception as e:
            logger.error("IP resolution error on attempt %d: %s", attempt + 1, e)
        time.sleep(3)

    return None


def _resolve_private_ip(task_arn: str, cluster_arn: str) -> str | None:
    """Resolve the private IP of a task's ENI (used for ALB target registration)."""
    for attempt in range(5):
        try:
            resp  = ecs.describe_tasks(cluster=cluster_arn, tasks=[task_arn])
            tasks = resp.get("tasks", [])
            if not tasks:
                logger.warning("No task details returned (attempt %d)", attempt + 1)
                time.sleep(3)
                continue

            eni_id = _extract_eni_id(tasks[0])
            if not eni_id:
                logger.info("ENI not yet attached (attempt %d)", attempt + 1)
                time.sleep(3)
                continue

            ip = _get_eni_private_ip(eni_id)
            if ip:
                logger.info("Resolved private IP: %s via ENI %s", ip, eni_id)
                return ip
        except Exception as e:
            logger.error("Private IP resolution error on attempt %d: %s", attempt + 1, e)
        time.sleep(3)

    return None


def _extract_eni_id(task: dict) -> str | None:
    for attachment in task.get("attachments", []):
        if attachment.get("type") != "ElasticNetworkInterface":
            continue
        for detail in attachment.get("details", []):
            if detail.get("name") == "networkInterfaceId":
                return detail["value"]
    return None


def _get_eni_public_ip(eni_id: str) -> str | None:
    resp   = ec2.describe_network_interfaces(NetworkInterfaceIds=[eni_id])
    ifaces = resp.get("NetworkInterfaces", [])
    if not ifaces:
        return None
    return ifaces[0].get("Association", {}).get("PublicIp")


def _get_eni_private_ip(eni_id: str) -> str | None:
    resp   = ec2.describe_network_interfaces(NetworkInterfaceIds=[eni_id])
    ifaces = resp.get("NetworkInterfaces", [])
    if not ifaces:
        return None
    return ifaces[0].get("PrivateIpAddress")


# ── Route 53 helpers ──────────────────────────────────────────────────────────

def _upsert_dns(dns_name: str, ip: str):
    logger.info("Upserting %s → %s (TTL %s)", dns_name, ip, DNS_TTL)
    _change_record(dns_name, "UPSERT", [{"Value": ip}])


def _delete_dns(dns_name: str):
    current_ip = _current_record_ip(dns_name)
    if not current_ip:
        logger.info("No DNS record exists for %s — nothing to delete.", dns_name)
        return
    logger.info("Deleting %s (was %s)", dns_name, current_ip)
    try:
        _change_record(dns_name, "DELETE", [{"Value": current_ip}])
    except Exception as e:
        logger.warning("Could not delete DNS record for %s: %s", dns_name, e)


def _current_record_ip(dns_name: str) -> str | None:
    try:
        resp = route53.list_resource_record_sets(
            HostedZoneId=HOSTED_ZONE_ID,
            StartRecordName=dns_name,
            StartRecordType="A",
            MaxItems="1",
        )
        for rrs in resp.get("ResourceRecordSets", []):
            if rrs["Name"].rstrip(".") == dns_name.rstrip(".") and rrs["Type"] == "A":
                records = rrs.get("ResourceRecords", [])
                return records[0]["Value"] if records else None
    except Exception as e:
        logger.warning("Could not look up current record for %s: %s", dns_name, e)
    return None


def _change_record(dns_name: str, action: str, resource_records: list):
    resp = route53.change_resource_record_sets(
        HostedZoneId=HOSTED_ZONE_ID,
        ChangeBatch={
            "Comment": f"Game server auto-{action.lower()} for {dns_name}",
            "Changes": [{
                "Action": action,
                "ResourceRecordSet": {
                    "Name": dns_name,
                    "Type": "A",
                    "TTL": DNS_TTL,
                    "ResourceRecords": resource_records,
                },
            }],
        },
    )
    logger.info("Route 53 change: %s (status: %s)",
                resp["ChangeInfo"]["Id"], resp["ChangeInfo"]["Status"])
