import type { Answers } from '../types.js';

/**
 * Skeleton tfvars derived from the public terraform.tfvars.example shape. We
 * fill in the few things we just asked the user about and leave the rest as
 * commented examples.
 */
export function renderTfvars(a: Answers): string {
  const discordBlock =
    a.configureDiscord && a.discordApplicationId && a.discordBotToken && a.discordPublicKey
      ? `discord_application_id = "${a.discordApplicationId}"
discord_bot_token      = "${a.discordBotToken}"
discord_public_key     = "${a.discordPublicKey}"
`
      : `# discord_application_id = "1234567890"
# discord_bot_token      = "MTIz...xyz"
# discord_public_key     = "0123abc..."
`;

  return `# ${a.projectName} — Terraform variables.
# Commit this file to your private parent repo. The wrapper Makefile copies it
# into ${a.submoduleDir}/terraform/terraform.tfvars on every plan/apply, where
# the submodule's own .gitignore prevents it from being committed back.

aws_region   = "${a.awsRegion}"
project_name = "${a.projectName}"

# Hosted zone in Route 53. {game}.${a.hostedZone} records are managed by Lambda.
hosted_zone_name = "${a.hostedZone}"

# Watchdog: auto-shuts down idle servers after (interval × idle_checks) minutes.
watchdog_interval_minutes = 15
watchdog_idle_checks      = 4
watchdog_min_packets      = 100

# acm_certificate_domain = "*.${a.hostedZone}"

# Discord bot credentials (optional — leave commented out to configure via the web UI).
${discordBlock}
# base_allowed_guilds  = ["123456789012345678"]
# base_admin_user_ids  = ["987654321098765432"]
# base_admin_role_ids  = []

# Game server definitions. See ${a.submoduleDir}/terraform/terraform.tfvars.example
# for the full schema.
game_servers = {
  # palworld = {
  #   image  = "thijsvanloef/palworld-server-docker:latest"
  #   cpu    = 2048
  #   memory = 8192
  #   ports = [
  #     { container = 8211,  protocol = "udp" },
  #     { container = 27015, protocol = "udp" },
  #   ]
  #   environment = [
  #     { name = "PLAYERS",     value = "8" },
  #     { name = "SERVER_NAME", value = "My Palworld Server" },
  #   ]
  #   volumes = [
  #     { name = "saves", container_path = "/palworld" },
  #   ]
  #   https = false
  # }
}
`;
}
