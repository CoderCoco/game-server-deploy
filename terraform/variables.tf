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
    efs_path    = string  # Mount path inside the container
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
      efs_path = "/palworld"
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
      efs_path = "/config"
    }
  }
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
