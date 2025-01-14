import { 
  DynamoDBClient, 
  CreateTableCommand, 
  ScalarAttributeType,
  KeyType
} from '@aws-sdk/client-dynamodb';
import { logger } from '../../src/config/logger';

const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });

export async function setupDynamoDB() {
  try {
    const tableName = process.env.DYNAMODB_TABLE_NAME;
    if (!tableName) {
      throw new Error('DYNAMODB_TABLE_NAME environment variable is required');
    }

    const params = {
      TableName: tableName,
      KeySchema: [
        { 
          AttributeName: 'gameId', 
          KeyType: KeyType.HASH 
        }
      ],
      AttributeDefinitions: [
        { 
          AttributeName: 'gameId', 
          AttributeType: ScalarAttributeType.S 
        }
      ],
      ProvisionedThroughput: {
        ReadCapacityUnits: 5,
        WriteCapacityUnits: 5
      }
    };

    await dynamodb.send(new CreateTableCommand(params));
    logger.info(`Created DynamoDB table: ${tableName}`);

  } catch (error: any) {
    if (error.name === 'ResourceInUseException') {
      logger.info(`DynamoDB table ${process.env.DYNAMODB_TABLE_NAME} already exists`);
    } else {
      logger.error('Failed to create DynamoDB table:', error);
      throw error;
    }
  }
}

// Run if called directly
if (require.main === module) {
  setupDynamoDB()
    .catch(() => process.exit(1));
} 