resource "aws_dynamodb_table" "games_table" {
  name           = "nba-live-games-dev"  # Keep this name
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "gameId"
  
  attribute {
    name = "gameId"
    type = "S"  # String type
  }

  attribute {
    name = "status"
    type = "S"
  }

  global_secondary_index {
    name               = "StatusIndex"
    hash_key           = "status"
    projection_type    = "ALL"
  }

  ttl {
    attribute_name = "ttl"
    enabled       = true
  }
}
