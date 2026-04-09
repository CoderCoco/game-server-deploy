"""
Auto-shutdown watchdog.

Runs on a schedule (every 15 minutes via EventBridge). For each running
game server, checks if any players are connected by inspecting network
activity on the task's ENI. If no connections are found for longer than
the idle threshold, stops the task and cleans up DNS.

Player detection strategy:
  - Checks the ENI's inbound packet count via CloudWatch metrics
  - If packets received in the last check interval are below a threshold,
    increments an idle counter stored as a task tag
  - If idle counter exceeds the configured number of checks, shuts down

This is a heuristic — some games maintain keepalive traffic even with
no real players. Adjust IDLE_CHECKS_BEFORE_SHUTDOWN and
MIN_PACKETS_PER_INTERVAL for your games.
"""

import json
import os
import time
from datetime import datetime, timedelta, timezone
import boto3

ECS_CLUSTER = os.environ["ECS_CLUSTER"]
HOSTED_ZONE_ID = os.environ.get("HOSTED_ZONE_ID", "")
DOMAIN_NAME = os.environ.get("DOMAIN_NAME", "")

# How many consecutive idle checks before we shut down
IDLE_CHECKS_BEFORE_SHUTDOWN = int(os.environ.get("IDLE_CHECKS", "4"))

# Minimum packets in the check interval to consider "active"
MIN_PACKETS_PER_INTERVAL = int(os.environ.get("MIN_PACKETS", "100"))

# How far back to look for network activity (should match EventBridge interval)
CHECK_WINDOW_MINUTES = int(os.environ.get("CHECK_WINDOW_MINUTES", "15"))

GAME_SERVERS = {
    "palworld":     os.environ.get("TASK_DEF_PALWORLD",     "palworld-server"),
    "satisfactory": os.environ.get("TASK_DEF_SATISFACTORY", "satisfactory-server"),
}

# Reverse lookup: task family → game name
FAMILY_TO_GAME = {v: k for k, v in GAME_SERVERS.items()}

ecs = boto3.client("ecs")
ec2 = boto3.client("ec2")
cloudwatch = boto3.client("cloudwatch")
route53 = boto3.client("route53")


def get_eni_id(task: dict) -> str | None:
    for attachment in task.get("attachments", []):
        if attachment["type"] == "ElasticNetworkInterface":
            for detail in attachment["details"]:
                if detail["name"] == "networkInterfaceId":
                    return detail["value"]
    return None


def get_network_activity(eni_id: str) -> int:
    """Check inbound packet count on the ENI via CloudWatch metrics.

    Uses CHECK_WINDOW_MINUTES as the lookback period.
    Falls back to assuming active if metrics aren't available.
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
        if resp["Datapoints"]:
            return int(resp["Datapoints"][0]["Sum"])
    except Exception as e:
        print(f"CloudWatch query failed for {eni_id}: {e}")

    # Fallback: if we can't check metrics, assume active to be safe
    return MIN_PACKETS_PER_INTERVAL + 1


def get_idle_count(task_arn: str) -> int:
    """Get the current idle counter from task tags."""
    try:
        resp = ecs.list_tags_for_resource(resourceArn=task_arn)
        for tag in resp.get("tags", []):
            if tag["key"] == "idle_checks":
                return int(tag["value"])
    except Exception:
        pass
    return 0


def set_idle_count(task_arn: str, count: int):
    """Update the idle counter tag on the task."""
    try:
        ecs.tag_resource(
            resourceArn=task_arn,
            tags=[{"key": "idle_checks", "value": str(count)}],
        )
    except Exception as e:
        print(f"Failed to tag task {task_arn}: {e}")


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


def lambda_handler(event, context):
    """Check all running game servers and shut down idle ones."""
    # Find all running tasks in the cluster
    task_arns = []
    paginator = ecs.get_paginator("list_tasks")
    for page in paginator.paginate(cluster=ECS_CLUSTER, desiredStatus="RUNNING"):
        task_arns.extend(page["taskArns"])

    if not task_arns:
        print("No running tasks found.")
        return

    tasks = ecs.describe_tasks(cluster=ECS_CLUSTER, tasks=task_arns)["tasks"]

    for task in tasks:
        task_arn = task["taskArn"]
        family = task["group"].replace("family:", "")
        game = FAMILY_TO_GAME.get(family)

        if not game:
            print(f"Skipping unknown task family: {family}")
            continue

        if task["lastStatus"] != "RUNNING":
            continue

        eni_id = get_eni_id(task)
        if not eni_id:
            print(f"No ENI found for {game}, skipping.")
            continue

        packets = get_network_activity(eni_id)
        idle_count = get_idle_count(task_arn)

        if packets < MIN_PACKETS_PER_INTERVAL:
            idle_count += 1
            print(f"{game}: idle check {idle_count}/{IDLE_CHECKS_BEFORE_SHUTDOWN} "
                  f"(packets={packets})")

            if idle_count >= IDLE_CHECKS_BEFORE_SHUTDOWN:
                print(f"{game}: shutting down after {idle_count} idle checks.")
                delete_dns(game)
                ecs.stop_task(
                    cluster=ECS_CLUSTER,
                    task=task_arn,
                    reason=f"Auto-shutdown: idle for {idle_count * CHECK_WINDOW_MINUTES} minutes",
                )
            else:
                set_idle_count(task_arn, idle_count)
        else:
            # Active — reset the counter
            if idle_count > 0:
                print(f"{game}: activity detected, resetting idle counter (packets={packets})")
                set_idle_count(task_arn, 0)
            else:
                print(f"{game}: active (packets={packets})")
