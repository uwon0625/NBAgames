# NBAgames
NBA live score and alerts, it pulls most recent/scheduled games, with box score for the games. It also provides live updates.

# Technology Stack
 - frontend:  Next.js v15.1.3(React v19.0.0), TypeScript, Tailwind CSS.
 - backend:  Docker, Kafka, NestJS, Express, CORS, WebSocket, Redis, AWS DynamoDB, Lambda, EventBridge, SQS, Restful API.
 - infrastructure: AWS CDK(IAM, CloudFormation, DynamoDB).
 - unit tests: Jest v29.5.11.

# Data flow
1. Check Redis first (fastest)
2. If Redis misses, check DynamoDB
3. If DynamoDB has data, store it in Redis
4. If both miss, fetch from API
5. Store API data in both Redis and DynamoDB

    
