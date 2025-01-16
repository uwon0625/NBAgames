# Update EventBridge rule with explicit target
resource "aws_cloudwatch_event_rule" "score_update" {
  name                = "${var.project_name}-score-update-${var.environment}"
  description         = "Trigger game updates every minute"
  schedule_expression = "rate(1 minute)"

  tags = local.common_tags
}

resource "aws_cloudwatch_event_target" "lambda" {
  rule      = aws_cloudwatch_event_rule.score_update.name
  target_id = "GameUpdateHandler"
  arn       = aws_lambda_function.game_update_handler.arn

  depends_on = [
    aws_lambda_function.game_update_handler,
    aws_lambda_permission.eventbridge
  ]
} 