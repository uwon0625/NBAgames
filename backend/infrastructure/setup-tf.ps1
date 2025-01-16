# Create terraform directory if it doesn't exist
New-Item -ItemType Directory -Force -Path "terraform"

# Change to terraform directory
Set-Location -Path "terraform"

# Create main configuration files
@'
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket = "nba-live-terraform-state"
    key    = "terraform.tfstate"
    region = "us-east-1"
  }
}

provider "aws" {
  region = var.aws_region
}

# Import existing VPC and subnets
data "aws_vpc" "existing" {
  id = var.vpc_id
}

data "aws_subnet" "existing" {
  count = 3
  id    = var.subnet_ids[count.index]
}
'@ | Set-Content -Path "main.tf"

@'
variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "dev"
}

variable "vpc_id" {
  description = "Existing VPC ID"
  type        = string
}

variable "subnet_ids" {
  description = "List of subnet IDs"
  type        = list(string)
}

variable "project_name" {
  description = "Project name for resource naming"
  type        = string
  default     = "nba-live"
}
'@ | Set-Content -Path "variables.tf"

@'
resource "aws_dynamodb_table" "games" {
  name           = "${var.project_name}-games-${var.environment}"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "gameId"
  stream_enabled = true

  attribute {
    name = "gameId"
    type = "S"
  }

  tags = {
    Environment = var.environment
    Project     = var.project_name
  }
}
'@ | Set-Content -Path "dynamodb.tf"

@'
resource "aws_msk_cluster" "nba_live" {
  cluster_name           = "${var.project_name}-kafka-${var.environment}"
  kafka_version          = "3.4.0"
  number_of_broker_nodes = 3

  broker_node_group_info {
    instance_type   = "kafka.t3.small"
    client_subnets  = var.subnet_ids
    security_groups = [aws_security_group.msk.id]
    storage_info {
      ebs_storage_info {
        volume_size = 100
      }
    }
  }

  encryption_info {
    encryption_in_transit {
      client_broker = "TLS"
      in_cluster    = true
    }
  }

  tags = {
    Environment = var.environment
    Project     = var.project_name
  }
}

resource "aws_security_group" "msk" {
  name        = "${var.project_name}-msk-sg-${var.environment}"
  description = "Security group for MSK cluster"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 9092
    to_port     = 9092
    protocol    = "tcp"
    cidr_blocks = [data.aws_vpc.existing.cidr_block]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
'@ | Set-Content -Path "msk.tf"

@'
resource "aws_elasticache_cluster" "nba_live" {
  cluster_id           = "${var.project_name}-redis-${var.environment}"
  engine              = "redis"
  node_type           = "cache.t3.micro"
  num_cache_nodes     = 1
  parameter_group_name = "default.redis7"
  port                = 6379
  security_group_ids  = [aws_security_group.redis.id]
  subnet_group_name   = aws_elasticache_subnet_group.nba_live.name

  tags = {
    Environment = var.environment
    Project     = var.project_name
  }
}

resource "aws_elasticache_subnet_group" "nba_live" {
  name       = "${var.project_name}-redis-subnet-${var.environment}"
  subnet_ids = var.subnet_ids
}

resource "aws_security_group" "redis" {
  name        = "${var.project_name}-redis-sg-${var.environment}"
  description = "Security group for Redis cluster"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 6379
    to_port     = 6379
    protocol    = "tcp"
    cidr_blocks = [data.aws_vpc.existing.cidr_block]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
'@ | Set-Content -Path "elasticache.tf"

@'
resource "aws_lambda_function" "game_update_handler" {
  filename         = "../backend/dist/lambdas/gameUpdateHandler.zip"
  function_name    = "${var.project_name}-gameUpdateHandler-${var.environment}"
  role            = aws_iam_role.lambda_role.arn
  handler         = "gameUpdateHandler.handler"
  runtime         = "nodejs18.x"
  timeout         = 30
  memory_size     = 256

  environment {
    variables = {
      KAFKA_BROKERS = aws_msk_cluster.nba_live.bootstrap_brokers
      KAFKA_TOPIC   = "nba-game-updates"
      NBA_BASE_URL  = "https://nba-prod-us-east-1-mediaops-stats.s3.amazonaws.com/NBA/liveData"
    }
  }

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = [aws_security_group.lambda.id]
  }
}

resource "aws_lambda_function" "box_score_handler" {
  filename         = "../backend/dist/lambdas/boxScoreHandler.zip"
  function_name    = "${var.project_name}-boxScoreHandler-${var.environment}"
  role            = aws_iam_role.lambda_role.arn
  handler         = "boxScoreHandler.handler"
  runtime         = "nodejs18.x"
  timeout         = 30
  memory_size     = 256

  environment {
    variables = {
      KAFKA_BROKERS = aws_msk_cluster.nba_live.bootstrap_brokers
      KAFKA_TOPIC   = "nba-boxscore-updates"
      NBA_BASE_URL  = "https://nba-prod-us-east-1-mediaops-stats.s3.amazonaws.com/NBA/liveData"
    }
  }

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = [aws_security_group.lambda.id]
  }
}

