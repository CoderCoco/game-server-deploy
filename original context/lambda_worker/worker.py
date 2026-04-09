"""
Async worker Lambda for slow game server operations.

Invoked asynchronously by the webhook handler. Performs the ECS
start/stop, waits for IP assignment, updates DNS, and sends the
result back to Discord via the interaction follow-up webhook.
"""

import json
import os
import time
import boto3
import urllib.request

# --- Config ---
ECS_CLUSTER = os.environ["ECS_CLUSTER"]
SUBNETS = os.environ["SUBNETS"].split(",")
SECURITY_GROUP = os.environ["SECURITY_GROUP"]
HOSTED_ZONE_ID = os.environ.get("HOSTED_ZONE_ID", "")
DOMAIN_NAME = os.environ.get("DOMAIN_NAME", "")

STARTUP_TIMEOUT = int(os.environ.get("STARTUP_TIMEOUT", "120"))
POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL", "5"))

GAME_SERVERS = {
    "palworld":     os.environ.get("TASK_DEF_PALWORLD",     "palworld-server"),
    "satisfactory": os.environ.get("TASK_DEF_SATISFACTORY", "satisfactory-server"),
}

ecs = boto3.client("ecs")
ec2 = boto3.client("ec2")
route53 = boto3.client("route53")


# ── Discord follow-up ──────────────────────────────────────────────────────

def send_followup(app_id: str, token: str, message: str):
    """Send a follow-up message to Discord after a deferred response."""
    url = f"https://discord.com/api/v10/webhooks/{app_id}/{token}"
    data = json.dumps({"content": message}).encode("utf-8")
    req = urllib.request.Request(
        url, data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        urllib.request.urlopen(req)
    except Exception as e:
        print(f"Failed to send Discord follow-up: {e}")


# ── ECS helpers ─────────────────────────────────────────────────────────────

def find_running_task(game: str) -> dict | None:
    task_def = GAME_SERVERS[game]
    resp = ecs.list_tasks(
        cluster=ECS_CLUSTER, family=task_def, desiredStatus="RUNNING"
    )
    if resp["taskArns"]:
        tasks = ecs.describe_tasks(cluster=ECS_CLUSTER, tasks=resp["taskArns"])
        for t in tasks["tasks"]:
            if t["lastStatus"] not in ("STOPPED", "DEPROVISIONING"):
                return t
    return None


def get_task_public_ip(task: dict) -> str | None:
    for attachment in task.get("attachments", []):
        if attachment["type"] == "ElasticNetworkInterface":
            for detail in attachment["details"]:
                if detail["name"] == "networkInterfaceId":
                    eni = ec2.describe_network_interfaces(
                        NetworkInterfaceIds=[detail["value"]]
                    )["NetworkInterfaces"][0]
                    return eni.get("Association", {}).get("PublicIp")
    return None


def wait_for_running(task_arn: str, timeout: int = None, poll_interval: int = None) -> dict | None:
    """Poll until the task is RUNNING with a public IP, or timeout."""
    timeout = timeout or STARTUP_TIMEOUT
    poll_interval = poll_interval or POLL_INTERVAL
    start = time.time()
    while time.time() - start < timeout:
        resp = ecs.describe_tasks(cluster=ECS_CLUSTER, tasks=[task_arn])
        if not resp["tasks"]:
            return None
        task = resp["tasks"][0]
        if task["lastStatus"] == "RUNNING":
            ip = get_task_public_ip(task)
            if ip:
                return task
        elif task["lastStatus"] == "STOPPED":
            return None
        time.sleep(poll_interval)
    return None


# ── DNS helpers ─────────────────────────────────────────────────────────────

def upsert_dns(game: str, ip: str):
    if not HOSTED_ZONE_ID or not DOMAIN_NAME:
        return
    route53.change_resource_record_sets(
        HostedZoneId=HOSTED_ZONE_ID,
        ChangeBatch={
            "Changes": [{
                "Action": "UPSERT",
                "ResourceRecordSet": {
                    "Name": f"{game}.{DOMAIN_NAME}",
                    "Type": "A",
                    "TTL": 60,
                    "ResourceRecords": [{"Value": ip}],
                },
            }]
        },
    )


def delete_dns(game: str):
    if not HOSTED_ZONE_ID or not DOMAIN_NAME:
        return
    try:
        resp = route53.list_resource_record_sets(
            HostedZoneId=HOSTED_ZONE_ID,
            StartRecordName=f"{game}.{DOMAIN_NAME}",
            StartRecordType="A",
            MaxItems="1",
        )
        for rr in resp["ResourceRecordSets"]:
            if rr["Name"].rstrip(".") == f"{game}.{DOMAIN_NAME}" and rr["Type"] == "A":
                route53.change_resource_record_sets(
                    HostedZoneId=HOSTED_ZONE_ID,
                    ChangeBatch={"Changes": [{"Action": "DELETE", "ResourceRecordSet": rr}]},
                )
    except Exception:
        pass


def get_connect_address(game: str, ip: str | None) -> str:
    if DOMAIN_NAME:
        return f"{game}.{DOMAIN_NAME}"
    return ip or "unknown"


# ── Command handlers ────────────────────────────────────────────────────────

def handle_start(game: str) -> str:
    # Check if already running
    existing = find_running_task(game)
    if existing:
        ip = get_task_public_ip(existing)
        if ip:
            upsert_dns(game, ip)
            return f"**{game}** is already running! Connect to: `{get_connect_address(game, ip)}`"
        return f"**{game}** is already starting up. Give it a moment."

    # Launch the task
    task_def = GAME_SERVERS[game]
    resp = ecs.run_task(
        cluster=ECS_CLUSTER,
        taskDefinition=task_def,
        count=1,
        launchType="FARGATE",
        networkConfiguration={
            "awsvpcConfiguration": {
                "subnets": SUBNETS,
                "securityGroups": [SECURITY_GROUP],
                "assignPublicIp": "ENABLED",
            }
        },
    )

    if not resp.get("tasks"):
        failures = resp.get("failures", [])
        reason = failures[0]["reason"] if failures else "unknown"
        return f"Failed to start **{game}**: {reason}"

    task_arn = resp["tasks"][0]["taskArn"]

    # Wait for it to be RUNNING with an IP
    task = wait_for_running(task_arn, timeout=120)
    if not task:
        return (
            f"**{game}** is taking longer than expected to start. "
            f"Use `/status {game}` to check on it."
        )

    ip = get_task_public_ip(task)
    if ip:
        upsert_dns(game, ip)

    addr = get_connect_address(game, ip)
    return f"**{game}** is now **online**! Connect to: `{addr}`"


def handle_stop(game: str) -> str:
    task = find_running_task(game)
    if not task:
        return f"**{game}** is not currently running."

    delete_dns(game)
    ecs.stop_task(
        cluster=ECS_CLUSTER,
        task=task["taskArn"],
        reason="Stopped via Discord bot",
    )
    return f"**{game}** is shutting down. DNS record removed. Saves are persisted on EFS."


# ── Lambda handler ──────────────────────────────────────────────────────────

def lambda_handler(event, context):
    command = event["command"]
    game = event["game"]
    token = event["interaction_token"]
    app_id = event["app_id"]

    try:
        if command == "start":
            msg = handle_start(game)
        elif command == "stop":
            msg = handle_stop(game)
        else:
            msg = "Unknown command."
    except Exception as e:
        msg = f"Something went wrong with **{game}**: {str(e)}"
        print(f"Error handling {command} {game}: {e}")

    send_followup(app_id, token, msg)
