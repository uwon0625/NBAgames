output "api_endpoint" {
  value = aws_apigatewayv2_api.nba_live.api_endpoint
}

output "msk_brokers" {
  value = var.use_msk ? aws_msk_cluster.nba_live[0].bootstrap_brokers : "local"
  sensitive = true
}

output "redis_endpoint" {
  value = var.use_elasticache ? aws_elasticache_cluster.nba_live[0].cache_nodes[0].address : "localhost"
}

output "dynamodb_table_name" {
  description = "Name of the DynamoDB table"
  value = aws_dynamodb_table.games_table.name
}

output "lambda_functions" {
  value = {
    game_update = aws_lambda_function.game_update_handler.function_name
    box_score   = aws_lambda_function.box_score_handler.function_name
  }
}

output "sqs_queue_url" {
  description = "The URL of the SQS queue"
  value       = aws_sqs_queue.game_updates.url
}
