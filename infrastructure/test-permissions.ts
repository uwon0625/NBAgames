import { logger } from '../backend/src/config/logger';
import { exec } from 'child_process';
import { promisify } from 'util';
import dotenv from 'dotenv';
dotenv.config();

const execAsync = promisify(exec);

async function testPermissions() {
  try {
    // Test AWS identity
    logger.info('Testing AWS identity...');
    const identity = await execAsync('aws sts get-caller-identity');
    logger.info('Identity:', identity.stdout);

    // Test S3 bucket creation
    const bucketName = `nba-live-${process.env.AWS_ACCOUNT_ID}-test`;
    logger.info(`Testing S3 bucket creation: ${bucketName}`);
    try {
      await execAsync(`aws s3 mb s3://${bucketName} --region ${process.env.AWS_REGION}`);
      logger.info('S3 bucket creation successful');
      
      // Test S3 bucket listing
      logger.info('Testing S3 bucket listing...');
      const buckets = await execAsync(`aws s3 ls s3://${bucketName}`);
      logger.info('S3 bucket listing successful:', buckets.stdout);

      // Test S3 object upload
      logger.info('Testing S3 object upload...');
      await execAsync(`echo "test" > test.txt`);
      await execAsync(`aws s3 cp test.txt s3://${bucketName}/test.txt`);
      logger.info('S3 object upload successful');

    } catch (error: any) {
      logger.error('S3 operation failed:', error.stderr);
    }

    // Test DynamoDB table creation
    const tableName = 'nba-live-test-table';
    logger.info(`Testing DynamoDB table creation: ${tableName}`);
    try {
      await execAsync(
        `aws dynamodb create-table ` +
        `--table-name ${tableName} ` +
        `--attribute-definitions AttributeName=id,AttributeType=S ` +
        `--key-schema AttributeName=id,KeyType=HASH ` +
        `--billing-mode PAY_PER_REQUEST ` +
        `--region ${process.env.AWS_REGION}`
      );
      logger.info('DynamoDB table creation successful');
      
      // Test DynamoDB item operations
      logger.info('Testing DynamoDB item operations...');
      await execAsync(
        `aws dynamodb put-item ` +
        `--table-name ${tableName} ` +
        `--item '{"id": {"S": "test"}, "data": {"S": "test"}}' ` +
        `--region ${process.env.AWS_REGION}`
      );
      logger.info('DynamoDB item put successful');

    } catch (error: any) {
      logger.error('DynamoDB operation failed:', error.stderr);
    }

  } catch (error: any) {
    logger.error('Permission test failed:', error.stderr);
  }
}

testPermissions(); 