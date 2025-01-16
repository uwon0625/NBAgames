aws_region = "us-east-1"
environment = "dev"
project_name = "nba-live"

# VPC Configuration
vpc_id = "vpc-0bd427d9b382cdd97"
subnet_ids = [
  "subnet-0b4a9f3b51e0dc6d8",
  "subnet-07587fa8cfe65db3e", 
  "subnet-03c71501618fcf754"
]

# Resource Names
dynamodb_table_name = "nba_games"
s3_bucket_name = "nba-live-886436930781"
msk_cluster_name = "nba-live-kafka"

# Kafka Settings
kafka_topic = "nba-game-updates"

# Cache Configuration
redis_cache_ttl = 300

# Security
security_group_name = "nba-live-security-group"

# Cost control for dev environment
msk_instance_type = "kafka.t3.small"      # Instead of larger instances
redis_node_type = "cache.t3.micro"        # Smallest Redis instance

# Development environment settings
use_local_services = true    # Use Docker Compose services
use_msk = false             # Don't deploy MSK
use_elasticache = false     # Don't deploy ElastiCache
use_sqs_instead_of_msk = false  # Don't use SQS in development
