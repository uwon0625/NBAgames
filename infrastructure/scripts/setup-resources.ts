import { DynamoDBClient, CreateTableCommand, DescribeTableCommand, ResourceNotFoundException } from '@aws-sdk/client-dynamodb';
import { S3Client, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
import { logger } from '../../backend/src/config/logger';

dotenv.config();

const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });
const s3 = new S3Client({ region: process.env.AWS_REGION });

async function tableExists(tableName: string): Promise<boolean> {
  try {
    await dynamodb.send(new DescribeTableCommand({ TableName: tableName }));
    return true;
  } catch (error) {
    if (error instanceof ResourceNotFoundException) {
      return false;
    }
    throw error;
  }
}

async function bucketExists(bucketName: string): Promise<boolean> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucketName }));
    return true;
  } catch (error: any) {
    if (error.name === 'NotFound') {
      return false;
    }
    throw error;
  }
}

async function createDynamoDBTable() {
  const tableName = 'nba_games';
  
  try {
    if (await tableExists(tableName)) {
      logger.info(`DynamoDB table ${tableName} already exists`);
      return;
    }

    const command = new CreateTableCommand({
      TableName: tableName,
      AttributeDefinitions: [
        { AttributeName: 'gameId', AttributeType: 'S' },
        { AttributeName: 'status', AttributeType: 'S' },
        { AttributeName: 'lastUpdate', AttributeType: 'N' }
      ],
      KeySchema: [
        { AttributeName: 'gameId', KeyType: 'HASH' }
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'StatusLastUpdatedIndex',
          KeySchema: [
            { AttributeName: 'status', KeyType: 'HASH' },
            { AttributeName: 'lastUpdate', KeyType: 'RANGE' }
          ],
          Projection: {
            ProjectionType: 'ALL'
          },
          ProvisionedThroughput: {
            ReadCapacityUnits: 5,
            WriteCapacityUnits: 5
          }
        }
      ],
      ProvisionedThroughput: {
        ReadCapacityUnits: 5,
        WriteCapacityUnits: 5
      }
    });

    await dynamodb.send(command);
    logger.info(`DynamoDB table ${tableName} created successfully`);
  } catch (error) {
    logger.error('Error creating DynamoDB table:', error);
    throw error;
  }
}

async function createS3Bucket() {
  const bucketName = 'nba-live-886436930781-dev';
  
  try {
    if (await bucketExists(bucketName)) {
      logger.info(`S3 bucket ${bucketName} already exists`);
      return;
    }

    const command = new CreateBucketCommand({
      Bucket: bucketName
    });

    await s3.send(command);
    logger.info(`S3 bucket ${bucketName} created successfully`);
  } catch (error) {
    logger.error('Error creating S3 bucket:', error);
    throw error;
  }
}

async function setup() {
  try {
    logger.info('Starting resource setup...');
    await createDynamoDBTable();
    await createS3Bucket();
    logger.info('All resources created successfully');
  } catch (error) {
    logger.error('Setup failed:', error);
    process.exit(1);
  }
}

setup(); 