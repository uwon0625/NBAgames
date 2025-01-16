resource "aws_dynamodb_table" "games" {
  name           = "${var.project_name}-games-${var.environment}"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "gameId"
  range_key      = "dataType"
  stream_enabled = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

  attribute {
    name = "gameId"
    type = "S"
  }

  attribute {
    name = "dataType"
    type = "S"
  }

  attribute {
    name = "status"
    type = "S"
  }

  attribute {
    name = "lastUpdate"
    type = "N"
  }

  # GSI for querying games by status (e.g., all live games)
  global_secondary_index {
    name               = "StatusIndex"
    hash_key           = "status"
    range_key         = "lastUpdate"
    projection_type    = "ALL"
  }

  ttl {
    attribute_name = "expiryTime"
    enabled        = true
  }

  tags = {
    Environment = var.environment
    Project     = var.project_name
  }
}
