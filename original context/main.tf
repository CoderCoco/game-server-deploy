# ============================================================================
# Game Server Infrastructure — ECS Fargate + EFS + Discord Bot
# ============================================================================
#
# Deploy with:
#   terraform init
#   terraform apply -var="discord_public_key=YOUR_KEY"
#
# Then register Discord commands:
#   python scripts/register_commands.py
#
# And set your Discord app's Interactions Endpoint URL to the
# api_gateway_url output from this terraform.
# ============================================================================

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

provider "aws" {
  region = var.aws_region
}

# ── Variables ───────────────────────────────────────────────────────────────

variable "aws_region" {
  default = "us-east-1"
}

variable "discord_public_key" {
  description = "Discord application public key (from Developer Portal)"
  type        = string
  sensitive   = true
}

variable "domain_name" {
  description = "Your domain name (e.g. codercoco.com). Must have a Route 53 hosted zone."
  type        = string
  default     = ""
}

variable "hosted_zone_id" {
  description = "Route 53 hosted zone ID for your domain. Leave empty to skip DNS."
  type        = string
  default     = ""
}

# ── Tuning knobs ────────────────────────────────────────────────────────────

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

variable "worker_startup_timeout" {
  description = "Max seconds the worker waits for a Fargate task to reach RUNNING state"
  type        = number
  default     = 120
}

variable "worker_poll_interval" {
  description = "Seconds between polls when waiting for a Fargate task to start"
  type        = number
  default     = 5
}

variable "game_servers" {
  description = "Map of game name → container config"
  type = map(object({
    image  = string
    cpu    = number   # in Fargate CPU units (1024 = 1 vCPU)
    memory = number   # in MB
    ports  = list(object({ container = number, protocol = string }))
    environment = optional(list(object({ name = string, value = string })), [])
    efs_path    = string  # path inside the container to mount saves
  }))
  default = {
    palworld = {
      image  = "thijsvanloef/palworld-server-docker:latest"
      cpu    = 2048
      memory = 8192
      ports  = [
        { container = 8211, protocol = "udp" },
        { container = 27015, protocol = "udp" },
      ]
      environment = [
        { name = "PLAYERS", value = "16" },
        { name = "MULTITHREADING", value = "true" },
      ]
      efs_path = "/palworld"
    }
    satisfactory = {
      image  = "wolveix/satisfactory-server:latest"
      cpu    = 2048
      memory = 8192
      ports  = [
        { container = 7777, protocol = "udp" },
        { container = 15000, protocol = "udp" },
        { container = 15777, protocol = "udp" },
      ]
      efs_path = "/config"
    }
  }
}

# ── Data sources ────────────────────────────────────────────────────────────

data "aws_availability_zones" "available" {
  state = "available"
}

# ── VPC ─────────────────────────────────────────────────────────────────────

resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags = { Name = "game-servers-vpc" }
}

resource "aws_internet_gateway" "gw" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "game-servers-igw" }
}

resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true
  tags = { Name = "game-servers-public-${count.index}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.gw.id
  }
}

resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# ── Security groups ─────────────────────────────────────────────────────────

resource "aws_security_group" "game_servers" {
  name_prefix = "game-servers-"
  vpc_id      = aws_vpc.main.id

  # Allow all game ports inbound (each game defines its own ports)
  dynamic "ingress" {
    for_each = { for pair in flatten([
      for name, cfg in var.game_servers : [
        for p in cfg.ports : { key = "${name}-${p.container}-${p.protocol}", port = p.container, proto = p.protocol }
      ]
    ]) : pair.key => pair }
    content {
      from_port   = ingress.value.port
      to_port     = ingress.value.port
      protocol    = ingress.value.proto
      cidr_blocks = ["0.0.0.0/0"]
    }
  }

  # Allow all outbound (for pulling images, updates, etc.)
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "game-servers-sg" }
}

resource "aws_security_group" "efs" {
  name_prefix = "game-servers-efs-"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 2049
    to_port         = 2049
    protocol        = "tcp"
    security_groups = [aws_security_group.game_servers.id]
  }

  tags = { Name = "game-servers-efs-sg" }
}

# ── EFS (persistent game saves) ────────────────────────────────────────────

resource "aws_efs_file_system" "saves" {
  creation_token = "game-server-saves"
  encrypted      = true
  tags           = { Name = "game-server-saves" }
}

resource "aws_efs_mount_target" "saves" {
  count           = 2
  file_system_id  = aws_efs_file_system.saves.id
  subnet_id       = aws_subnet.public[count.index].id
  security_groups = [aws_security_group.efs.id]
}

