variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
  default     = "game-servers"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

# ── Game server definitions ──────────────────────────────────────────────────
# Each entry creates its own ECS task definition, EFS access point, log group,
# and security group rules. Add new games here without touching anything else.

variable "game_servers" {
  description = "Map of game name → container config"
  type = map(object({
    image       = string
    cpu         = number  # Fargate CPU units (1024 = 1 vCPU)
    memory      = number  # MiB
    ports       = list(object({ container = number, protocol = string }))
    environment = optional(list(object({ name = string, value = string })), [])
    volumes     = list(object({ name = string, container_path = string }))
    https       = optional(bool, false) # If true, traffic is routed through ALB with TLS termination
  }))

  default = {
    palworld = {
      image  = "thijsvanloef/palworld-server-docker:latest"
      cpu    = 2048
      memory = 8192
      ports = [
        { container = 8211,  protocol = "udp" },
        { container = 27015, protocol = "udp" }, # Steam query port
      ]
      environment = [
        { name = "PLAYERS",           value = "16" },
        { name = "MULTITHREADING",    value = "true" },
        { name = "RCON_ENABLED",      value = "true" },
        { name = "RCON_PORT",         value = "25575" },
        { name = "ADMIN_PASSWORD",    value = "changeme_please" },
        { name = "SERVER_NAME",       value = "Palworld Server" },
        { name = "UPDATE_ON_BOOT",    value = "true" },
        { name = "BACKUP_ENABLED",    value = "true" },
        { name = "BACKUP_CRON_EXPRESSION", value = "0 */6 * * *" },
        { name = "DIFFICULTY",        value = "Normal" },
      ]
      volumes = [
        { name = "saves", container_path = "/palworld" },
      ]
      https = false
    }

    satisfactory = {
      image  = "wolveix/satisfactory-server:latest"
      cpu    = 2048
      memory = 8192
      ports = [
        { container = 7777,  protocol = "udp" },
        { container = 15000, protocol = "udp" },
        { container = 15777, protocol = "udp" },
      ]
      environment = [
        { name = "MAXPLAYERS", value = "4" },
        { name = "PGID",       value = "1000" },
        { name = "PUID",       value = "1000" },
      ]
      volumes = [
        { name = "config", container_path = "/config" },
      ]
      https = false
    }

    foundryvtt = {
      image  = "felddy/foundryvtt:release"
      cpu    = 1024
      memory = 2048
      ports = [
        { container = 30000, protocol = "tcp" },
      ]
      environment = [
        { name = "FOUNDRY_PROXY_SSL",  value = "true" },
        { name = "FOUNDRY_PROXY_PORT", value = "443" },
        { name = "CONTAINER_VERBOSE",  value = "true" },
      ]
      volumes = [
        { name = "data", container_path = "/data" },
      ]
      https = true
    }
  }
}

# ── HTTPS / ALB ─────────────────────────────────────────────────────────────

variable "acm_certificate_domain" {
  description = "Domain for the ACM TLS certificate used by the ALB (e.g. *.codercoco.com)"
  type        = string
  default     = null # When null, defaults to *.{hosted_zone_name}
}

# ── Watchdog tuning ──────────────────────────────────────────────────────────

variable "watchdog_interval_minutes" {
  description = "How often the watchdog checks for idle servers (minutes)"
  type        = number
  default     = 15
}

variable "watchdog_idle_checks" {
  description = "Consecutive idle checks before auto-shutdown (total idle time = interval × checks)"
  type        = number
  default     = 4
}

variable "watchdog_min_packets" {
  description = "Minimum inbound packets per check interval to consider a server active"
  type        = number
  default     = 100
}

# ── DNS ──────────────────────────────────────────────────────────────────────

variable "hosted_zone_name" {
  description = "Route 53 hosted zone domain (must already exist)"
  type        = string
  default     = "codercoco.com"
}

variable "dns_ttl" {
  description = "TTL in seconds for DNS A records — keep low so updates propagate fast"
  type        = number
  default     = 30
}

# ── Discord base allowlist / admins (optional) ───────────────────────────────
# These lists are Terraform-managed and written to a separate DynamoDB row
# (BASE#discord) on every `terraform apply`. They form an immutable floor that
# the management UI can never remove — operators can only add/remove entries
# they themselves added via the UI.
#
# Leave all three empty (the default) to manage everything through the UI.
# Edit the lists in terraform.tfvars and re-apply to change the base set.

variable "base_allowed_guilds" {
  description = "Guild IDs permanently allowlisted by Terraform. Cannot be removed via the management UI."
  type        = list(string)
  default     = []
}

variable "base_admin_user_ids" {
  description = "Discord user IDs with permanent server-wide admin privileges. Cannot be removed via the management UI."
  type        = list(string)
  default     = []
}

variable "base_admin_role_ids" {
  description = "Discord role IDs with permanent server-wide admin privileges. Cannot be removed via the management UI."
  type        = list(string)
  default     = []
}

# ── Discord bot credentials (optional) ───────────────────────────────────────
# If set, these seed the AWS Secrets Manager secrets on first `terraform apply`
# so the bot is fully configured without touching the web UI. Leave empty to
# seed the secrets with a placeholder value and enter credentials via the
# Credentials tab in the management app instead.
#
# After the first apply, Terraform no longer touches `secret_string`
# (`ignore_changes = [secret_string]` in discord_store.tf) so edits made via
# the web UI won't be overwritten on subsequent applies. To rotate a value
# via Terraform after initial provisioning, update the variable and run
# `terraform taint aws_secretsmanager_secret_version.<name>` first.
#
# terraform.tfvars is gitignored, so it's safe to put these values there.

variable "discord_application_id" {
  description = "Discord application (client) ID — public value, goes to DynamoDB. Optional; empty to configure via UI."
  type        = string
  default     = ""
}

variable "discord_bot_token" {
  description = "Discord bot token (from Developer Portal → your app → Bot). Optional; empty to configure via UI."
  type        = string
  default     = ""
  sensitive   = true
}

variable "discord_public_key" {
  description = "Discord application Ed25519 public key (from General Information). Optional; empty to configure via UI."
  type        = string
  default     = ""
  sensitive   = true
}

# ── Tags ─────────────────────────────────────────────────────────────────────

variable "tags" {
  description = "Common tags applied to all resources"
  type        = map(string)
  default = {
    Project     = "game-servers-poc"
    Environment = "poc"
    ManagedBy   = "terraform"
  }
}
