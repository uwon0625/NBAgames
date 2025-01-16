# Only create if MSK is disabled and SQS is enabled
resource "aws_sqs_queue" "game_updates" {
  count = (!var.use_msk && var.use_sqs_instead_of_msk) ? 1 : 0
  
  name                      = "${var.project_name}-game-updates-${var.environment}"
  message_retention_seconds = 86400  # 24 hours
  visibility_timeout_seconds = 30
  
  tags = local.common_tags
}

resource "aws_sqs_queue_policy" "game_updates" {
  count     = (!var.use_msk && var.use_sqs_instead_of_msk) ? 1 : 0
  queue_url = aws_sqs_queue.game_updates[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = [
          "sqs:SendMessage",
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes"
        ]
        Resource = aws_sqs_queue.game_updates[0].arn
      }
    ]
  })
} 