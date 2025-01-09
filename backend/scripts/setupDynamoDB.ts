import { 
  DynamoDBClient, 
  CreateTableCommand,
  ScalarAttributeType,
  KeyType,
  AttributeDefinition
} from '@aws-sdk/client-dynamodb';
import { logger } from '../src/config/logger';
import dotenv from 'dotenv';
dotenv.config();

const dynamodb = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
  }
});

async function createTables() {
  const tables = [
    {
      TableName: process.env.DYNAMODB_TABLE_NAME || 'nba_games',
      KeySchema: [
        { AttributeName: 'gameId', KeyType: KeyType.HASH }
      ],
      AttributeDefinitions: [
        { AttributeName: 'gameId', AttributeType: ScalarAttributeType.S }
      ],
      ProvisionedThroughput: {
        ReadCapacityUnits: 5,
        WriteCapacityUnits: 5
      }
    },
    {
      TableName: process.env.DYNAMODB_UPDATES_TABLE_NAME || 'nba_game_updates',
      KeySchema: [
        { AttributeName: 'gameId', KeyType: KeyType.HASH },
        { AttributeName: 'timestamp', KeyType: KeyType.RANGE }
      ],
      AttributeDefinitions: [
        { AttributeName: 'gameId', AttributeType: ScalarAttributeType.S },
        { AttributeName: 'timestamp', AttributeType: ScalarAttributeType.N }
      ],
      ProvisionedThroughput: {
        ReadCapacityUnits: 5,
        WriteCapacityUnits: 5
      }
    }
  ];

  for (const tableParams of tables) {
    try {
      await dynamodb.send(new CreateTableCommand(tableParams));
      logger.info(`Created table ${tableParams.TableName}`);
    } catch (error: any) {
      if (error.name === 'ResourceInUseException') {
        logger.info(`Table ${tableParams.TableName} already exists`);
      } else {
        logger.error(`Error creating table ${tableParams.TableName}:`, error);
        throw error; // Re-throw to ensure setup fails if tables can't be created
      }
    }
  }
}

createTables()
  .then(() => {
    logger.info('DynamoDB setup completed');
  })
  .catch((error) => {
    logger.error('DynamoDB setup failed:', error);
    process.exit(1);
  }); 