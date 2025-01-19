# Only create if MSK is disabled and SQS is enabled
resource "aws_sqs_queue" "game_updates" {
  name                        = "${var.project_name}-updates-${var.environment}.fifo"
  fifo_queue                  = true
  content_based_deduplication = true
  deduplication_scope        = "messageGroup"
  fifo_throughput_limit      = "perMessageGroupId"
  message_retention_seconds   = 86400  # 24 hours
  visibility_timeout_seconds  = 30
  
  tags = {
    Environment = var.environment
    Project     = var.project_name
  }
}

# Update the queue policy to be more permissive for testing
resource "aws_sqs_queue_policy" "game_updates" {
  queue_url = aws_sqs_queue.game_updates.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = "*"
        Action = [
          "sqs:SendMessage",
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes"
        ]
        Resource = aws_sqs_queue.game_updates.arn
      }
    ]
  })
} 