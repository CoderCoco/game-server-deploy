# Game Server Discord Bot — ECS Fargate

A serverless Discord bot that lets your friends start and stop game servers
on-demand. Servers run on ECS Fargate (pay only while playing), with saves
persisted on EFS and friendly DNS names via Route 53.

## Commands

| Command | Description |
|---------|-------------|
| `/start palworld` | Boot the Palworld server (~30-60s) |
| `/stop palworld` | Shut down and save |
| `/status` | List all servers and their state |
| `/status palworld` | Check a specific server |

## Architecture

```
Your friend types /start palworld in Discord
         │
         ▼
   ┌─────────────┐    type 5: "thinking..."    ┌──────────────┐
   │  API Gateway │ ◄──────────────────────── │ Handler Lambda│
   │  (webhook)   │                            │  (< 3 sec)   │
   └─────────────┘                            └──────┬───────┘
                                                      │ async invoke
                                                      ▼
                                              ┌──────────────┐
                                              │ Worker Lambda │
                                              │ (up to 3 min)│
                                              └──────┬───────┘
                                                      │
                                    ┌─────────────────┼──────────────────┐
                                    ▼                 ▼                  ▼
                              ECS RunTask      Wait for IP       Route 53 UPSERT
                                                                palworld.codercoco.com
                                    │                                    │
                                    └────────────────┬───────────────────┘
                                                     ▼
                                          Discord follow-up message:
                                    "palworld is online! Connect to:
                                     palworld.codercoco.com"
```

**Deferred responses:** The webhook handler responds to Discord instantly with
a "thinking..." indicator, then asynchronously invokes a worker Lambda. The
worker starts the Fargate task, polls until it has an IP, updates DNS, and
sends a follow-up message to Discord with the connection address.

**Auto-shutdown watchdog:** An EventBridge rule triggers a watchdog Lambda on a
configurable schedule. It checks network activity on each running server's ENI.
After a configurable number of consecutive idle checks, the server is
automatically stopped and DNS is cleaned up.

## Project Structure

```
game-server-bot/
├── main.tf                      # All infrastructure (VPC, ECS, EFS, Lambda, etc.)
├── lambda/
│   ├── handler.py               # Discord webhook handler (fast path)
│   └── requirements.txt         # PyNaCl for signature verification
├── lambda_worker/
│   └── worker.py                # Async worker (start/stop + DNS + Discord follow-up)
├── lambda_watchdog/
│   └── watchdog.py              # Auto-shutdown idle servers
└── scripts/
    └── register_commands.py     # One-time Discord slash command registration
```

## Full Setup Guide

### Prerequisites

Before you begin, make sure you have the following installed:

- **Terraform >= 1.5** — install from https://developer.hashicorp.com/terraform/install
  or via your package manager (`brew install terraform`, `choco install terraform`, etc.)
- **Python 3.12** — for running the command registration script and packaging the Lambda
- **AWS CLI v2** — configured with credentials that have admin access (or at minimum:
  ECS, EC2, EFS, Lambda, API Gateway, Route 53, IAM, CloudWatch, EventBridge permissions)
- **pip** — comes with Python, used to install the Lambda dependency

Verify your AWS credentials are working:
```bash
aws sts get-caller-identity
```

### Step 1: Create a Discord Application

1. Go to https://discord.com/developers/applications and click **New Application**
2. Give it a name (e.g. "Game Server Bot") and click **Create**
3. On the **General Information** page, copy these values — you'll need them later:
   - **Application ID** (also called Client ID)
   - **Public Key**
