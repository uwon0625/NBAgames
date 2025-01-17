resource "aws_msk_cluster" "nba_live" {
  count = var.use_msk ? 1 : 0
  
  cluster_name           = "${var.project_name}-kafka-${var.environment}"
  kafka_version          = "3.4.0"
  number_of_broker_nodes = 3

  broker_node_group_info {
    instance_type   = var.msk_instance_type
    client_subnets  = var.subnet_ids
    security_groups = [aws_security_group.msk[0].id]
    storage_info {
      ebs_storage_info {
        volume_size = 100
      }
    }
  }

  encryption_info {
    encryption_in_transit {
      client_broker = "TLS"
      in_cluster    = true
    }
  }

  tags = {
    Environment = var.environment
    Project     = var.project_name
  }
}

resource "aws_security_group" "msk" {
  count = var.use_msk ? 1 : 0
  
  name        = "${var.project_name}-msk-sg-${var.environment}"
  description = "Security group for MSK cluster"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 9092
    to_port     = 9092
    protocol    = "tcp"
    cidr_blocks = [data.aws_vpc.existing.cidr_block]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Environment = var.environment
    Project     = var.project_name
  }
}

data "aws_msk_broker_nodes" "current" {
  count = var.use_msk ? 1 : 0
  
  cluster_arn = aws_msk_cluster.nba_live[0].arn

  lifecycle {
    postcondition {
      condition     = length(self.node_info_list) > 0
      error_message = "No broker nodes found in MSK cluster"
    }
  }
}

locals {
  msk_brokers = var.use_msk ? [
    for node in data.aws_msk_broker_nodes.current[0].node_info_list : node.endpoints[0]
  ] : []
}
