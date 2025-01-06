import { DynamoDBClient, CreateTableCommand, ScalarAttributeType } from '@aws-sdk/client-dynamodb';

const dynamodb = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1'
});

async function createTables() {
  const tables = [
    {
      TableName: 'nba_games',
      KeySchema: [
        { AttributeName: 'gameId', KeyType: 'HASH' }
      ],
      AttributeDefinitions: [
        { AttributeName: 'gameId', AttributeType: ScalarAttributeType.S }
      ],
      ProvisionedThroughput: {
        ReadCapacityUnits: 5,
        WriteCapacityUnits: 5
      }
    }
  ];

  for (const table of tables) {
    try {
      await dynamodb.send(new CreateTableCommand(table));
      console.log(`Created table ${table.TableName}`);
    } catch (error: any) {
      if (error.name === 'ResourceInUseException') {
        console.log(`Table ${table.TableName} already exists`);
      } else {
        console.error(`Error creating table ${table.TableName}:`, error);
      }
    }
  }
}

createTables(); 