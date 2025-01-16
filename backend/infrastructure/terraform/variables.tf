variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "project_name" {
  description = "Project name for resource naming"
  type        = string
  default     = "nba-live"
}

variable "vpc_id" {
  description = "Existing VPC ID"
  type        = string
}

variable "subnet_ids" {
  description = "List of subnet IDs"
  type        = list(string)
}

# Additional variables from .env
variable "dynamodb_table_name" {
  description = "DynamoDB table name"
  type        = string
  default     = "nba_games"
}

variable "s3_bucket_name" {
  description = "S3 bucket name"
  type        = string
}

variable "msk_cluster_name" {
  description = "MSK Cluster name"
  type        = string
  default     = "nba-live-kafka"
}

variable "kafka_topic" {
  description = "Kafka topic name"
  type        = string
  default     = "nba-game-updates"
}

variable "redis_cache_ttl" {
  description = "Redis cache TTL in seconds"
  type        = number
  default     = 300
}

variable "security_group_name" {
  description = "Security group name"
  type        = string
  default     = "nba-live-security-group"
}

# MSK Configuration
variable "msk_instance_type" {
  description = "Instance type for MSK brokers"
  type        = string
  default     = "kafka.t3.small"
}

# Redis Configuration
variable "redis_node_type" {
  description = "Instance type for Redis nodes"
  type        = string
  default     = "cache.t3.micro"
}

# Feature flags for cost control
variable "use_msk" {
  description = "Whether to deploy MSK cluster (expensive)"
  type        = bool
  default     = false
}

variable "use_elasticache" {
  description = "Whether to deploy ElastiCache (Redis)"
  type        = bool
  default     = false
}

variable "use_sqs_instead_of_msk" {
  description = "Use SQS instead of MSK for messaging in production"
  type        = bool
  default     = true
}

# Environment-specific feature flags
variable "use_local_services" {
  description = "Use local Redis and Kafka instead of AWS services"
  type        = bool
  default     = true  # Default to local for development
}
