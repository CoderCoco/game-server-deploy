# Game Server Manager

A cost-efficient multi-game dedicated server platform on **AWS Fargate** with a local web UI to manage everything. Servers only run (and cost money) when you want to play.

## Architecture

- **AWS Fargate** — runs game server containers on-demand via `RunTask` (no persistent ECS Service, no idle costs)
- **EFS** — persists world saves across server restarts
- **Route 53** — auto-updates `{game}.yourdomain.com` DNS records when tasks start/stop via a Lambda
- **Watchdog Lambda** — automatically shuts down idle servers based on network traffic
- **Terraform** — provisions all AWS infrastructure
- **Nest.js + React management app** — local dashboard to start/stop servers, edit config, monitor costs, stream logs, and manage Discord credentials
- **Discord bot (serverless)** — two Node.js Lambdas + DynamoDB + Secrets Manager serve Discord HTTP interactions; permitted Discord users/roles can `/server-start`, `/server-stop`, `/server-status`, and `/server-list` from chat without any 24/7 process running

### Auto-DNS

An EventBridge rule watches for ECS task state changes and triggers a Lambda that UPSERTs the DNS record on `RUNNING` and DELETEs it on `STOPPED`. DNS is managed entirely by the Lambda — not Terraform.

### Watchdog

A Lambda runs on a configurable schedule (default every 15 minutes). For each running task it checks `NetworkPacketsIn` via CloudWatch. If packets fall below `watchdog_min_packets` for `watchdog_idle_checks` consecutive intervals, the task is stopped and its DNS record removed.

**Default**: 15 min × 4 checks = **60 minutes idle** before auto-shutdown.

## AWS Setup

### 1. Create an IAM User

1. Go to the [AWS IAM Console](https://console.aws.amazon.com/iam/) → **Users** → **Create user**
2. Give it a name (e.g. `game-server-deploy`)
3. On the permissions step, choose **Attach policies directly** → skip past the managed-policy picker without selecting anything, and create the user.
4. After creating the user, open it → **Permissions** tab → **Add permissions** → **Create inline policy** → **JSON** tab, and paste the single policy below. Name it `GameServerDeployAll` (or anything).
5. **Security credentials** → **Create access key** → choose **Command Line Interface (CLI)**.
6. Save the **Access Key ID** and **Secret Access Key** — you won't see the secret again.

> **Why one inline policy instead of stacking managed policies?** AWS caps each IAM user at 10 directly-attached managed policies by default, and this project needs permissions across ~14 services. Putting everything in one inline policy sidesteps that quota entirely and keeps the full list of what the deploy user can do visible in one place. Trade-off: you lose AWS's auto-maintenance of the managed policies' action lists — but since we're granting `{service}:*` for each, there's nothing to maintain.

#### The inline policy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "GameServerDeploy",
      "Effect": "Allow",
      "Action": [
        "ecs:*",
        "elasticfilesystem:*",
        "ec2:*",
        "lambda:*",
        "logs:*",
        "cloudwatch:*",
        "events:*",
        "route53:*",
        "iam:*",
        "ce:*",
        "elasticloadbalancing:*",
        "acm:*",
        "dynamodb:*",
        "secretsmanager:*"
      ],
      "Resource": "*"
    }
  ]
}
```

That's it — no additional managed policies, no additional inline policies. If you previously attached any of `AmazonECS_FullAccess`, `AmazonElasticFileSystemFullAccess`, `AmazonVPCFullAccess`, `AWSLambda_FullAccess`, `CloudWatchFullAccess`, `AmazonEventBridgeFullAccess`, `AmazonRoute53FullAccess`, `IAMFullAccess`, `AWSCostExplorerReadOnlyAccess`, `ElasticLoadBalancingFullAccess`, `AWSCertificateManagerFullAccess`, `AmazonDynamoDBFullAccess`, or `SecretsManagerReadWrite`, you can **detach them all** after attaching this inline policy.

> **Tip**: For a tighter security boundary on a shared AWS account, replace this with a custom policy scoped to the specific resource ARNs Terraform creates — the list above is `{service}:*` for a personal-project deploy user.

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

# 2. Create the persistence file that gets bind-mounted (first run only).
#    It must exist on the host or Docker creates a directory in its place.
#    (Discord credentials now live in AWS Secrets Manager, not a local file.)
touch app/server_config.json

# 3. Set an API token — REQUIRED in production mode (which Docker uses).
#    Generate a random 32-byte hex string or anything long & hard to guess.
export API_TOKEN="$(openssl rand -hex 32)"

# 4. Start the app
docker compose up --build
# Open http://localhost:5000 — the dashboard will prompt you for the token;
# paste the value of $API_TOKEN and click "Save & reload".
```

