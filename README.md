# NBAgames
NBA live score and alerts, it pulls most recent/scheduled games, with box score for the games. It also provides live updates.

# System Diagram
```mermaid
%%{init: {'flowchart': {'width': 600}}}%%
flowchart LR
    NBA[NBA API] --> Poller[Lambda Poller]
    Poller --> Kafka[Kafka Stream]
    Kafka --> Lambda1[Game Update Lambda]
    Lambda1 --> DynamoDB[DynamoDB]
    Lambda1 --> Redis[Redis Cache]
    Lambda1 --> EventBridge[EventBridge]
    EventBridge --> Lambda2[Alert Lambda]
    Lambda2 --> WebSocket[WebSocket API]
    WebSocket --> Client[Frontend Clients]
    Redis --> API[REST API Gateway]
    DynamoDB --> API
    API --> Client

    classDef external fill:#f96;
    classDef aws fill:#FF9900,color:white;
    class NBA external;
    class Poller,Lambda1,Lambda2,DynamoDB,EventBridge,WebSocket,API aws;
    class Client external;
    class Redis external;
    class Kafka external;
```

# Technology Stack
 - frontend:  Next.js v14.1.0(React v18.2.0), TypeScript, Tailwind CSS, Storybook v7.6.17.
 - backend:  Docker, Kafka, NestJS, Express, CORS, WebSocket, Redis, AWS SDK V3, AWS DynamoDB, Lambda, EventBridge, Restful API.
 - infrastructure: AWS CDK(IAM, CloudFormation, DynamoDB).
 - unit testing: Jest v29.7.0.
