"""
Palworld / Game Server Manager — AWS backend logic.

Uses ecs.run_task() / ecs.stop_task() directly (no persistent ECS Service).
Supports multiple game servers defined in the Terraform game_servers variable.
"""

import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import boto3
from botocore.exceptions import ClientError

TERRAFORM_DIR = Path(__file__).parent.parent / "terraform"
CONFIG_FILE   = Path(__file__).parent / "server_config.json"

DEFAULT_CONFIG = {
    "watchdog_interval_minutes": 15,
    "watchdog_idle_checks": 4,
    "watchdog_min_packets": 100,
}

# ── Terraform outputs cache ───────────────────────────────────────────────────

_tf_outputs: dict | None = None


def invalidate_tf_cache():
    global _tf_outputs
    _tf_outputs = None


def get_tf_outputs() -> dict:
    global _tf_outputs
    if _tf_outputs is not None:
        return _tf_outputs

    state_path = TERRAFORM_DIR / "terraform.tfstate"
    if not state_path.exists():
        return {}

    with open(state_path) as f:
        state = json.load(f)

    outputs = {}
    for key, val in state.get("outputs", {}).items():
        outputs[key] = val.get("value")

    _tf_outputs = outputs
    return outputs


def is_deployed() -> bool:
    return bool(get_tf_outputs())


def get_game_names() -> list[str]:
    outputs = get_tf_outputs()
    names = outputs.get("game_names", [])
    if isinstance(names, list):
        return names
    return []


# ── Config ────────────────────────────────────────────────────────────────────

def get_config() -> dict:
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE) as f:
            return {**DEFAULT_CONFIG, **json.load(f)}
    return DEFAULT_CONFIG.copy()


def save_config(config: dict):
    with open(CONFIG_FILE, "w") as f:
        json.dump(config, f, indent=2)


# ── AWS clients ───────────────────────────────────────────────────────────────

def _clients():
    outputs = get_tf_outputs()
    region  = outputs.get("aws_region", os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))
    return (
        boto3.client("ecs",  region_name=region),
        boto3.client("ec2",  region_name=region),
        boto3.client("logs", region_name=region),
        boto3.client("ce",   region_name=region),
        region,
    )


# ── Task helpers ──────────────────────────────────────────────────────────────

def _find_running_task(ecs_client, cluster: str, game: str) -> dict | None:
    """Return the first RUNNING task for a given game, or None."""
    task_def = f"{game}-server"
    try:
        resp = ecs_client.list_tasks(
            cluster=cluster, family=task_def, desiredStatus="RUNNING"
        )
        if not resp.get("taskArns"):
            return None
        tasks = ecs_client.describe_tasks(
            cluster=cluster, tasks=resp["taskArns"]
        )["tasks"]
        for t in tasks:
            if t["lastStatus"] not in ("STOPPED", "DEPROVISIONING"):
                return t
    except ClientError:
        pass
    return None


def _get_task_public_ip(ec2_client, task: dict) -> str | None:
    """Resolve the public IP of a running task via its ENI."""
    for attachment in task.get("attachments", []):
        if attachment.get("type") != "ElasticNetworkInterface":
            continue
        for detail in attachment.get("details", []):
            if detail["name"] == "networkInterfaceId":
                try:
                    resp = ec2_client.describe_network_interfaces(
                        NetworkInterfaceIds=[detail["value"]]
                    )
                    ifaces = resp.get("NetworkInterfaces", [])
                    if ifaces:
                        return ifaces[0].get("Association", {}).get("PublicIp")
                except ClientError:
                    pass
    return None


# ── Server lifecycle ──────────────────────────────────────────────────────────

def get_server_status(game: str) -> dict:
    """Return status dict for a specific game server."""
    outputs = get_tf_outputs()
    if not outputs:
        return {"game": game, "state": "not_deployed", "message": "Run terraform apply first."}

    ecs_client, ec2_client, *_ = _clients()
    cluster = outputs["ecs_cluster_name"]
    domain  = outputs.get("domain_name", "")

    try:
        # Check for running task
        task = _find_running_task(ecs_client, cluster, game)
        if task:
            status = task["lastStatus"]
            if status == "RUNNING":
                public_ip = _get_task_public_ip(ec2_client, task)
                return {
                    "game":      game,
                    "state":     "running",
                    "public_ip": public_ip,
                    "hostname":  f"{game}.{domain}" if domain else None,
                    "task_arn":  task["taskArn"],
                }
            else:
                return {"game": game, "state": "starting", "task_arn": task["taskArn"]}

        # Also check PENDING tasks (just launched)
        pending = ecs_client.list_tasks(
            cluster=cluster, family=f"{game}-server", desiredStatus="RUNNING"
        )
        if pending.get("taskArns"):
            return {"game": game, "state": "starting"}

        return {"game": game, "state": "stopped"}

    except ClientError as e:
        return {"game": game, "state": "error", "message": str(e)}


