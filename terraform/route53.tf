# ──────────────────────────────────────────────────────────────────────────────
# Route 53 — auto-updates {game}.codercoco.com when Fargate tasks start/stop
#
# Architecture:
#   ECS Task State Change (RUNNING/STOPPED)
#     → EventBridge rule
#       → DNS Updater Lambda
#         → Route 53 UPSERT (on RUNNING) or DELETE (on STOPPED)
#
# One DNS record per game, managed entirely by the Lambda.
# Records are NOT managed by Terraform (lifecycle ignore_changes would fight
# the Lambda). The Lambda creates/removes them dynamically.
# ──────────────────────────────────────────────────────────────────────────────

# Look up the existing hosted zone
data "aws_route53_zone" "main" {
  name         = var.hosted_zone_name
  private_zone = false
}

# ── DNS Updater Lambda ────────────────────────────────────────────────────────

data "archive_file" "dns_updater" {
  type        = "zip"
  source_file = "${path.module}/lambda/update_dns.py"
  output_path = "${path.module}/lambda/update_dns.zip"
}

resource "aws_lambda_function" "dns_updater" {
  function_name    = "${var.project_name}-dns-updater"
  role             = aws_iam_role.lambda.arn
  handler          = "update_dns.handler"
  runtime          = "python3.12"
  filename         = data.archive_file.dns_updater.output_path
  source_code_hash = data.archive_file.dns_updater.output_base64sha256
  timeout          = 30

  environment {
    variables = {
      HOSTED_ZONE_ID    = data.aws_route53_zone.main.zone_id
      DOMAIN_NAME       = var.hosted_zone_name
      GAME_NAMES        = join(",", keys(var.game_servers))
      DNS_TTL           = tostring(var.dns_ttl)
      AWS_REGION_       = var.aws_region
      HTTPS_GAMES       = join(",", keys(local.https_games))
      ALB_TARGET_GROUPS = jsonencode({ for name, _ in local.https_games : name => aws_lb_target_group.game[name].arn })
    }
  }

  tags = { Name = "${var.project_name}-dns-updater" }

  depends_on = [aws_iam_role_policy.lambda]
}

resource "aws_cloudwatch_log_group" "dns_updater" {
  name              = "/aws/lambda/${var.project_name}-dns-updater"
  retention_in_days = 7
  tags              = { Name = "${var.project_name}-dns-updater-logs" }
}

# ── EventBridge rule — ECS task state changes ─────────────────────────────────

resource "aws_cloudwatch_event_rule" "ecs_task_change" {
  name        = "${var.project_name}-task-state-change"
  description = "Triggers DNS update when any game server task starts or stops"

  event_pattern = jsonencode({
    source        = ["aws.ecs"]
    "detail-type" = ["ECS Task State Change"]
    detail = {
      clusterArn = [aws_ecs_cluster.main.arn]
      lastStatus = ["RUNNING", "STOPPED"]
    }
  })
}

resource "aws_cloudwatch_event_target" "dns_updater" {
  rule      = aws_cloudwatch_event_rule.ecs_task_change.name
  target_id = "GameServerDnsUpdater"
  arn       = aws_lambda_function.dns_updater.arn
}

resource "aws_lambda_permission" "dns_updater_eventbridge" {
  statement_id  = "AllowDnsUpdaterEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.dns_updater.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.ecs_task_change.arn
}

# ── Outputs ───────────────────────────────────────────────────────────────────

output "dns_records" {
  description = "DNS hostnames for each game server (active when server is running)"
  value       = { for game, _ in var.game_servers : game => "${game}.${var.hosted_zone_name}" }
}
