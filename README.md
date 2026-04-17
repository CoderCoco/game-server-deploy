# Game Server Manager

A cost-efficient multi-game dedicated server platform on **AWS Fargate** with a local web UI to manage everything. Servers only run (and cost money) when you want to play.

## Architecture

- **AWS Fargate** — runs game server containers on-demand via `RunTask` (no persistent ECS Service, no idle costs)
- **EFS** — persists world saves across server restarts
- **Route 53** — auto-updates `{game}.yourdomain.com` DNS records when tasks start/stop via a Lambda
- **Watchdog Lambda** — automatically shuts down idle servers based on network traffic
- **Terraform** — provisions all AWS infrastructure
- **Express + React management app** — local dashboard to start/stop servers, edit config, monitor costs, stream logs, and manage the optional Discord bot
- **Discord bot (optional)** — runs inside the management app; permitted Discord users/roles can `/server-start`, `/server-stop`, `/server-status`, and `/server-list` from chat

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
   - `AmazonEventBridgeFullAccess`
   - `AmazonRoute53FullAccess`
   - `IAMFullAccess`
   - `AWSCostExplorerReadOnlyAccess`
   - `ElasticLoadBalancingFullAccess` ← required for ALB (HTTPS game servers)
   - `AWSCertificateManagerFullAccess` ← required for ACM TLS certificates
4. After creating the user, go to **Security credentials** → **Create access key**
5. Choose **Command Line Interface (CLI)** as the use case
6. Save the **Access Key ID** and **Secret Access Key** — you won't see the secret again

> **Tip**: For a tighter security boundary, use a custom IAM policy scoped to only the resources this project creates instead of the managed policies above.

#### Additional inline policy required

The Terraform AWS provider tags EventBridge rules on creation, which requires `events:TagResource` — a permission not included in any of the managed policies above. Add it as an inline policy:

IAM → Users → your-user → **Add inline policy** → JSON tab:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "events:TagResource",
        "events:UntagResource",
        "events:ListTagsForResource"
      ],
      "Resource": "*"
    }
  ]
}
```

Name it something like `EventBridgeTagging` and save.

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

The Docker setup mounts `./terraform` (read-only for state), `./app/server_config.json`, `./app/discord_config.json` (if using the Discord bot), and `~/.aws` credentials.

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
- **Discord Bot** — configure bot token, guild allowlist, admins, and per-game permissions (see next section)

## Discord Bot

The management app runs an optional Discord bot so permitted users can start/stop servers from chat with slash commands. The bot **only joins guilds you explicitly allowlist** — if it's ever added to a guild that isn't on the list, it auto-leaves.

### Commands

| Command | What it does |
|---------|--------------|
| `/server-start <game>` | Start a configured game server |
| `/server-stop <game>`  | Stop a running game server |
| `/server-status [game]` | Show status of a game (or all if omitted) |
| `/server-list` | List all configured games and their current state |

Replies are ephemeral (only the invoker sees them), so commands don't spam the channel.

### Permission model

Every command invocation is checked in this order:

1. **Guild allowlist** — if the guild isn't allowlisted, the bot refuses entirely.
2. **Server-wide admins** — any user ID or role ID in the admin lists can run every command on every game.
3. **Per-game permissions** — otherwise the command is permitted only if the user's ID or one of their role IDs is listed for that game *and* the requested action (`start` / `stop` / `status`) is in that entry's allowed actions.

Admins and per-game entries are kept separate, so you can give one group of Discord users full control and another group stop-only access to a single game.

### Setup

1. **Create a Discord application.** Visit <https://discord.com/developers/applications> → **New Application** → add a **Bot**.
   - Copy the **Application ID** (the "client ID") and the **Bot Token**. Treat the token like a password.
   - Enable the **Server Members Intent** under *Privileged Gateway Intents* (needed so the bot can see the roles of command invokers).
2. **Invite the bot to your Discord server.** In the app's **OAuth2 → URL Generator**, select scopes `bot` and `applications.commands` and bot permissions `Send Messages` + `Use Application Commands`. Open the generated URL and add the bot to your server.
3. **Enable Developer Mode in Discord** (User Settings → Advanced → Developer Mode) so you can right-click a server/user/role and **Copy ID**.
4. **Start the management app** (Option A or B under Quick Start).
5. **Open the dashboard** → the **Discord Bot** panel has four tabs:
   - **Credentials** — paste the client ID and bot token, Save, then **Restart Bot**. (You can also set `DISCORD_BOT_TOKEN` as an env var; env wins over the file.)
   - **Guilds** — add the ID of each Discord server the bot should operate in. It will auto-leave any other server.
   - **Admins** — comma-separated user IDs and/or role IDs who can run every command on every game.
   - **Per-Game Permissions** — select a game, paste allowed user/role IDs, tick which actions (`start`/`stop`/`status`) they can invoke, Save.

Config is persisted to `app/discord_config.json` (gitignored). In Docker Compose this file is volume-mounted so it survives container rebuilds; the token can alternatively be passed via the `DISCORD_BOT_TOKEN` environment variable.

### Troubleshooting

- **Bot shows `error` in the status badge** — check the Credentials tab for the error message; most commonly an invalid token.
- **Slash commands don't appear in Discord** — make sure the guild's ID is in the allowlist (commands are registered per-guild on startup and when joining) and that the bot was invited with the `applications.commands` scope. Click **Restart Bot** after allowlisting a new guild.
- **Command replies "You don't have permission…"** — confirm your Discord user ID or one of your role IDs is in the admin list or the per-game entry, *and* that the action you invoked is ticked.

## Cost Tracking

All resources are tagged with `Project = "game-servers-poc"` (via Terraform `default_tags`). To break down costs by this project in Cost Explorer:

1. Go to **AWS Billing → Cost allocation tags**
2. Find `Project` under user-defined tags and click **Activate**
3. Wait up to 24 hours — then in **Cost Explorer** you can filter or group by `Project` to see all spend attributed to this deployment

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
│   ├── src/
│   │   ├── server/              # Express API (routes, services, DI container)
│   │   │   ├── routes/          # Per-feature routers (games, costs, logs, files, discord)
│   │   │   └── services/        # AWS + Discord logic (ConfigService, EcsService, DiscordBotService, …)
│   │   └── client/              # React/Vite dashboard (components, hooks, api.ts)
│   ├── server_config.json       # Watchdog config (persisted locally, gitignored)
│   ├── discord_config.json      # Discord bot config (persisted locally, gitignored)
│   └── vitest.config.ts         # Test runner config
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
