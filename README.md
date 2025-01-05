# NBAgames
NBA live score and alerts, it pulls most recent/scheduled games, with box score for the games. It also provides live updates.

# Technology Stack
 - frontend:  Next.js v14.1.0(React v18.2.0), TypeScript, Tailwind CSS, Storybook v7.6.17.
 - backend:  Docker, Kafka, NestJS, Express, CORS, WebSocket, Redis, AWS SDK V3, AWS DynamoDB, Lambda, EventBridge, SQS, Restful API.
 - infrastructure: AWS CDK(IAM, CloudFormation, DynamoDB).
 - unit tests: Jest v29.7.0.

# Data flow
1. Check Redis first (fastest)
2. If Redis misses, check DynamoDB
3. If DynamoDB has data, store it in Redis
4. If both miss, fetch from API
5. Store API data in both Redis and DynamoDB

    
