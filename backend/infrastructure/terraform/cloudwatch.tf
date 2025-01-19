resource "aws_cloudwatch_log_group" "game_update_handler" {
  name              = "/aws/lambda/${var.project_name}-game-update-${var.environment}"
  retention_in_days = 14

  tags = {
    Environment = var.environment
    Project     = var.project_name
  }
}

resource "aws_cloudwatch_log_group" "box_score_handler" {
  name              = "/aws/lambda/${var.project_name}-box-score-${var.environment}"
  retention_in_days = 14

  tags = {
    Environment = var.environment
    Project     = var.project_name
  }
} 