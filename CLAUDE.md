# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands

Dependencies are managed with **pipenv** (Pipfile is authoritative; `requirements.txt` is legacy and unused).

```bash
# Install app deps
pipenv install

# Run the Flask UI locally
cd app && pipenv run python app.py          # http://localhost:5000

# Run the app in Docker (mounts ./terraform ro, ./app/server_config.json, ~/.aws)
docker compose up --build

# Terraform (all infra lives under terraform/)
cd terraform
terraform init
terraform plan
terraform apply
terraform destroy

# First-time environment bootstrap (installs python3, pipenv, terraform, aws CLI if missing, runs terraform init)
./setup.sh
```

No test suite or linter is configured in this repo.

## Architecture

Two loosely-coupled halves communicate via the Terraform state file:

1. **Terraform (`terraform/`)** provisions all AWS infrastructure.
2. **Flask app (`app/`)** reads `terraform/terraform.tfstate` directly at runtime to discover cluster/subnet/SG IDs, then drives AWS via boto3.

There is **no persistent ECS Service**. Servers run only when the user clicks Start — the app calls `ecs.run_task()` / `ecs.stop_task()` against per-game task definitions named `{game}-server`. This is the core cost-saving design choice; don't introduce a long-running Service.

### The `game_servers` map is the single source of truth

`variables.tf:game_servers` is a `map(object({...}))`. Adding/removing an entry cascades through **every** Terraform resource via `for_each`:

- `aws_ecs_task_definition.game` — one task def per game
- `aws_efs_access_point.game` — isolated save directory per game
- `aws_cloudwatch_log_group.game` — `/ecs/{game}-server`
- `aws_security_group.game_servers` — dynamic ingress rules flattened from all games' ports (deduplicated in `locals.all_game_ports`)
- Lambda env vars `GAME_NAMES` in `route53.tf` and `watchdog.tf`

When adding a game, only edit `terraform.tfvars`. Don't hand-write new resources.

### DNS is Lambda-managed, not Terraform-managed

`route53.tf` creates the zone data source and the updater Lambda, but **no `aws_route53_record` resources**. An EventBridge rule on `ECS Task State Change` fires `lambda/update_dns.py`, which UPSERTs a record for `{game}.{hosted_zone_name}` on `RUNNING` and DELETEs on `STOPPED`. Terraform would fight the Lambda — keep DNS records out of Terraform.

### Watchdog state lives in ECS task tags

`lambda/watchdog.py` runs on an EventBridge schedule (`rate(${watchdog_interval_minutes} minutes)`) and checks `NetworkPacketsIn` on each task's ENI via CloudWatch. The consecutive-idle counter is **stored as a tag on the ECS task itself** — there's no DynamoDB/SSM. After `watchdog_idle_checks` consecutive idle intervals, the task is stopped (which triggers the DNS-delete path above).

### App → Terraform coupling

`app/server_manager.py:get_tf_outputs()` parses `terraform.tfstate` as JSON and caches it in a module-level `_tf_outputs`. `invalidate_tf_cache()` is called on `/api/games` and `/api/status` to pick up new deploys. The app's container mounts `./terraform:/app/terraform:ro` — this path coupling matters if directory structure changes.

### Known Lambda env-var quirk

Lambda env vars named `AWS_REGION` are reserved by the runtime. Both Lambdas use `AWS_REGION_` (trailing underscore) to pass the configured region — preserve this when editing.

## AWS IAM Requirement Not Covered by Managed Policies

The AWS provider tags EventBridge rules on creation, which requires `events:TagResource` / `UntagResource` / `ListTagsForResource`. These are **not** in any of the managed policies listed in the README. An inline policy granting them must be attached to the deploy user or `terraform apply` will fail. See README "Additional inline policy required".

## Cost Tagging

All resources inherit `default_tags` from `provider "aws"` (`Project = "game-servers-poc"`, `Environment = "poc"`, `ManagedBy = "terraform"`). For Cost Explorer breakdowns, the `Project` cost allocation tag must be activated manually in AWS Billing — this is a one-time console action, not Terraform-managed.
