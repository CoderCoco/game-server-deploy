# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands

The management app is a TypeScript project (Express API + React/Vite UI) under `app/`. Dependencies are managed with **npm**.

```bash
# Install app deps
cd app && npm install

# Run the dev servers (Express on 3001, Vite on 5173 with /api proxy)
cd app && npm run dev

# Production build + run
cd app && npm run build && npm start    # http://localhost:3001

# Run the app in Docker (mounts ./terraform ro, ./app/server_config.json, ~/.aws)
docker compose up --build               # http://localhost:5000

# Terraform (all infra lives under terraform/)
cd terraform
terraform init
terraform plan
terraform apply
terraform destroy

# First-time environment bootstrap (installs terraform, aws CLI if missing, runs terraform init)
./setup.sh
```

No test suite or linter is configured in this repo.

## Architecture

Two loosely-coupled halves communicate via the Terraform state file:

1. **Terraform (`terraform/`)** provisions all AWS infrastructure.
2. **Management app (`app/`)** — Express + TypeScript backend reads `terraform/terraform.tfstate` directly at runtime to discover cluster/subnet/SG IDs, then drives AWS via the AWS SDK v3. React/Vite frontend talks to the Express API. Services use **tsyringe** for DI and **Winston** for structured logging.

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

`ConfigService.getTfOutputs()` (in `app/src/server/services/ConfigService.ts`) parses `terraform.tfstate` as JSON and caches it in-memory. `invalidateTfCache()` is called on `/api/games` and `/api/status` to pick up new deploys. The app's container mounts `./terraform:/app/terraform:ro` — this path coupling matters if directory structure changes.

### Known Lambda env-var quirk

Lambda env vars named `AWS_REGION` are reserved by the runtime. Both Lambdas use `AWS_REGION_` (trailing underscore) to pass the configured region — preserve this when editing.

## AWS IAM Requirement Not Covered by Managed Policies

The AWS provider tags EventBridge rules on creation, which requires `events:TagResource` / `UntagResource` / `ListTagsForResource`. These are **not** in any of the managed policies listed in the README. An inline policy granting them must be attached to the deploy user or `terraform apply` will fail. See README "Additional inline policy required".

## Cost Tagging

All resources inherit `default_tags` from `provider "aws"` (`Project = "game-servers-poc"`, `Environment = "poc"`, `ManagedBy = "terraform"`). For Cost Explorer breakdowns, the `Project` cost allocation tag must be activated manually in AWS Billing — this is a one-time console action, not Terraform-managed.