# One access point per game — isolates save directories
resource "aws_efs_access_point" "game" {
  for_each       = var.game_servers
  file_system_id = aws_efs_file_system.saves.id

  posix_user {
    uid = 1000
    gid = 1000
  }

  root_directory {
    path = "/${each.key}"
    creation_info {
      owner_uid   = 1000
      owner_gid   = 1000
      permissions = "0755"
    }
  }

  tags = { Name = "${each.key}-saves" }
}

# ── ECS cluster + task definitions ──────────────────────────────────────────

resource "aws_ecs_cluster" "games" {
  name = "game-servers"
}

resource "aws_cloudwatch_log_group" "game" {
  for_each          = var.game_servers
  name              = "/ecs/${each.key}-server"
  retention_in_days = 7
}

resource "aws_iam_role" "ecs_task_execution" {
  name = "game-servers-task-execution"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_ecs_task_definition" "game" {
  for_each = var.game_servers

  family                   = "${each.key}-server"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = each.value.cpu
  memory                   = each.value.memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn

  volume {
    name = "${each.key}-saves"
    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.saves.id
      transit_encryption = "ENABLED"
      authorization_configuration {
        access_point_id = aws_efs_access_point.game[each.key].id
        iam             = "DISABLED"
      }
    }
  }

  container_definitions = jsonencode([{
    name      = each.key
    image     = each.value.image
    essential = true

    portMappings = [for p in each.value.ports : {
      containerPort = p.container
      hostPort      = p.container
      protocol      = p.protocol
    }]

    environment = each.value.environment

    mountPoints = [{
      sourceVolume  = "${each.key}-saves"
      containerPath = each.value.efs_path
      readOnly      = false
    }]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.game[each.key].name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "ecs"
      }
    }
  }])

  tags = { Name = "${each.key}-server" }
}

# ── Lambda (Discord bot backend) ───────────────────────────────────────────

resource "aws_iam_role" "lambda" {
  name = "game-server-bot-lambda"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "lambda_ecs" {
  name = "ecs-management"
  role = aws_iam_role.lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecs:RunTask",
          "ecs:StopTask",
          "ecs:ListTasks",
          "ecs:DescribeTasks",
        ]
        Resource = "*"
        Condition = {
          StringEquals = { "ecs:cluster" = aws_ecs_cluster.games.arn }
        }
      },
      {
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = aws_iam_role.ecs_task_execution.arn
      },
      {
        Effect   = "Allow"
        Action   = ["ec2:DescribeNetworkInterfaces"]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = "arn:aws:logs:*:*:*"
      },
      {
        Effect = "Allow"
        Action = [
          "route53:ChangeResourceRecordSets",
          "route53:ListResourceRecordSets",
        ]
        Resource = var.hosted_zone_id != "" ? "arn:aws:route53:::hostedzone/${var.hosted_zone_id}" : "*"
      },
      {
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = aws_lambda_function.worker.arn
      },
      {
        Effect = "Allow"
        Action = ["ecs:TagResource", "ecs:ListTagsForResource"]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = ["cloudwatch:GetMetricStatistics"]
        Resource = "*"
      },
    ]
  })
}

# Package the Lambda (you'd use a proper build step in CI;
# this assumes the zip is pre-built with PyNaCl included)
data "archive_file" "lambda" {
  type        = "zip"
  source_dir  = "${path.module}/lambda"
  output_path = "${path.module}/lambda.zip"
}

resource "aws_lambda_function" "bot" {
  function_name    = "game-server-discord-bot"
  role             = aws_iam_role.lambda.arn
  handler          = "handler.lambda_handler"
  runtime          = "python3.12"
  timeout          = 30
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256

  environment {
    variables = {
      DISCORD_PUBLIC_KEY    = var.discord_public_key
      WORKER_FUNCTION_NAME  = "game-server-worker"
      ECS_CLUSTER           = aws_ecs_cluster.games.name
      SUBNETS               = join(",", aws_subnet.public[*].id)
      SECURITY_GROUP        = aws_security_group.game_servers.id
      TASK_DEF_PALWORLD     = "${aws_ecs_task_definition.game["palworld"].family}"
      TASK_DEF_SATISFACTORY = "${aws_ecs_task_definition.game["satisfactory"].family}"
      HOSTED_ZONE_ID        = var.hosted_zone_id
      DOMAIN_NAME           = var.domain_name
    }
  }
}

# ── API Gateway (webhook endpoint for Discord) ─────────────────────────────