4. Click **Bot** in the left sidebar
5. Click **Reset Token** and copy the **Bot Token** (you won't see it again!)
6. Under **Privileged Gateway Intents**, you don't need to enable any
7. Click **OAuth2** in the left sidebar, then **URL Generator**
8. Under **Scopes**, check `bot` and `applications.commands`
9. Under **Bot Permissions**, you don't need any special permissions
10. Copy the generated URL at the bottom and open it in your browser
11. Select your Discord server and click **Authorize**

You should now see the bot appear (offline) in your server's member list.

Save these three values somewhere safe:
```
DISCORD_APP_ID=123456789012345678
DISCORD_BOT_TOKEN=MTIz...your-bot-token
DISCORD_PUBLIC_KEY=abcdef1234567890...your-public-key
```

### Step 2: Set Up Route 53 (if using DNS)

Skip this step if you don't want friendly DNS names (the bot will use raw IPs).

If your domain (e.g. `codercoco.com`) is already registered through Route 53,
you already have a hosted zone — find its ID in the Route 53 console under
**Hosted zones**.

If your domain is registered elsewhere (e.g. Namecheap, GoDaddy, Cloudflare):

1. Go to Route 53 in the AWS console and click **Create hosted zone**
2. Enter your domain name (e.g. `codercoco.com`) and click **Create**
3. Copy the **Hosted Zone ID** (looks like `Z1234567890ABC`)
4. Copy the 4 NS (nameserver) records shown in the hosted zone
5. Go to your domain registrar and update the nameservers to the 4 AWS values

**Warning:** Changing nameservers affects all DNS for your domain. If you already
have DNS records (email, website, etc.), add those to the Route 53 hosted zone
first before switching nameservers, or use a subdomain delegation instead.

Save the hosted zone ID:
```
HOSTED_ZONE_ID=Z1234567890ABC
```

### Step 3: Package the Lambda Dependencies

The Discord bot requires PyNaCl for signature verification. This is a compiled
C library that must be built for Lambda's Linux x86_64 runtime — you can't
just zip up what pip installs on your Mac or Windows machine.

```bash
cd game-server-bot

# Install PyNaCl compiled for Lambda's runtime into the lambda/ directory
pip install -r lambda/requirements.txt \
    -t lambda/ \
    --platform manylinux2014_x86_64 \
    --only-binary=:all: \
    --python-version 3.12
```

This downloads pre-compiled Linux binaries into the `lambda/` folder alongside
`handler.py`. Terraform will zip this directory automatically.

**Troubleshooting:** If pip complains about `--platform`, make sure you're using
pip >= 23.1. Upgrade with `pip install --upgrade pip`. If you still have issues,
you can build inside Docker instead:

```bash
docker run --rm -v "$PWD/lambda:/out" python:3.12 \
    pip install PyNaCl==1.5.0 -t /out --no-cache-dir
```

### Step 4: Deploy with Terraform

Initialize Terraform and deploy:

```bash
cd game-server-bot
terraform init

# Deploy with DNS enabled
terraform apply \
    -var="discord_public_key=YOUR_PUBLIC_KEY_HERE" \
    -var="domain_name=codercoco.com" \
    -var="hosted_zone_id=Z1234567890ABC"

# Or deploy without DNS (bot will show raw IPs)
terraform apply \
    -var="discord_public_key=YOUR_PUBLIC_KEY_HERE"
```

Terraform will show you a plan of ~25 resources to create. Type `yes` to confirm.

When it finishes, it will print outputs including:
```
api_gateway_url = "https://abc123.execute-api.us-east-1.amazonaws.com/interactions"
```

Copy this URL — you need it for the next step.

**Note:** The first `terraform apply` takes 2-3 minutes. Subsequent applies
(e.g. when adding games or changing config) are much faster.

### Step 5: Connect Discord to Your Webhook

1. Go back to https://discord.com/developers/applications
2. Click your application
3. Click **General Information** in the left sidebar
4. Scroll down to **Interactions Endpoint URL**
5. Paste the `api_gateway_url` output from Terraform
6. Click **Save Changes**

Discord will send a PING to verify the endpoint. If it fails:
- Make sure you copied the full URL including `/interactions`
- Check that the Lambda deployed correctly: `aws lambda invoke --function-name game-server-discord-bot /dev/null`
- Check CloudWatch Logs for the Lambda function for errors

### Step 6: Register Slash Commands

```bash
export DISCORD_APP_ID="123456789012345678"
export DISCORD_BOT_TOKEN="MTIz...your-bot-token"

pip install requests  # if not already installed
python scripts/register_commands.py
```

You should see:
```
Registered 3 commands successfully.
  /start
  /stop
  /status
```

**Note:** Global commands can take up to 1 hour to appear in all servers.
For instant registration during development, you can modify the script to use
guild commands instead (replace the URL with
`https://discord.com/api/v10/applications/{APP_ID}/guilds/{GUILD_ID}/commands`).

### Step 7: Test It

In your Discord server, type:
```
/status
```

You should see a response listing all game servers as offline. Then try:
```
/start palworld
```

You'll see a "thinking..." indicator, followed by a message with the connection
address once the server is ready (~30-60 seconds).

## Configuration Reference

### Required Variables

| Variable | Description |
|----------|-------------|
| `discord_public_key` | Discord application public key (from Developer Portal) |

### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `aws_region` | `us-east-1` | AWS region to deploy into |
| `domain_name` | `""` | Your domain (e.g. `codercoco.com`). Leave empty to use raw IPs |
| `hosted_zone_id` | `""` | Route 53 hosted zone ID. Leave empty to skip DNS |

### Tuning Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `watchdog_interval_minutes` | `15` | How often the watchdog checks for idle servers |
| `watchdog_idle_checks` | `4` | Consecutive idle checks before auto-shutdown |
| `watchdog_min_packets` | `100` | Minimum inbound packets per check interval to count as "active" |
| `worker_startup_timeout` | `120` | Max seconds to wait for a Fargate task to reach RUNNING |
| `worker_poll_interval` | `5` | Seconds between polls when waiting for task startup |

With defaults, the auto-shutdown grace period is
`watchdog_interval_minutes × watchdog_idle_checks = 15 × 4 = 60 minutes`.

#### Testing Configuration

For faster feedback during development and testing:

```bash
terraform apply \
    -var="discord_public_key=YOUR_KEY" \
    -var="domain_name=codercoco.com" \
    -var="hosted_zone_id=Z1234..." \
    -var="watchdog_interval_minutes=2" \
    -var="watchdog_idle_checks=2" \
    -var="watchdog_min_packets=10" \
    -var="worker_startup_timeout=30" \
    -var="worker_poll_interval=2"
```

This gives you a watchdog that checks every 2 minutes and shuts down after
4 minutes of idle, and a worker that gives up waiting after 30 seconds.

### Game Server Defaults

The `game_servers` variable in `main.tf` defines each game's container config.
The defaults ship with Palworld and Satisfactory:

| Game | Image | CPU | Memory | Ports |
|------|-------|-----|--------|-------|
| Palworld | `thijsvanloef/palworld-server-docker` | 2 vCPU | 8 GB | 8211/udp, 27015/udp |
| Satisfactory | `wolveix/satisfactory-server` | 2 vCPU | 8 GB | 7777/udp, 15000/udp, 15777/udp |

## Adding a New Game

1. Add the game to the `game_servers` variable in `main.tf`:

```hcl
minecraft = {
  image  = "itzg/minecraft-server:latest"
  cpu    = 2048
  memory = 4096
  ports  = [{ container = 25565, protocol = "tcp" }]
  environment = [
    { name = "EULA", value = "TRUE" },
    { name = "TYPE", value = "PAPER" },
  ]
  efs_path = "/data"
}
```

2. Add the choice to `scripts/register_commands.py`:
```python
{"name": "Minecraft", "value": "minecraft"},
```

3. Add the env var in `main.tf` for each Lambda's environment block
   (handler, worker, and watchdog):
```hcl
TASK_DEF_MINECRAFT = "${aws_ecs_task_definition.game["minecraft"].family}"
```

4. Add the mapping in `lambda/handler.py`, `lambda_worker/worker.py`,
   and `lambda_watchdog/watchdog.py`:
```python
"minecraft": os.environ.get("TASK_DEF_MINECRAFT", "minecraft-server"),
```

5. Deploy and register:
```bash
terraform apply -var="discord_public_key=YOUR_KEY" ...
python scripts/register_commands.py
```

## Cost Estimate

| Component | Cost |
|-----------|------|
| Fargate (2 vCPU, 8GB, running) | ~$0.11/hr |
| Fargate (stopped) | $0.00 |
| EFS (game saves, ~1GB) | ~$0.30/mo |
| Lambda + API Gateway | ~$0.00 (free tier) |
| Route 53 hosted zone | $0.50/mo |
| **20hrs/week gaming** | **~$10/mo per game** |
| **Idle month** | **~$0.80 total** |

## Tearing Down

To destroy all infrastructure and stop all costs:

```bash
terraform destroy -var="discord_public_key=YOUR_KEY"
```

This removes everything except the EFS file system if it still has data.
Your game saves will be lost once EFS is deleted — back them up first if needed.

## Troubleshooting

**Discord says "Interactions Endpoint URL" is invalid:**
- Make sure the URL ends with `/interactions`
- Check that `terraform apply` completed without errors
- Test the Lambda directly: `aws lambda invoke --function-name game-server-discord-bot /dev/null`
- Check CloudWatch Logs: `/aws/lambda/game-server-discord-bot`

**Bot responds but server never comes online:**
- Check CloudWatch Logs for the worker: `/aws/lambda/game-server-worker`
- Verify the Docker image exists and is pullable
- Check that the security group allows outbound traffic (for image pulls)
- Try increasing `worker_startup_timeout` — some images are large

**Server starts but friends can't connect:**
- Check that the security group has the correct ports open for your game
- If using DNS, wait 60 seconds for the TTL to propagate
- Try connecting by raw IP first (use `/status` to get it)
- Make sure your friends' game clients are using the right port

**Watchdog isn't shutting down idle servers:**
- CloudWatch `NetworkPacketsIn` metrics require the ENI to report them;
  check that metrics are appearing in CloudWatch for your task's ENI
- Lower `watchdog_min_packets` — some games send very little idle traffic
- Check watchdog logs: `/aws/lambda/game-server-watchdog`

**Slash commands don't appear in Discord:**
- Global commands take up to 1 hour to propagate
- For instant results, use guild commands (see Step 6 note above)
- Make sure `register_commands.py` printed success
- Verify the bot was invited with the `applications.commands` scope

## Notes

- **Fargate assigns a new public IP each launch.** The DNS record updates
  automatically, but with a 60-second TTL there may be a brief delay on the
  first connection after a fresh start.
- **The watchdog uses CloudWatch `NetworkPacketsIn` metrics** on the task's
  ENI. If metrics aren't available, it falls back to assuming the server is
  active (safe default). You may need to tune `watchdog_min_packets` for
  games with chatty keepalive traffic.
- **Security groups allow game ports from `0.0.0.0/0`** by default. This is
  standard for game servers your friends connect to, but be aware of it.
- **Discord interaction tokens expire after 15 minutes.** The worker Lambda
  has plenty of time (default 2-minute timeout + 1-minute buffer), but if
  you set `worker_startup_timeout` very high, the follow-up message may fail.