resource "aws_security_group" "lambda" {
  name        = "${var.project_name}-lambda-sg-${var.environment}"
  description = "Security group for Lambda functions"
  vpc_id      = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
'@ | Set-Content -Path "lambda.tf"

@'
resource "aws_apigatewayv2_api" "nba_live" {
  name          = "${var.project_name}-api-${var.environment}"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["Content-Type", "Authorization"]
    max_age      = 300
  }
}

resource "aws_apigatewayv2_stage" "nba_live" {
  api_id = aws_apigatewayv2_api.nba_live.id
  name   = var.environment
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_logs.arn
    format = jsonencode({
      requestId      = "$context.requestId"
      ip            = "$context.identity.sourceIp"
      requestTime   = "$context.requestTime"
      httpMethod    = "$context.httpMethod"
      routeKey      = "$context.routeKey"
      status        = "$context.status"
      protocol      = "$context.protocol"
      responseTime  = "$context.responseLatency"
    })
  }
}

resource "aws_cloudwatch_log_group" "api_logs" {
  name              = "/aws/apigateway/${var.project_name}-${var.environment}"
  retention_in_days = 7
}
'@ | Set-Content -Path "apigateway.tf"

@'
resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  for_each = {
    game_update = aws_lambda_function.game_update_handler
    box_score   = aws_lambda_function.box_score_handler
  }

  alarm_name          = "${each.value.function_name}-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name        = "Errors"
  namespace          = "AWS/Lambda"
  period             = "300"
  statistic          = "Sum"
  threshold          = "2"
  alarm_description  = "Lambda function error rate exceeded"
  alarm_actions      = []  # Add SNS topic ARN here if needed

  dimensions = {
    FunctionName = each.value.function_name
  }
}

resource "aws_cloudwatch_metric_alarm" "msk_broker_storage" {
  alarm_name          = "${var.project_name}-msk-storage-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name        = "KafkaDataLogsDiskUsed"
  namespace          = "AWS/Kafka"
  period             = "300"
  statistic          = "Average"
  threshold          = "85"
  alarm_description  = "MSK broker storage utilization exceeded 85%"
  alarm_actions      = []  # Add SNS topic ARN here if needed

  dimensions = {
    Cluster = aws_msk_cluster.nba_live.cluster_name
  }
}
'@ | Set-Content -Path "monitoring.tf"

@'
resource "aws_vpc_endpoint" "dynamodb" {
  vpc_id       = var.vpc_id
  service_name = "com.amazonaws.${var.aws_region}.dynamodb"
  vpc_endpoint_type = "Gateway"

  route_table_ids = [data.aws_vpc.existing.main_route_table_id]

  tags = {
    Environment = var.environment
    Project     = var.project_name
  }
}

resource "aws_vpc_endpoint" "s3" {
  vpc_id       = var.vpc_id
  service_name = "com.amazonaws.${var.aws_region}.s3"
  vpc_endpoint_type = "Gateway"

  route_table_ids = [data.aws_vpc.existing.main_route_table_id]

  tags = {
    Environment = var.environment
    Project     = var.project_name
  }
}
'@ | Set-Content -Path "vpc_endpoints.tf"

@'
output "api_endpoint" {
  value = aws_apigatewayv2_api.nba_live.api_endpoint
}

output "msk_brokers" {
  value = aws_msk_cluster.nba_live.bootstrap_brokers
  sensitive = true
}

output "redis_endpoint" {
  value = aws_elasticache_cluster.nba_live.cache_nodes[0].address
}

output "dynamodb_table_name" {
  value = aws_dynamodb_table.games.name
}

output "lambda_functions" {
  value = {
    game_update = aws_lambda_function.game_update_handler.function_name
    box_score   = aws_lambda_function.box_score_handler.function_name
  }
}
'@ | Set-Content -Path "outputs.tf"

@'
locals {
  common_tags = {
    Environment = var.environment
    Project     = var.project_name
    ManagedBy   = "terraform"
  }

  name_prefix = "${var.project_name}-${var.environment}"
}
'@ | Set-Content -Path "locals.tf"

@'
aws_region = "us-east-1"
environment = "dev"
project_name = "nba-live"

# Update these with your actual VPC and subnet IDs
vpc_id = "vpc-0bd427d9b382cdd97"
subnet_ids = [
  "subnet-0b4a9f3b51e0dc6d8",
  "subnet-07587fa8cfe65db3e", 
  "subnet-03c71501618fcf754"
]
'@ | Set-Content -Path "terraform.tfvars"

Write-Host "All Terraform configuration files have been created successfully."
Write-Host "Next steps:"
Write-Host "1. Review the generated files"
Write-Host "2. Update VPC and subnet IDs in terraform.tfvars with your actual values"
Write-Host "3. Run 'terraform init' to initialize"
Write-Host "4. Run 'terraform plan' to review changes"