resource "aws_apigatewayv2_api" "bot" {
  name          = "game-server-bot"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_stage" "bot" {
  api_id      = aws_apigatewayv2_api.bot.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_apigatewayv2_integration" "bot" {
  api_id                 = aws_apigatewayv2_api.bot.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.bot.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "bot" {
  api_id    = aws_apigatewayv2_api.bot.id
  route_key = "POST /interactions"
  target    = "integrations/${aws_apigatewayv2_integration.bot.id}"
}

resource "aws_lambda_permission" "apigw" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.bot.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.bot.execution_arn}/*/*"
}

# ── Worker Lambda (async start/stop with Discord follow-up) ────────────────

data "archive_file" "worker" {
  type        = "zip"
  source_dir  = "${path.module}/lambda_worker"
  output_path = "${path.module}/lambda_worker.zip"
}

resource "aws_lambda_function" "worker" {
  function_name    = "game-server-worker"
  role             = aws_iam_role.lambda.arn
  handler          = "worker.lambda_handler"
  runtime          = "python3.12"
  timeout          = var.worker_startup_timeout + 60  # startup wait + buffer
  filename         = data.archive_file.worker.output_path
  source_code_hash = data.archive_file.worker.output_base64sha256

  environment {
    variables = {
      ECS_CLUSTER           = aws_ecs_cluster.games.name
      SUBNETS               = join(",", aws_subnet.public[*].id)
      SECURITY_GROUP        = aws_security_group.game_servers.id
      TASK_DEF_PALWORLD     = "${aws_ecs_task_definition.game["palworld"].family}"
      TASK_DEF_SATISFACTORY = "${aws_ecs_task_definition.game["satisfactory"].family}"
      HOSTED_ZONE_ID        = var.hosted_zone_id
      DOMAIN_NAME           = var.domain_name
      STARTUP_TIMEOUT       = tostring(var.worker_startup_timeout)
      POLL_INTERVAL         = tostring(var.worker_poll_interval)
    }
  }
}

# ── Watchdog Lambda (auto-shutdown idle servers) ───────────────────────────

data "archive_file" "watchdog" {
  type        = "zip"
  source_dir  = "${path.module}/lambda_watchdog"
  output_path = "${path.module}/lambda_watchdog.zip"
}

resource "aws_lambda_function" "watchdog" {
  function_name    = "game-server-watchdog"
  role             = aws_iam_role.lambda.arn
  handler          = "watchdog.lambda_handler"
  runtime          = "python3.12"
  timeout          = 60
  filename         = data.archive_file.watchdog.output_path
  source_code_hash = data.archive_file.watchdog.output_base64sha256

  environment {
    variables = {
      ECS_CLUSTER           = aws_ecs_cluster.games.name
      TASK_DEF_PALWORLD     = "${aws_ecs_task_definition.game["palworld"].family}"
      TASK_DEF_SATISFACTORY = "${aws_ecs_task_definition.game["satisfactory"].family}"
      HOSTED_ZONE_ID        = var.hosted_zone_id
      DOMAIN_NAME           = var.domain_name
      IDLE_CHECKS           = tostring(var.watchdog_idle_checks)
      MIN_PACKETS           = tostring(var.watchdog_min_packets)
      CHECK_WINDOW_MINUTES  = tostring(var.watchdog_interval_minutes)
    }
  }
}

# ── EventBridge schedule (runs watchdog on configured interval) ─────────────

resource "aws_cloudwatch_event_rule" "watchdog_schedule" {
  name                = "game-server-watchdog-schedule"
  description         = "Check for idle game servers every ${var.watchdog_interval_minutes} minutes"
  schedule_expression = "rate(${var.watchdog_interval_minutes} ${var.watchdog_interval_minutes == 1 ? "minute" : "minutes"})"
}

resource "aws_cloudwatch_event_target" "watchdog" {
  rule = aws_cloudwatch_event_rule.watchdog_schedule.name
  arn  = aws_lambda_function.watchdog.arn
}

resource "aws_lambda_permission" "watchdog_eventbridge" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.watchdog.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.watchdog_schedule.arn
}

# ── Outputs ─────────────────────────────────────────────────────────────────

output "api_gateway_url" {
  description = "Set this as your Discord Interactions Endpoint URL"
  value       = "${aws_apigatewayv2_stage.bot.invoke_url}/interactions"
}

output "ecs_cluster" {
  value = aws_ecs_cluster.games.name
}

output "efs_file_system_id" {
  value = aws_efs_file_system.saves.id
}
