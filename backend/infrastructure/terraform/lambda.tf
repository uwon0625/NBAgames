locals {
  # Base egress rules that are always needed
  base_egress_rules = [
    {
      from_port   = 443
      to_port     = 443
      protocol    = "tcp"
      description = "HTTPS to internet"
      cidr_blocks = "0.0.0.0/0"
    },
    {
      from_port   = 80
      to_port     = 80
      protocol    = "tcp"
      description = "HTTP to internet"
      cidr_blocks = "0.0.0.0/0"
    }
  ]

  # MSK rules only if MSK is enabled
  msk_rules = var.use_msk ? [
    {
      from_port   = 9092
      to_port     = 9092
      protocol    = "tcp"
      description = "MSK access"
      cidr_blocks = data.aws_vpc.existing.cidr_block
    },
    {
      from_port   = 9098
      to_port     = 9098
      protocol    = "tcp"
      description = "MSK TLS access"
      cidr_blocks = data.aws_vpc.existing.cidr_block
    }
  ] : []

  # Redis rules only if ElastiCache is enabled
  elasticache_rules = var.use_elasticache ? [
    {
      from_port   = 6379
      to_port     = 6379
      protocol    = "tcp"
      description = "Redis access"
      cidr_blocks = data.aws_vpc.existing.cidr_block
    }
  ] : []

  # Combine all egress rules
  all_egress_rules = concat(local.base_egress_rules, local.msk_rules, local.elasticache_rules)
}

module "lambda_security_group" {
  source = "./modules/security_group"

  name        = "${var.project_name}-lambda-sg-${var.environment}"
  description = "Security group for Lambda functions"
  vpc_id      = var.vpc_id

  egress_rules = local.all_egress_rules

  tags = local.common_tags
}

# Lambda functions
resource "aws_lambda_function" "game_update_handler" {
  filename         = "../lambda/dist/lambdas/gameUpdateHandler.zip"
  function_name    = "${var.project_name}-game-update-${var.environment}"
  role            = aws_iam_role.lambda_role.arn
  handler         = "dist/lambdas/gameUpdateHandler.handler"
  runtime         = "nodejs18.x"
  timeout         = 30
  memory_size     = 256

  environment {
    variables = {
      ENVIRONMENT = var.environment
      SQS_QUEUE_URL = aws_sqs_queue.game_updates.url
      USE_MSK = tostring(var.use_msk)
      USE_SQS = "true"
      DYNAMODB_TABLE_NAME = aws_dynamodb_table.games.name
      USE_LOCAL_SERVICES = tostring(var.use_local_services)
      NBA_BASE_URL = "https://nba-prod-us-east-1-mediaops-stats.s3.amazonaws.com/NBA/liveData"
      NODE_ENV = var.environment
      KAFKA_TOPIC = "nba-game-updates"
      KAFKA_BROKERS = var.use_msk ? join(",", local.msk_brokers) : var.kafka_brokers
      DEBUG_RAW_MSK = jsonencode({
        enabled = var.use_msk
        brokers = var.use_msk ? local.msk_brokers : []
        clientId = var.kafka_client_id
        groupId = var.kafka_group_id
      })
    }
  }

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = [module.lambda_security_group.security_group_id]
  }

  depends_on = [
    aws_iam_role_policy.lambda_policy,
    aws_iam_role_policy_attachment.lambda_basic,
    aws_iam_role_policy_attachment.lambda_vpc,
    aws_cloudwatch_log_group.game_update_handler
  ]

  tags = {
    Environment = var.environment
    Project     = var.project_name
  }
}

resource "aws_lambda_function" "box_score_handler" {
  filename         = "../lambda/dist/lambdas/boxScoreHandler.zip"
  function_name    = "${var.project_name}-box-score-${var.environment}"
  role            = aws_iam_role.lambda_role.arn
  handler         = "dist/lambdas/boxScoreHandler.handler"
  runtime         = "nodejs18.x"
  timeout         = 30
  memory_size     = 256

  environment {
    variables = {
      ENVIRONMENT = var.environment
      SQS_QUEUE_URL = aws_sqs_queue.game_updates.url
      USE_MSK = tostring(var.use_msk)
      USE_SQS = "true"
      DYNAMODB_TABLE_NAME = aws_dynamodb_table.games.name
      USE_LOCAL_SERVICES = tostring(var.use_local_services)
      NBA_BASE_URL = "https://nba-prod-us-east-1-mediaops-stats.s3.amazonaws.com/NBA/liveData"
      NODE_ENV = var.environment
    }
  }

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = [module.lambda_security_group.security_group_id]
  }

  depends_on = [
    aws_iam_role_policy.lambda_policy,
    aws_iam_role_policy_attachment.lambda_basic,
    aws_iam_role_policy_attachment.lambda_vpc,
    aws_cloudwatch_log_group.box_score_handler
  ]

  tags = {
    Environment = var.environment
    Project     = var.project_name
  }
}

data "aws_msk_cluster" "nba_live" {
  count      = var.use_msk ? 1 : 0
  cluster_name = aws_msk_cluster.nba_live[0].cluster_name
  depends_on = [aws_msk_cluster.nba_live]
}

data "aws_elasticache_cluster" "nba_live" {
  count            = var.use_elasticache ? 1 : 0
  cluster_id       = aws_elasticache_cluster.nba_live[0].cluster_id
  depends_on = [aws_elasticache_cluster.nba_live]
}

resource "aws_security_group_rule" "lambda_to_redis" {
  count = var.use_elasticache ? 1 : 0

  type                     = "egress"
  from_port               = 6379
  to_port                 = 6379
  protocol                = "tcp"
  source_security_group_id = aws_security_group.redis[0].id
  security_group_id       = module.lambda_security_group.security_group_id
}

resource "aws_security_group_rule" "lambda_to_msk" {
  count = var.use_msk ? 1 : 0

  type                     = "egress"
  from_port               = 9092
  to_port                 = 9092
  protocol                = "tcp"
  source_security_group_id = aws_security_group.msk[0].id
  security_group_id       = module.lambda_security_group.security_group_id
}

# Add SQS trigger for box score handler
resource "aws_lambda_event_source_mapping" "box_score_sqs" {
  event_source_arn = aws_sqs_queue.game_updates.arn
  function_name    = aws_lambda_function.box_score_handler.arn
  batch_size       = 10
  enabled          = true

  depends_on = [
    aws_iam_role_policy.lambda_policy
  ]
}
