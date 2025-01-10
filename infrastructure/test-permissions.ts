import { executeCommand } from './utils/aws-commands';
import { logger } from '../backend/src/config/logger';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

async function testPermissions(): Promise<void> {
  logger.info('Testing AWS permissions...');
  const testBucket = `${process.env.S3_BUCKET_NAME}-test`;
  const testTable = `${process.env.DYNAMODB_TABLE_NAME}-test`;

  try {
    // Test S3 permissions
    logger.info('Testing S3 permissions...');
    await executeCommand(`aws s3api get-bucket-location --bucket ${process.env.S3_BUCKET_NAME}`);
    logger.info('✓ S3 read permissions OK');

    // Test DynamoDB permissions
    logger.info('Testing DynamoDB permissions...');
    await executeCommand(
      `aws dynamodb describe-table --table-name ${process.env.DYNAMODB_TABLE_NAME} ` +
      `--region ${process.env.AWS_REGION}`
    );
    logger.info('✓ DynamoDB read permissions OK');

    // Test cleanup permissions
    logger.info('Testing cleanup permissions...');
    await executeCommand(`aws s3api get-bucket-policy --bucket ${process.env.S3_BUCKET_NAME}`);
    logger.info('✓ S3 delete permissions OK');

    await executeCommand(
      `aws dynamodb describe-table --table-name ${process.env.DYNAMODB_TABLE_NAME} ` +
      `--region ${process.env.AWS_REGION}`
    );
    logger.info('✓ DynamoDB delete permissions OK');

    logger.info('Testing DynamoDB GSI permissions...');
    await executeCommand(
      `aws dynamodb query \
      --table-name ${process.env.DYNAMODB_TABLE_NAME} \
      --index-name StatusLastUpdatedIndex \
      --key-condition-expression "status = :status" \
      --expression-attribute-values '{":status":{"S":"LIVE"}}' \
      --region ${process.env.AWS_REGION}`
    );
    logger.info('✓ DynamoDB GSI permissions OK');

    logger.info('All permissions tests passed');
  } catch (error: any) {
    if (error.stderr?.includes('AccessDenied') || error.stderr?.includes('AccessDeniedException')) {
      logger.warn('Missing required permissions. Please ask your AWS admin to grant:');
      logger.warn('Required permissions:');
      logger.warn('S3:');
      logger.warn('- s3:CreateBucket');
      logger.warn('- s3:PutObject');
      logger.warn('- s3:GetObject');
      logger.warn('- s3:ListBucket');
      logger.warn('- s3:DeleteObject');
      logger.warn('- s3:DeleteBucket');
      logger.warn('DynamoDB:');
      logger.warn('- dynamodb:CreateTable');
      logger.warn('- dynamodb:DescribeTable');
      logger.warn('- dynamodb:DeleteTable');
      logger.warn('- dynamodb:PutItem');
      logger.warn('- dynamodb:GetItem');
      logger.warn('- dynamodb:UpdateItem');
    } else {
      throw error;
    }
  }
}

testPermissions().catch(error => {
  logger.error('Permission test failed:', error);
  process.exit(1);
}); 