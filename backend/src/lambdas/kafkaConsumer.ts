import { Kafka } from 'kafkajs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import Redis from 'ioredis';

const kafka = new Kafka({
  clientId: 'nba-live-consumer',
  brokers: (process.env.KAFKA_BROKERS || '').split(','),
  ssl: true,
});

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const redis = new Redis(process.env.REDIS_ENDPOINT || '');

export async function handler(event: any): Promise<any> {
  const consumer = kafka.consumer({ groupId: 'nba-live-group' });

  try {
    await consumer.connect();
    await consumer.subscribe({ topic: 'nba-live-updates', fromBeginning: true });

    await consumer.run({
      eachMessage: async ({ message }) => {
        const gameData = JSON.parse(message.value?.toString() || '');

        // Store in Redis for quick access (5 min TTL)
        await redis.set(
          `game:${gameData.gameId}`, 
          JSON.stringify(gameData),
          'EX',
          300 
        );

        // Store in DynamoDB for persistence
        await docClient.send(new PutCommand({
          TableName: process.env.DYNAMODB_TABLE_NAME,
          Item: gameData
        }));
      },
    });
  } catch (error) {
    console.error('Error processing messages:', error);
  }
} 