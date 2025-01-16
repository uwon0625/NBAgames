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
  count = var.use_msk ? 1 : 0

  alarm_name          = "${var.project_name}-msk-storage-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name        = "KafkaDataLogsDiskUsed"
  namespace          = "AWS/Kafka"
  period             = "300"
  statistic          = "Average"
  threshold          = "85"
  alarm_description  = "MSK broker storage utilization exceeded 85%"
  alarm_actions      = []

  dimensions = {
    Cluster = aws_msk_cluster.nba_live[0].cluster_name
  }
}
