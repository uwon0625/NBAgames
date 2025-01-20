# NBAgames
NBA live score and alerts, it pulls most recent/scheduled games, with box score for the games. It also provides live updates.

# System Diagram
```mermaid
%%{init: {'flowchart': {'width': 600}}}%%
flowchart LR
    NBA[NBA API] --> Poller[Lambda Poller]
    EventBridge (CloudWatch Events, triggered every minute) --> Lambda[Game update]
    SQS(Kafka) --> Lambda[Game Box Score]
    Lambda[Game update and Game Box Score] --> DynamoDB[DynamoDB]
    Lambda[Game update and Game Box Score] --> WebSocket[WebSocket API]
    DynamoDB[DynamoDB] --> Redis[Redis Cache]
    WebSocket --> Client[Frontend Clients]
```

# Technology Stack
 - frontend:  Next.js v14.1.0(React v18.2.0), TypeScript, Tailwind CSS, Storybook v7.6.17.
 - backend: Terraform, Docker, SQS, Kafka, NestJS, Express, CORS, WebSocket, Redis,ElastiCache, AWS SDK V3, AWS DynamoDB, Lambda, EventBridge, CloudWatch, Restful API.
 - infrastructure: AWS CDK(IAM, CloudFormation, DynamoDB).
 - unit testing: Jest v29.7.0.

# Note: to lower the cost of development and testing, use local Redis cache and Kafka(vs AWS MSK and ElastiCache Clusters, for production), the application has configurations in backend .env(refer to backend\.env.example, and backend\infrastructure\terraform\terraform.tfvars - please make sure the settings are consistent) to decide the facilities:
- # Cost control for dev environment
    msk_instance_type = "kafka.t3.small"      # Instead of larger instances
    redis_node_type = "cache.t3.micro"        # Smallest Redis instance

- # Development environment settings
    use_local_services = true    # Use Docker Compose services
    use_msk = false             # Don't deploy MSK
    use_elasticache = false     # Don't deploy ElastiCache
    use_sqs_instead_of_msk = true  # Don't use SQS in development
