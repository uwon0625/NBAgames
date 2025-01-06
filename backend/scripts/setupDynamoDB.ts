import { 
  DynamoDBClient, 
  CreateTableCommand, 
  ScalarAttributeType,
  KeyType,
  CreateTableCommandInput 
} from '@aws-sdk/client-dynamodb';
import 'dotenv/config';

const dynamodb = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1'
});

async function createTables() {
  const tableParams: CreateTableCommandInput = {
    TableName: process.env.DYNAMODB_TABLE_NAME || 'nba_games',
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

  try {
    await dynamodb.send(new CreateTableCommand(tableParams));
    console.log(`Created table ${tableParams.TableName}`);
  } catch (error: any) {
    if (error.name === 'ResourceInUseException') {
      console.log(`Table ${tableParams.TableName} already exists`);
    } else {
      console.error(`Error creating table ${tableParams.TableName}:`, error);
    }
  }
}

createTables().catch(console.error); 