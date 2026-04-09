"""
Discord Interactions Webhook handler.

Fast-path: validates Discord signature, responds immediately for simple
commands (status), and defers slow commands (start/stop) to the worker
Lambda for async follow-up.

Deployed behind API Gateway.
"""

import json
import os
import boto3
from nacl.signing import VerifyKey
from nacl.exceptions import BadSignatureError

# --- Config ---
DISCORD_PUBLIC_KEY = os.environ["DISCORD_PUBLIC_KEY"]
WORKER_FUNCTION_NAME = os.environ["WORKER_FUNCTION_NAME"]
ECS_CLUSTER = os.environ["ECS_CLUSTER"]

GAME_SERVERS = {
    "palworld":     os.environ.get("TASK_DEF_PALWORLD",     "palworld-server"),
    "satisfactory": os.environ.get("TASK_DEF_SATISFACTORY", "satisfactory-server"),
}

lambda_client = boto3.client("lambda")
ecs = boto3.client("ecs")


def verify_signature(event):
    """Verify the request actually came from Discord."""
    signature = event["headers"].get("x-signature-ed25519", "")
    timestamp = event["headers"].get("x-signature-timestamp", "")
    body = event.get("body", "")

    verify_key = VerifyKey(bytes.fromhex(DISCORD_PUBLIC_KEY))
    try:
        verify_key.verify(f"{timestamp}{body}".encode(), bytes.fromhex(signature))
        return True
    except (BadSignatureError, Exception):
        return False


# ── Quick helpers for status (fast enough to respond inline) ────────────────

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
    ec2 = boto3.client("ec2")
    for attachment in task.get("attachments", []):
        if attachment["type"] == "ElasticNetworkInterface":
            for detail in attachment["details"]:
                if detail["name"] == "networkInterfaceId":
                    eni = ec2.describe_network_interfaces(
                        NetworkInterfaceIds=[detail["value"]]
                    )["NetworkInterfaces"][0]
                    return eni.get("Association", {}).get("PublicIp")
    return None


def get_connect_address(game: str, ip: str | None) -> str:
    domain = os.environ.get("DOMAIN_NAME", "")
    if domain:
        return f"{game}.{domain}"
    return ip or "unknown"


def server_status(game: str) -> str:
    task = find_running_task(game)
    if not task:
        return f"**{game}** is offline. Use `/start {game}` to boot it up."
    status = task["lastStatus"]
    if status == "RUNNING":
        ip = get_task_public_ip(task)
        if ip:
            return f"**{game}** is **online** — connect to: `{get_connect_address(game, ip)}`"
        return f"**{game}** is running but IP isn't assigned yet. Try again shortly."
    return f"**{game}** is currently **{status.lower()}**. Give it a moment."


def list_servers() -> str:
    lines = ["**Available game servers:**\n"]
    for game in GAME_SERVERS:
        task = find_running_task(game)
        if task and task["lastStatus"] == "RUNNING":
            ip = get_task_public_ip(task) or "starting..."
            lines.append(f"• **{game}**: online (`{get_connect_address(game, ip)}`)")
        else:
            lines.append(f"• **{game}**: offline")
    return "\n".join(lines)


# ── Lambda handler ──────────────────────────────────────────────────────────

def lambda_handler(event, context):
    if not verify_signature(event):
        return {"statusCode": 401, "body": "Invalid signature"}

    body = json.loads(event["body"])

    # Discord PING — required for webhook registration
    if body.get("type") == 1:
        return {"statusCode": 200, "body": json.dumps({"type": 1})}

    # Slash command
    if body.get("type") == 2:
        data = body["data"]
        command = data["name"]
        options = {o["name"]: o["value"] for o in data.get("options", [])}
        game = options.get("game", "").lower()
        interaction_token = body["token"]
        app_id = body["application_id"]

        # ── Fast path: /status responds immediately ──
        if command == "status":
            if game:
                if game not in GAME_SERVERS:
                    msg = f"Unknown game `{game}`."
                else:
                    msg = server_status(game)
            else:
                msg = list_servers()

            return {
                "statusCode": 200,
                "body": json.dumps({"type": 4, "data": {"content": msg}}),
            }

        # ── Slow path: /start and /stop are deferred ──
        if command in ("start", "stop"):
            if game not in GAME_SERVERS:
                return {
                    "statusCode": 200,
                    "body": json.dumps({
                        "type": 4,
                        "data": {"content": f"Unknown game `{game}`. Available: {', '.join(GAME_SERVERS)}"},
                    }),
                }

            # Fire off the worker Lambda asynchronously
            lambda_client.invoke(
                FunctionName=WORKER_FUNCTION_NAME,
                InvocationType="Event",  # async — don't wait for response
                Payload=json.dumps({
                    "command": command,
                    "game": game,
                    "interaction_token": interaction_token,
                    "app_id": app_id,
                }),
            )

            # Respond to Discord with type 5 = DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
            # Shows a "thinking..." indicator in the channel
            return {
                "statusCode": 200,
                "body": json.dumps({"type": 5}),
            }

        return {
            "statusCode": 200,
            "body": json.dumps({"type": 4, "data": {"content": "Unknown command."}}),
        }

    return {"statusCode": 400, "body": "Unhandled interaction type"}
