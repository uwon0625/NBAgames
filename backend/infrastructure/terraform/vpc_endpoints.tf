resource "aws_vpc_endpoint" "dynamodb" {
  vpc_id       = var.vpc_id
  service_name = "com.amazonaws.${var.aws_region}.dynamodb"
  vpc_endpoint_type = "Gateway"

  route_table_ids = [data.aws_vpc.existing.main_route_table_id]

  tags = {
    Environment = var.environment
    Project     = var.project_name
  }

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = "*"
        Action = [
          "dynamodb:*"
        ]
        Resource = aws_dynamodb_table.games_table.arn
      }
    ]
  })
}

resource "aws_vpc_endpoint" "s3" {
  vpc_id       = var.vpc_id
  service_name = "com.amazonaws.${var.aws_region}.s3"
  vpc_endpoint_type = "Gateway"

  route_table_ids = [data.aws_vpc.existing.main_route_table_id]

  tags = {
    Environment = var.environment
    Project     = var.project_name
  }
}
