resource "aws_lambda_function" "game_update_handler" {
  filename         = "${path.module}/../lambda/dist/lambdas/gameUpdateHandler.zip"
  function_name    = "${var.project_name}-gameUpdateHandler-${var.environment}"
  role            = aws_iam_role.lambda_role.arn
  handler         = "gameUpdateHandler.handler"
  runtime         = "nodejs18.x"
  timeout         = 30
  memory_size     = 256

  environment {
    variables = {
      KAFKA_BROKERS = var.use_local_services ? "localhost:9092" : (
        var.use_msk ? aws_msk_cluster.nba_live[0].bootstrap_brokers : ""
      )
      REDIS_ENDPOINT = var.use_local_services ? "localhost:6379" : (
        var.use_elasticache ? "${aws_elasticache_cluster.nba_live[0].cache_nodes[0].address}:${aws_elasticache_cluster.nba_live[0].cache_nodes[0].port}" : ""
      )
      QUEUE_URL = (!var.use_local_services && !var.use_msk && var.use_sqs_instead_of_msk) ? aws_sqs_queue.game_updates[0].url : ""
      USE_SQS = (!var.use_local_services && !var.use_msk && var.use_sqs_instead_of_msk) ? "true" : "false"
      KAFKA_TOPIC = var.kafka_topic
      DYNAMODB_TABLE_NAME = aws_dynamodb_table.games.name
    }
  }

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = [aws_security_group.lambda.id]
  }

  depends_on = [
    aws_iam_role_policy.lambda_policy,
    aws_msk_cluster.nba_live,
    aws_dynamodb_table.games,
    aws_elasticache_cluster.nba_live
  ]
}

resource "aws_lambda_function" "box_score_handler" {
  filename         = "${path.module}/../lambda/dist/lambdas/boxScoreHandler.zip"
  function_name    = "${var.project_name}-boxScoreHandler-${var.environment}"
  role            = aws_iam_role.lambda_role.arn
  handler         = "boxScoreHandler.handler"
  runtime         = "nodejs18.x"
  timeout         = 30
  memory_size     = 256

  environment {
    variables = {
      KAFKA_BROKERS = var.use_local_services ? "localhost:9092" : (
        var.use_msk ? aws_msk_cluster.nba_live[0].bootstrap_brokers : ""
      )
      REDIS_ENDPOINT = var.use_local_services ? "localhost:6379" : (
        var.use_elasticache ? "${aws_elasticache_cluster.nba_live[0].cache_nodes[0].address}:${aws_elasticache_cluster.nba_live[0].cache_nodes[0].port}" : ""
      )
      QUEUE_URL = (!var.use_local_services && !var.use_msk && var.use_sqs_instead_of_msk) ? aws_sqs_queue.game_updates[0].url : ""
      USE_SQS = (!var.use_local_services && !var.use_msk && var.use_sqs_instead_of_msk) ? "true" : "false"
      KAFKA_TOPIC = var.kafka_topic
      DYNAMODB_TABLE_NAME = aws_dynamodb_table.games.name
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
