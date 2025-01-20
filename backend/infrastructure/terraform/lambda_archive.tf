# Archive file for game update handler
data "archive_file" "game_update_handler" {
  type        = "zip"
  source_dir  = "${path.module}/../lambda/dist/gameUpdateHandler"
  output_path = "${path.module}/../lambda/dist/lambdas/gameUpdateHandler.zip"
  excludes    = ["package-lock.json", "yarn.lock"]
}

# Archive file for box score handler
data "archive_file" "box_score_handler" {
  type        = "zip"
  source_dir  = "${path.module}/../lambda/dist/boxScoreHandler"
  output_path = "${path.module}/../lambda/dist/lambdas/boxScoreHandler.zip"
  excludes    = ["package-lock.json", "yarn.lock"]
} 