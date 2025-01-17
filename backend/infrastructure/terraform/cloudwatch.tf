resource "aws_cloudwatch_log_group" "game_update_handler" {
  name              = "/aws/lambda/${aws_lambda_function.game_update_handler.function_name}"
  retention_in_days = 14
}

resource "aws_cloudwatch_log_group" "box_score_handler" {
  name              = "/aws/lambda/${aws_lambda_function.box_score_handler.function_name}"
  retention_in_days = 14
} 