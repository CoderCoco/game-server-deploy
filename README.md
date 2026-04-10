# Game Server Manager

A cost-efficient multi-game dedicated server platform on **AWS Fargate** with a local web UI to manage everything. Servers only run (and cost money) when you want to play.

## Architecture

- **AWS Fargate** — runs game server containers on-demand via `RunTask` (no persistent ECS Service, no idle costs)
- **EFS** — persists world saves across server restarts
- **Route 53** — auto-updates `{game}.yourdomain.com` DNS records when tasks start/stop via a Lambda
- **Watchdog Lambda** — automatically shuts down idle servers based on network traffic
- **Terraform** — provisions all AWS infrastructure
- **Flask web app** — local dashboard to start/stop servers, edit config, monitor costs, and stream logs

### Auto-DNS

An EventBridge rule watches for ECS task state changes and triggers a Lambda that UPSERTs the DNS record on `RUNNING` and DELETEs it on `STOPPED`. DNS is managed entirely by the Lambda — not Terraform.

### Watchdog

A Lambda runs on a configurable schedule (default every 15 minutes). For each running task it checks `NetworkPacketsIn` via CloudWatch. If packets fall below `watchdog_min_packets` for `watchdog_idle_checks` consecutive intervals, the task is stopped and its DNS record removed.

**Default**: 15 min × 4 checks = **60 minutes idle** before auto-shutdown.

## AWS Setup

### 1. Create an IAM User

1. Go to the [AWS IAM Console](https://console.aws.amazon.com/iam/) → **Users** → **Create user**
2. Give it a name (e.g. `game-server-deploy`)
3. On the permissions step, choose **Attach policies directly** and add:
   - `AmazonECS_FullAccess`
   - `AmazonElasticFileSystemFullAccess`
   - `AmazonVPCFullAccess`
   - `AWSLambda_FullAccess`
   - `CloudWatchFullAccess`
   - `AmazonRoute53FullAccess`
   - `IAMFullAccess`
   - `AWSCostExplorerReadOnlyAccess`
4. After creating the user, go to **Security credentials** → **Create access key**
5. Choose **Command Line Interface (CLI)** as the use case
6. Save the **Access Key ID** and **Secret Access Key** — you won't see the secret again

> **Tip**: For a tighter security boundary, use a custom IAM policy scoped to only the resources this project creates instead of the managed policies above.

### 2. Configure AWS CLI

```bash
aws configure
```

Enter your credentials when prompted:

```
AWS Access Key ID:     AKIA...
AWS Secret Access Key: ****
Default region name:   us-east-1   # must match aws_region in terraform.tfvars
Default output format: json
```

This writes to `~/.aws/credentials` and `~/.aws/config`, which Terraform and the management app both read automatically.

### 3. Verify

```bash
aws sts get-caller-identity
```

You should see your account ID and user ARN. If this works, you're ready to run Terraform.

---

## Quick Start

### Option A — Run the app directly

```bash
# 1. Run setup (installs Python deps, inits Terraform)
chmod +x setup.sh && ./setup.sh

# 2. Configure your servers
cp terraform/terraform.example.tfvars terraform/terraform.tfvars
# Edit terraform/terraform.tfvars

# 3. Deploy infrastructure
cd terraform
terraform plan
terraform apply

# 4. Launch the management UI
cd ../app
python3 app.py
# Open http://localhost:5000
```

### Option B — Run the app in Docker

```bash
# 1. Deploy infrastructure first (see above)

# 2. Start the app
docker compose up --build
# Open http://localhost:5000
```

The Docker setup mounts `./terraform` (read-only for state), `./app/server_config.json`, and `~/.aws` credentials.

## Configuration

Copy `terraform/terraform.example.tfvars` to `terraform/terraform.tfvars` and customize:

```hcl
aws_region   = "us-east-1"
project_name = "game-servers"

# Route 53 hosted zone — creates {game}.yourdomain.com records
hosted_zone_name = "yourdomain.com"

# Watchdog settings
watchdog_interval_minutes = 15   # how often to check (minutes)
watchdog_idle_checks      = 4    # consecutive idle checks before shutdown
watchdog_min_packets      = 100  # packets/interval to be considered "active"

# Add one entry per game server
game_servers = {
  palworld = {
    image  = "thijsvanloef/palworld-server-docker:latest"
    cpu    = 2048
    memory = 8192
    ports = [
      { container = 8211,  protocol = "udp" },
      { container = 27015, protocol = "udp" },
    ]
    environment = [
      { name = "PLAYERS",        value = "8" },
      { name = "SERVER_NAME",    value = "My Palworld Server" },
      { name = "ADMIN_PASSWORD", value = "your_secure_password_here" },
      # ...
    ]
    efs_path = "/palworld"
  }
}
```

## Management App Features

- **Games list** — auto-discovers all configured game servers from Terraform state
- **Start/Stop** — launches or stops Fargate tasks per game
- **Status** — shows running state and public IP / DNS hostname per game
- **Server Config** — edit watchdog settings (interval, idle checks, min packets)
- **Cost Monitoring** — per-game Fargate cost estimates and AWS Cost Explorer actuals
- **Live Logs** — streams CloudWatch log events from the most recent task

## Cost Breakdown

| Resource | Cost |
|----------|------|
| Fargate (2 vCPU, 8 GB) | ~$0.12/hr while running |
| EFS storage | ~$0.30/GB/month |
| Lambda / EventBridge | effectively free at this scale |

**Example**: Playing 4 hours/day, 5 days/week ≈ **$10–12/month**.

Compare to a t3.large running 24/7 ≈ $60/month.

## Project Structure

```
game-server-deploy/
├── terraform/
│   ├── main.tf                  # VPC, ECS cluster, EFS, IAM, security groups
│   ├── variables.tf             # All configurable parameters
│   ├── outputs.tf               # Values consumed by the management app
│   ├── route53.tf               # DNS updater Lambda + EventBridge rule
│   ├── watchdog.tf              # Watchdog Lambda + EventBridge schedule
│   ├── lambda/
│   │   ├── update_dns.py        # Auto-updates Route 53 on task start/stop
│   │   └── watchdog.py          # Shuts down idle servers
│   └── terraform.example.tfvars
├── app/
│   ├── app.py                   # Flask web server + REST API
│   ├── server_manager.py        # AWS SDK logic (ECS, CloudWatch, Cost Explorer)
│   ├── server_config.json       # Watchdog config (persisted locally)
│   └── templates/
│       └── index.html           # Dashboard UI
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
├── setup.sh
└── README.md
```

## Tearing Down

```bash
# Stop all servers via the UI first, then:
cd terraform
terraform destroy
```