def get_all_statuses() -> list[dict]:
    """Return status for every configured game."""
    return [get_server_status(game) for game in get_game_names()]


def start_server(game: str) -> dict:
    """Launch a Fargate task for the given game using RunTask."""
    outputs = get_tf_outputs()
    if not outputs:
        return {"success": False, "message": "Terraform not applied. Run 'terraform apply' first."}

    ecs_client, *_ = _clients()
    cluster  = outputs["ecs_cluster_name"]
    subnets  = outputs.get("subnet_ids", "").split(",")
    sg       = outputs.get("security_group_id", "")
    task_def = f"{game}-server"

    # Guard: don't start if already running
    existing = _find_running_task(ecs_client, cluster, game)
    if existing:
        return {"success": False, "message": f"{game} is already running."}

    try:
        resp = ecs_client.run_task(
            cluster=cluster,
            taskDefinition=task_def,
            count=1,
            launchType="FARGATE",
            networkConfiguration={
                "awsvpcConfiguration": {
                    "subnets":        [s.strip() for s in subnets if s.strip()],
                    "securityGroups": [sg],
                    "assignPublicIp": "ENABLED",
                }
            },
        )
        if resp.get("tasks"):
            return {
                "success": True,
                "message": f"{game} is starting. It may take 2–5 minutes to be ready.",
                "task_arn": resp["tasks"][0]["taskArn"],
            }
        failures = resp.get("failures", [])
        reason = failures[0]["reason"] if failures else "unknown"
        return {"success": False, "message": f"Failed to start {game}: {reason}"}
    except ClientError as e:
        return {"success": False, "message": str(e)}


def stop_server(game: str) -> dict:
    """Stop the running Fargate task for the given game."""
    outputs = get_tf_outputs()
    if not outputs:
        return {"success": False, "message": "Terraform not applied."}

    ecs_client, *_ = _clients()
    cluster = outputs["ecs_cluster_name"]

    task = _find_running_task(ecs_client, cluster, game)
    if not task:
        return {"success": False, "message": f"{game} is not currently running."}

    try:
        ecs_client.stop_task(
            cluster=cluster,
            task=task["taskArn"],
            reason="Stopped via management app",
        )
        return {"success": True, "message": f"{game} is stopping. DNS record will be removed automatically."}
    except ClientError as e:
        return {"success": False, "message": str(e)}


# ── Cost estimation ───────────────────────────────────────────────────────────

# Fargate pricing (us-east-1). These are approximate — check AWS pricing page.
FARGATE_VCPU_PER_HOUR = 0.04048
FARGATE_GB_PER_HOUR   = 0.004445

def estimate_costs() -> dict:
    """Estimate per-game and total hourly costs based on task definition sizes."""
    outputs = get_tf_outputs()
    if not outputs:
        return {}

    # We read CPU/memory from each task definition via ECS
    ecs_client, *_ = _clients()
    cluster     = outputs["ecs_cluster_name"]
    game_names  = get_game_names()
    estimates   = {}

    for game in game_names:
        try:
            resp = ecs_client.describe_task_definition(taskDefinition=f"{game}-server")
            td   = resp["taskDefinition"]
            vcpu = int(td["cpu"]) / 1024
            mem  = int(td["memory"]) / 1024  # GB
        except ClientError:
            vcpu, mem = 2.0, 8.0  # fallback defaults

        cpu_cost  = vcpu * FARGATE_VCPU_PER_HOUR
        mem_cost  = mem  * FARGATE_GB_PER_HOUR
        hourly    = cpu_cost + mem_cost

        estimates[game] = {
            "vcpu":                vcpu,
            "memory_gb":           mem,
            "cost_per_hour":       round(hourly, 4),
            "cost_per_day_24h":    round(hourly * 24, 2),
            "cost_per_month_4hpd": round(hourly * 4 * 30, 2),
        }

    total_hourly = sum(v["cost_per_hour"] for v in estimates.values())
    return {"games": estimates, "total_per_hour_if_all_on": round(total_hourly, 4)}


