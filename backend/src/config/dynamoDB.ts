import dotenv from 'dotenv';
dotenv.config();

import { DynamoDBClient, ListTablesCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { logger } from './logger';

// Add more detailed logging
logger.debug('AWS Environment:', {
  region: process.env.AWS_REGION,
  accessKeyLength: process.env.AWS_ACCESS_KEY_ID?.length || 0,
  secretKeyLength: process.env.AWS_SECRET_ACCESS_KEY?.length || 0,
  accessKeyPrefix: process.env.AWS_ACCESS_KEY_ID?.substring(0, 5) || 'none',
  tableName: process.env.GAMES_TABLE_NAME,
  envKeys: Object.keys(process.env).filter(key => key.startsWith('AWS_'))
});

// Initialize DynamoDB client with explicit credentials
const ddbClient = new DynamoDBClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
  }
});

// Add connection test
async function testConnection() {
  try {
    const command = new ListTablesCommand({});
    await ddbClient.send(command);
    logger.info('DynamoDB connection test successful');
  } catch (error) {
    logger.error('DynamoDB connection test failed:', error);
  }
}

testConnection();

export const docClient = DynamoDBDocumentClient.from(ddbClient);
export const TABLE_NAME = process.env.GAMES_TABLE_NAME || 'nba-games';