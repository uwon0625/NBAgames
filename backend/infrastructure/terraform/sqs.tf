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

  # Enable CloudWatch metrics
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.game_updates_dlq.arn
    maxReceiveCount     = 3
  })
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

# Get current region
data "aws_region" "current" {}

# Create a CloudWatch log metric filter
resource "aws_cloudwatch_log_metric_filter" "sqs_processed_messages" {
  name           = "processed-messages"
  pattern        = "[timestamp, requestid, level = INFO, message = \"Successfully processed message\"]"
  log_group_name = aws_cloudwatch_log_group.box_score_handler.name

  metric_transformation {
    name          = "ProcessedMessages"
    namespace     = "NBA/SQS"
    value         = "1"
    default_value = 0
  }
}

# Add a CloudWatch dashboard to visualize the metrics
resource "aws_cloudwatch_dashboard" "sqs_metrics" {
  dashboard_name = "${var.project_name}-sqs-metrics-${var.environment}"

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          metrics = [
            ["NBA/SQS", "ProcessedMessages", { "stat": "Sum", "label": "Processed Messages" }]
          ]
          period = 300
          region = data.aws_region.current.name
          title  = "Processed Messages"
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6
        properties = {
          metrics = [
            ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", aws_sqs_queue.game_updates.name, { "label": "Messages Available" }],
            ["AWS/SQS", "ApproximateNumberOfMessagesNotVisible", "QueueName", aws_sqs_queue.game_updates.name, { "label": "Messages In Flight" }],
            ["AWS/SQS", "ApproximateNumberOfMessagesDelayed", "QueueName", aws_sqs_queue.game_updates.name, { "label": "Messages Delayed" }]
          ]
          period = 300
          region = data.aws_region.current.name
          title  = "Queue Depth"
          stacked = true
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          metrics = [
            ["AWS/SQS", "ApproximateAgeOfOldestMessage", "QueueName", aws_sqs_queue.game_updates.name, { "label": "Main Queue" }],
            ["AWS/SQS", "ApproximateAgeOfOldestMessage", "QueueName", aws_sqs_queue.game_updates_dlq.name, { "label": "DLQ" }]
          ]
          period = 300
          region = data.aws_region.current.name
          title  = "Message Age (seconds)"
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 6
        width  = 12
        height = 6
        properties = {
          metrics = [
            ["AWS/SQS", "NumberOfMessagesReceived", "QueueName", aws_sqs_queue.game_updates.name, { "stat": "Sum", "label": "Messages Received" }],
            ["AWS/SQS", "NumberOfMessagesDeleted", "QueueName", aws_sqs_queue.game_updates.name, { "stat": "Sum", "label": "Messages Deleted" }],
            ["AWS/SQS", "NumberOfMessagesMoved", "QueueName", aws_sqs_queue.game_updates.name, { "stat": "Sum", "label": "Messages Moved to DLQ" }]
          ]
          period = 300
          region = data.aws_region.current.name
          title  = "Message Operations"
        }
      }
    ]
  })
}

resource "aws_sqs_queue" "game_updates_dlq" {
  name                      = "${var.project_name}-game-updates-dlq-${var.environment}.fifo"
  fifo_queue               = true
  content_based_deduplication = true
  message_retention_seconds = 1209600  # 14 days
} 