def get_actual_costs(days: int = 7) -> dict:
    """Query AWS Cost Explorer for actual ECS/Fargate spend."""
    _, _, _, ce, _ = _clients()
    end   = datetime.now(timezone.utc).date()
    start = end - timedelta(days=days)

    try:
        resp = ce.get_cost_and_usage(
            TimePeriod={"Start": str(start), "End": str(end)},
            Granularity="DAILY",
            Filter={
                "Dimensions": {
                    "Key": "SERVICE",
                    "Values": ["Amazon Elastic Container Service", "AWS Fargate"],
                }
            },
            Metrics=["UnblendedCost"],
        )
        daily = []
        total = 0.0
        for result in resp["ResultsByTime"]:
            amount = float(result["Total"]["UnblendedCost"]["Amount"])
            daily.append({"date": result["TimePeriod"]["Start"], "cost": round(amount, 4)})
            total += amount
        return {"daily": daily, "total": round(total, 2), "currency": "USD", "days": days}
    except ClientError as e:
        return {"error": str(e)}


# ── File Manager (FileBrowser on EFS) ────────────────────────────────────────

FILEBROWSER_IMAGE = "filebrowser/filebrowser:s6"
FILEBROWSER_PORT  = 8080

def start_file_manager(game: str) -> dict:
    """
    Launch a temporary FileBrowser ECS task for a game's EFS access point.
    The task mounts the game's EFS data directory at /srv and exposes port 8080.
    """
    outputs = get_tf_outputs()
    if not outputs:
        return {"success": False, "message": "Terraform not applied. Run 'terraform apply' first."}

    access_points = outputs.get("efs_access_points", {})
    if game not in access_points:
        return {"success": False, "message": f"No EFS access point found for '{game}'."}

    ecs_client, ec2_client, _, _, region = _clients()
    cluster     = outputs["ecs_cluster_name"]
    subnets     = outputs.get("subnet_ids", "").split(",")
    filemgr_sg  = outputs.get("file_manager_security_group_id", "")
    efs_id      = outputs.get("efs_file_system_id", "")
    ap_id       = access_points[game]
    exec_role   = _get_execution_role_arn(ecs_client, cluster, game)

    # Check if a file manager is already running for this game
    existing = _find_file_manager_task(ecs_client, cluster, game)
    if existing:
        return {"success": False, "message": f"File manager for '{game}' is already running."}

    # Register an ephemeral task definition for FileBrowser
    log_group = f"/ecs/filebrowser-{game}"
    task_def_name = f"filebrowser-{game}"
    try:
        ecs_client.register_task_definition(
            family=task_def_name,
            networkMode="awsvpc",
            requiresCompatibilities=["FARGATE"],
            cpu="256",
            memory="512",
            executionRoleArn=exec_role,
            volumes=[{
                "name": "game-data",
                "efsVolumeConfiguration": {
                    "fileSystemId": efs_id,
                    "transitEncryption": "ENABLED",
                    "authorizationConfig": {"accessPointId": ap_id, "iam": "DISABLED"},
                },
            }],
            containerDefinitions=[{
                "name": "filebrowser",
                "image": FILEBROWSER_IMAGE,
                "essential": True,
                "portMappings": [{"containerPort": FILEBROWSER_PORT, "hostPort": FILEBROWSER_PORT, "protocol": "tcp"}],
                "environment": [
                    {"name": "FB_NOAUTH", "value": "true"},
                    {"name": "FB_ROOT",   "value": "/srv"},
                    {"name": "FB_PORT",   "value": str(FILEBROWSER_PORT)},
                    {"name": "FB_DATABASE", "value": "/tmp/filebrowser.db"},
                ],
                "mountPoints": [{"sourceVolume": "game-data", "containerPath": "/srv", "readOnly": False}],
                "logConfiguration": {
                    "logDriver": "awslogs",
                    "options": {
                        "awslogs-group":         log_group,
                        "awslogs-region":        region,
                        "awslogs-stream-prefix": "ecs",
                        "awslogs-create-group":  "true",
                    },
                },
            }],
        )
    except ClientError as e:
        return {"success": False, "message": f"Could not register task definition: {e}"}

    try:
        resp = ecs_client.run_task(
            cluster=cluster,
            taskDefinition=task_def_name,
            count=1,
            launchType="FARGATE",
            startedBy=f"filemgr-{game}",
            networkConfiguration={
                "awsvpcConfiguration": {
                    "subnets":        [s.strip() for s in subnets if s.strip()],
                    "securityGroups": [filemgr_sg],
                    "assignPublicIp": "ENABLED",
                }
            },
        )
        if resp.get("tasks"):
            return {
                "success":  True,
                "message":  f"File manager for '{game}' is starting. It will be ready in ~30 seconds.",
                "task_arn": resp["tasks"][0]["taskArn"],
            }
        failures = resp.get("failures", [])
        reason = failures[0]["reason"] if failures else "unknown"
        return {"success": False, "message": f"Failed to launch file manager: {reason}"}
    except ClientError as e:
        return {"success": False, "message": str(e)}


