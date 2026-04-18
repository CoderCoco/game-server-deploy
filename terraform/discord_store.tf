# ──────────────────────────────────────────────────────────────────────────────
# Discord serverless backing stores
#
# - DynamoDB: pay-per-request table holding two item types:
#     pk = "CONFIG#discord", sk = "CONFIG"        → DiscordConfig JSON
#     pk = "PENDING#{taskArn}", sk = "PENDING"    → pending interaction (TTL)
# - Secrets Manager: bot token (used by the Nest app to register guild
#   commands) and the Ed25519 application public key (used by the
#   InteractionsLambda for request signature verification).
#
# Secret values are seeded with a placeholder so the secret has a version on
# first apply; the web UI (or `aws secretsmanager put-secret-value`) writes the
# real value later. Terraform ignores subsequent drift via lifecycle.
# ──────────────────────────────────────────────────────────────────────────────

resource "aws_dynamodb_table" "discord" {
  name         = "${var.project_name}-discord"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = false
  }

  tags = { Name = "${var.project_name}-discord" }
}

resource "aws_secretsmanager_secret" "discord_bot_token" {
  name        = "${var.project_name}/discord/bot-token"
  description = "Discord bot token — used by the management app to register guild slash commands"
}

resource "aws_secretsmanager_secret_version" "discord_bot_token" {
  secret_id     = aws_secretsmanager_secret.discord_bot_token.id
  secret_string = "placeholder"

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "discord_public_key" {
  name        = "${var.project_name}/discord/public-key"
  description = "Discord application Ed25519 public key — used by InteractionsLambda for signature verification"
}

resource "aws_secretsmanager_secret_version" "discord_public_key" {
  secret_id     = aws_secretsmanager_secret.discord_public_key.id
  secret_string = "placeholder"

  lifecycle {
    ignore_changes = [secret_string]
  }
}
