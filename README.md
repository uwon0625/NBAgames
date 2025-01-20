# NBAgames
NBA live score and alerts, it pulls most recent/scheduled games, with box score for the games. It also provides live updates.

# System Diagram
```mermaid
%%{init: {'flowchart': {'width': 600}}}%%
flowchart LR
    NBA["NBA API"]
    Poller["Lambda Poller"]
    EventBridge["EventBridge\n(CloudWatch Events)"]
    SQS["Message Queue\n(Kafka)"]
    Lambda["Lambda Functions\n(Game Updates & Box Scores)"]
    DynamoDB["DynamoDB"]
    Redis["Redis Cache"]
    WebSocket["WebSocket API"]
    Client["Frontend Clients"]

    NBA --> Poller
    EventBridge --> Lambda
    SQS --> Lambda
    Lambda --> DynamoDB
    Lambda --> WebSocket
    DynamoDB --> Redis
    WebSocket --> Client
    Redis --> Frontend 

    %% Styling
    classDef aws fill:#FF9900,stroke:#232F3E,stroke-width:2px,color:white;
    classDef client fill:#36B37E,stroke:#172B4D,stroke-width:2px,color:white;
    classDef external fill:#4A90E2,stroke:#2171C7,stroke-width:2px,color:white;

    class NBA external
    class Poller,EventBridge,Lambda,DynamoDB,Redis,WebSocket aws
    class Client client,Frontend
```

# Technology Stack
 - frontend:  Next.js v14.1.0(React v18.2.0), TypeScript, Tailwind CSS, Storybook v7.6.17.
 - backend: Terraform, Docker, SQS, Kafka, NestJS, Express, CORS, WebSocket, Redis,ElastiCache, AWS SDK V3, AWS DynamoDB, Lambda, EventBridge, CloudWatch, Restful API.
 - infrastructure: AWS CDK(IAM, CloudFormation, DynamoDB).
 - unit testing: Jest v29.7.0.

# Note
 - to lower the cost of development and testing, use local Redis cache and Kafka(vs AWS MSK and ElastiCache Clusters, for production), the application has configurations in backend .env(refer to backend\.env.example, and backend\infrastructure\terraform\terraform.tfvars - please make sure the settings are consistent) to decide the facilities:
  - Cost control for dev environment
    * msk_instance_type = "kafka.t3.small"      # Instead of larger instances
    * redis_node_type = "cache.t3.micro"        # Smallest Redis instance

  - Development environment settings
    * use_local_services = true    # Use Docker Compose services
    * use_msk = false             # Don't deploy MSK
    * use_elasticache = false     # Don't deploy ElastiCache
    * use_sqs_instead_of_msk = true  # Don't use SQS in development