The Docker setup mounts `./terraform` (read-only for state), `./app/server_config.json`, and `~/.aws` credentials. The Discord bot reads its config from the DynamoDB table provisioned by Terraform, so no `discord_config.json` bind mount is needed.

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

## API Authentication

Every `/api/*` route on the management app is gated behind a bearer token, so the dashboard can't be driven by anyone who can reach the port. The token is read (in order of precedence) from:

1. The `API_TOKEN` environment variable, or
2. The `api_token` field in `app/server_config.json`.

Set it to any long random secret, e.g.:

```bash
# POSIX
export API_TOKEN="$(openssl rand -hex 32)"
```

Or add the following to `app/server_config.json`:

```json
{
  "api_token": "your-long-random-secret-here"
}
```

When the dashboard loads in a browser it will prompt for the token once; it's stored in `localStorage` and attached to every subsequent API call as `Authorization: Bearer <token>`. Clear the stored value by clearing your browser data.

**Production startup safety.** When `NODE_ENV=production` (the default for Docker), the app **refuses to start** if no token is configured. In dev (`npm run dev`) it logs a warning and allows unauthenticated requests, so local iteration isn't blocked.

## Discord Bot

The Discord bot is fully serverless — it runs as two AWS Lambdas (plus a DynamoDB table for config and pending interactions, and two Secrets Manager secrets for credentials), all provisioned by Terraform. The management app no longer needs to run 24/7 for the bot to work; it's only used to edit bot configuration. The bot **rejects commands from any guild that isn't on the allowlist** you configure in the web UI.

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

1. **Create a Discord application.** Visit <https://discord.com/developers/applications> → **New Application** → add a **Bot**. From the General Information page you'll copy three values; each has a specific job:

   | Value | Where it goes | What the bot uses it for |
   |---|---|---|
   | **Application ID** (aka Client ID) | DynamoDB (`clientId` in the Discord config row) | Identifies your app when the management server calls Discord's REST API to install the four slash commands into a guild — the endpoint is `PUT /applications/{APPLICATION_ID}/guilds/{GUILD_ID}/commands`. Without it, the "Register commands" button in the UI errors with "clientId is not configured". Public value, not a secret. |
   | **Bot Token** | AWS Secrets Manager (`${project_name}/discord/bot-token`) | Authenticates the same REST call as `Authorization: Bot <token>`. Treat like a password. |
   | **Application Public Key** | AWS Secrets Manager (`${project_name}/discord/public-key`) | Ed25519 key the InteractionsLambda uses to verify that every incoming interaction was actually signed by Discord. Public value but sensitive to tampering, so it lives in Secrets Manager. |

   You do **not** need to enable any *Privileged Gateway Intents* — the HTTP-interactions model reads the invoker's role IDs directly from the request body.