def get_file_manager_status(game: str) -> dict:
    """Return status and URL for the file manager task of a given game."""
    outputs = get_tf_outputs()
    if not outputs:
        return {"game": game, "state": "not_deployed"}

    ecs_client, ec2_client, *_ = _clients()
    cluster = outputs["ecs_cluster_name"]

    task = _find_file_manager_task(ecs_client, cluster, game)
    if not task:
        return {"game": game, "state": "stopped"}

    status = task.get("lastStatus", "")
    if status == "RUNNING":
        public_ip = _get_task_public_ip(ec2_client, task)
        url = f"http://{public_ip}:{FILEBROWSER_PORT}" if public_ip else None
        return {"game": game, "state": "running", "url": url, "task_arn": task["taskArn"]}

    return {"game": game, "state": "starting", "task_arn": task["taskArn"]}


def stop_file_manager(game: str) -> dict:
    """Stop the FileBrowser task for a given game."""
    outputs = get_tf_outputs()
    if not outputs:
        return {"success": False, "message": "Terraform not applied."}

    ecs_client, *_ = _clients()
    cluster = outputs["ecs_cluster_name"]

    task = _find_file_manager_task(ecs_client, cluster, game)
    if not task:
        return {"success": False, "message": f"No file manager running for '{game}'."}

    try:
        ecs_client.stop_task(
            cluster=cluster,
            task=task["taskArn"],
            reason="Stopped via management app",
        )
        return {"success": True, "message": f"File manager for '{game}' is stopping."}
    except ClientError as e:
        return {"success": False, "message": str(e)}


def _find_file_manager_task(ecs_client, cluster: str, game: str) -> dict | None:
    """Find a running FileBrowser task for the given game."""
    try:
        resp = ecs_client.list_tasks(
            cluster=cluster,
            startedBy=f"filemgr-{game}",
            desiredStatus="RUNNING",
        )
        if not resp.get("taskArns"):
            return None
        tasks = ecs_client.describe_tasks(cluster=cluster, tasks=resp["taskArns"])["tasks"]
        for t in tasks:
            if t["lastStatus"] not in ("STOPPED", "DEPROVISIONING"):
                return t
    except ClientError:
        pass
    return None


def _get_execution_role_arn(ecs_client, cluster: str, game: str) -> str:
    """Get the execution role ARN from an existing game task definition."""
    try:
        resp = ecs_client.describe_task_definition(taskDefinition=f"{game}-server")
        return resp["taskDefinition"].get("executionRoleArn", "")
    except ClientError:
        return ""


# ── Logs ──────────────────────────────────────────────────────────────────────

def get_recent_logs(game: str, limit: int = 50) -> list[str]:
    """Fetch recent CloudWatch log lines for a game server."""
    _, _, logs_client, *_ = _clients()
    log_group = f"/ecs/{game}-server"

    try:
        streams = logs_client.describe_log_streams(
            logGroupName=log_group,
            orderBy="LastEventTime",
            descending=True,
            limit=1,
        )
        if not streams.get("logStreams"):
            return [f"No log streams found for {game}."]

        stream_name = streams["logStreams"][0]["logStreamName"]
        events = logs_client.get_log_events(
            logGroupName=log_group,
            logStreamName=stream_name,
            limit=limit,
            startFromHead=False,
        )
        return [e["message"] for e in events.get("events", [])]
    except ClientError as e:
        return [f"Error fetching logs for {game}: {e}"]
