import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { SQSClient } from '@aws-sdk/client-sqs';

export const dynamoDb = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

export const eventBridge = new EventBridgeClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

export const sqs = new SQSClient({
  region: process.env.AWS_REGION || 'us-east-1',
}); 