2. **Deploy the serverless Discord stack** by running `terraform apply`. This provisions the DynamoDB table, two Secrets Manager secrets, the interactions and followup Lambdas, and a Lambda Function URL that Discord can reach. The URL is surfaced as the `interactions_invoke_url` Terraform output. You can seed credentials two ways:
   - **Via tfvars (recommended if you're comfortable putting the token in `terraform.tfvars`).** Set `discord_application_id`, `discord_bot_token`, and `discord_public_key` in `terraform.tfvars` — `.tfvars` is gitignored. Terraform writes the App ID to DynamoDB and the two secrets to Secrets Manager on the first apply. Subsequent applies don't overwrite them (`ignore_changes` on both) so the UI can still edit them later. To rotate a value via tfvars after that first apply, `terraform taint` the relevant resource (`aws_secretsmanager_secret_version.discord_bot_token`, `.discord_public_key`, or `aws_dynamodb_table_item.discord_config_seed`) before the next apply.
   - **Via the web UI.** Leave the three variables unset. Terraform seeds the secrets with a `"placeholder"` string (and skips the DynamoDB config row entirely); you paste the real values into the Credentials tab of the dashboard, which writes them to the correct backing store at runtime.
3. **Invite the bot to your Discord server.** In the Developer Portal:
   - Under **Installation → Installation Contexts**, enable **Guild Install** (the bot operates on guild-scoped resources — allowlist, role-based permissions — so user install doesn't apply here). Disable User Install if Discord defaulted it on.
   - Under **OAuth2 → URL Generator**, tick scopes `bot` and `applications.commands`. In the **Bot Permissions** grid that appears below, tick **Send Messages** and **Use Slash Commands** (this is Discord's display name for the `USE_APPLICATION_COMMANDS` permission bit — same permission, renamed in the UI).
   - Copy the generated URL and open it to add the bot to your server.
4. **Enable Developer Mode in Discord** (User Settings → Advanced → Developer Mode) so you can right-click a server/user/role and **Copy ID**.
5. **Start the management app** (Option A or B under Quick Start) and **open the dashboard** → the **Discord Bot** panel has four tabs:
   - **Credentials** — if you didn't seed via tfvars, paste the Application (Client) ID, Bot Token, and Application Public Key, then Save. The Application ID goes to DynamoDB (the bot needs it to register slash commands); the bot token and public key go to AWS Secrets Manager. Copy the Interactions Endpoint URL shown beneath the form into the same Discord Developer Portal page — that step is always done via the UI since the URL is a Terraform output.
   - **Guilds** — add the ID of each Discord server the bot should operate in, then click **Register commands** next to that guild to install the slash commands via Discord's REST API.
   - **Admins** — comma-separated user IDs and/or role IDs who can run every command on every game.
   - **Per-Game Permissions** — select a game, paste allowed user/role IDs, tick which actions (`start`/`stop`/`status`) they can invoke, Save.

### Troubleshooting

- **Badge shows `awaiting credentials`** — the bot token or public key is still at the Terraform placeholder; open the Credentials tab and save the real values.
- **Badge shows `terraform not applied`** — the `interactions_invoke_url` Terraform output is missing; run `cd app && npm run build:lambdas && cd ../terraform && terraform apply`.
- **Slash commands don't appear in Discord** — click **Register commands** for that guild in the Guilds tab; the bot must also have been invited with the `applications.commands` scope.
- **Discord returns "invalid interactions endpoint URL"** — the Application Public Key in Secrets Manager doesn't match Discord's when signatures are verified. Re-copy the public key from the Developer Portal and re-save in the Credentials tab.
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
│   ├── packages/
│   │   ├── shared/              # @gsd/shared — types, canRun, formatters, DynamoDB + Secrets helpers
│   │   ├── server/              # @gsd/server — Nest.js API (controllers, services, guards)
│   │   ├── web/                 # @gsd/web — React/Vite dashboard
│   │   └── lambda/
│   │       ├── interactions/    # Discord HTTP interactions (Ed25519 verify + deferred-ack)
│   │       ├── followup/        # Async ECS RunTask/StopTask + Discord webhook PATCH
│   │       ├── update-dns/      # Port of update_dns.py — Route 53 + Discord followup on RUNNING
│   │       └── watchdog/        # Port of watchdog.py — idle-detect + auto-stop
│   ├── server_config.json       # Watchdog config (persisted locally, gitignored)
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
