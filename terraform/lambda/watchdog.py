"""
Game Server Watchdog Lambda.

Runs on a schedule (EventBridge). For each running game server task:
  - Checks CloudWatch NetworkPacketsIn on the task's ENI
  - If packets < MIN_PACKETS → increments idle counter (stored as ECS task tag)
  - After IDLE_CHECKS consecutive idle checks → stops the task + removes DNS
  - If active → resets idle counter

Total idle grace period = CHECK_WINDOW_MINUTES × IDLE_CHECKS
Default: 15 × 4 = 60 minutes
"""

import os
from datetime import datetime, timedelta, timezone

import boto3

ECS_CLUSTER           = os.environ["ECS_CLUSTER"]
HOSTED_ZONE_ID        = os.environ.get("HOSTED_ZONE_ID", "")
DOMAIN_NAME           = os.environ.get("DOMAIN_NAME", "")
GAME_NAMES            = os.environ.get("GAME_NAMES", "").split(",")
IDLE_CHECKS           = int(os.environ.get("IDLE_CHECKS", "4"))
MIN_PACKETS           = int(os.environ.get("MIN_PACKETS", "100"))
CHECK_WINDOW_MINUTES  = int(os.environ.get("CHECK_WINDOW_MINUTES", "15"))
AWS_REGION            = os.environ.get("AWS_REGION_", "us-east-1")

# Reverse-lookup: task family → game name
# Task families are named "{game}-server" (e.g. "palworld-server")
FAMILY_TO_GAME = {f"{g}-server": g for g in GAME_NAMES if g}

ecs        = boto3.client("ecs",        region_name=AWS_REGION)
ec2        = boto3.client("ec2",        region_name=AWS_REGION)
cloudwatch = boto3.client("cloudwatch", region_name=AWS_REGION)
route53    = boto3.client("route53")


# ── ENI helpers ───────────────────────────────────────────────────────────────

def get_eni_id(task: dict) -> str | None:
    for attachment in task.get("attachments", []):
        if attachment.get("type") == "ElasticNetworkInterface":
            for detail in attachment.get("details", []):
                if detail["name"] == "networkInterfaceId":
                    return detail["value"]
    return None


def get_network_packets(eni_id: str) -> int:
    """
    Query CloudWatch for inbound packets on this ENI over the last check window.
    Falls back to MIN_PACKETS + 1 (i.e. "assume active") if metrics are unavailable —
    this is the safe default to avoid accidental shutdowns.
    """
    now = datetime.now(timezone.utc)
    try:
        resp = cloudwatch.get_metric_statistics(
            Namespace="AWS/EC2",
            MetricName="NetworkPacketsIn",
            Dimensions=[{"Name": "NetworkInterfaceId", "Value": eni_id}],
            StartTime=now - timedelta(minutes=CHECK_WINDOW_MINUTES),
            EndTime=now,
            Period=CHECK_WINDOW_MINUTES * 60,
            Statistics=["Sum"],
        )
        datapoints = resp.get("Datapoints", [])
        if datapoints:
            return int(datapoints[0]["Sum"])
        # No datapoints yet (new ENI) — assume active
        print(f"  No CloudWatch datapoints for ENI {eni_id} — assuming active")
        return MIN_PACKETS + 1
    except Exception as e:
        print(f"  CloudWatch query failed for {eni_id}: {e} — assuming active")
        return MIN_PACKETS + 1


# ── Idle counter via ECS task tags ────────────────────────────────────────────

def get_idle_count(task_arn: str) -> int:
    try:
        resp = ecs.list_tags_for_resource(resourceArn=task_arn)
        for tag in resp.get("tags", []):
            if tag["key"] == "idle_checks":
                return int(tag["value"])
    except Exception:
        pass
    return 0


def set_idle_count(task_arn: str, count: int):
    try:
        ecs.tag_resource(
            resourceArn=task_arn,
            tags=[{"key": "idle_checks", "value": str(count)}],
        )
    except Exception as e:
        print(f"  Failed to set idle_checks tag on {task_arn}: {e}")


# ── DNS cleanup ───────────────────────────────────────────────────────────────

def delete_dns(game: str):
    if not HOSTED_ZONE_ID or not DOMAIN_NAME:
        return
    dns_name = f"{game}.{DOMAIN_NAME}"
    try:
        resp = route53.list_resource_record_sets(
            HostedZoneId=HOSTED_ZONE_ID,
            StartRecordName=dns_name,
            StartRecordType="A",
            MaxItems="1",
        )
        for rrs in resp.get("ResourceRecordSets", []):
            if rrs["Name"].rstrip(".") == dns_name and rrs["Type"] == "A":
                route53.change_resource_record_sets(
                    HostedZoneId=HOSTED_ZONE_ID,
                    ChangeBatch={
                        "Comment": f"Watchdog auto-shutdown: {game}",
                        "Changes": [{"Action": "DELETE", "ResourceRecordSet": rrs}],
                    },
                )
                print(f"  Deleted DNS record: {dns_name}")
                return
        print(f"  No DNS record found for {dns_name}")
    except Exception as e:
        print(f"  DNS cleanup failed for {game}: {e}")


# ── Main handler ──────────────────────────────────────────────────────────────

def handler(event, context):
    print(f"Watchdog running — cluster: {ECS_CLUSTER}, games: {GAME_NAMES}")

    # Collect all running task ARNs
    task_arns = []
    paginator = ecs.get_paginator("list_tasks")
    for page in paginator.paginate(cluster=ECS_CLUSTER, desiredStatus="RUNNING"):
        task_arns.extend(page["taskArns"])

    if not task_arns:
        print("No running tasks — nothing to check.")
        return {"checked": 0}

    tasks = ecs.describe_tasks(cluster=ECS_CLUSTER, tasks=task_arns)["tasks"]
    checked = 0

    for task in tasks:
        task_arn   = task["taskArn"]
        last_status = task.get("lastStatus", "")

        if last_status != "RUNNING":
            continue

        # Derive game name from task group ("family:palworld-server" → "palworld")
        group  = task.get("group", "")
        family = group.replace("family:", "")
        game   = FAMILY_TO_GAME.get(family)

        if not game:
            print(f"Skipping unknown task family: {family}")
            continue

        checked += 1
        eni_id = get_eni_id(task)
        if not eni_id:
            print(f"{game}: no ENI found, skipping.")
            continue

        packets    = get_network_packets(eni_id)
        idle_count = get_idle_count(task_arn)

        if packets < MIN_PACKETS:
            idle_count += 1
            print(f"{game}: idle check {idle_count}/{IDLE_CHECKS} "
                  f"(packets={packets}, threshold={MIN_PACKETS})")

            if idle_count >= IDLE_CHECKS:
                print(f"{game}: shutting down after {idle_count} idle checks "
                      f"({idle_count * CHECK_WINDOW_MINUTES} minutes idle).")
                delete_dns(game)
                ecs.stop_task(
                    cluster=ECS_CLUSTER,
                    task=task_arn,
                    reason=f"Watchdog: idle for {idle_count * CHECK_WINDOW_MINUTES} minutes",
                )
            else:
                set_idle_count(task_arn, idle_count)
        else:
            # Active — reset counter if it was non-zero
            if idle_count > 0:
                print(f"{game}: activity detected (packets={packets}), resetting idle counter.")
                set_idle_count(task_arn, 0)
            else:
                print(f"{game}: active (packets={packets}).")

    return {"checked": checked}
