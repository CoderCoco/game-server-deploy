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
# Secret values default to a "placeholder" string so the secret has a version
# on first apply; operators can either (a) set `discord_bot_token` and
# `discord_public_key` in tfvars to seed with real values up-front, or (b)
# leave them empty and enter credentials through the Credentials tab in the
# web UI. The shared secretsStore treats "placeholder" and empty strings as
# "not configured", so either path is safe.
#
# `ignore_changes = [secret_string]` below means Terraform only writes the
# secret on initial creation. Subsequent UI edits (or rotations done via
# `aws secretsmanager put-secret-value`) aren't reverted on re-apply.
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
  secret_string = var.discord_bot_token != "" ? var.discord_bot_token : "placeholder"

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
  secret_string = var.discord_public_key != "" ? var.discord_public_key : "placeholder"

  lifecycle {
    ignore_changes = [secret_string]
  }
}
