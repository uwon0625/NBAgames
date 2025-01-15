import { logger } from '../../../src/config/logger';
import { updateIAMPolicy } from './updateIAMPolicy';
import { createS3Bucket } from './setupS3';
import { setupDynamoDB } from '../setupDynamoDB';
import { setupEventBridge } from '../setupEventBridge';
import { setupKafka } from '../setupKafka';
import { setupSecurityGroups } from '../setupSecurityGroups';
import { setupLambda } from './setupLambda';

async function setupResources() {
  try {
    logger.info('Starting AWS resources setup...');

    // 1. Update IAM policies first
    logger.info('Setting up IAM policies...');
    await updateIAMPolicy();

    // 2. Create Security Groups
    logger.info('Setting up Security Groups...');
    await setupSecurityGroups();

    // 3. Create S3 Bucket
    logger.info('Setting up S3 bucket...');
    await createS3Bucket();

    // 4. Create DynamoDB Tables
    logger.info('Setting up DynamoDB tables...');
    await setupDynamoDB();

    // 5. Setup EventBridge
    logger.info('Setting up EventBridge...');
    await setupEventBridge();

    // Note: MSK and Redis are now handled by CloudFormation (yarn deploy:cfn)
    // Do not create them here

    // 6. Setup Lambda Functions
    logger.info('Setting up Lambda functions...');
    await setupLambda();

    logger.info('AWS resources setup completed successfully');
  } catch (error) {
    logger.error('Failed to setup AWS resources:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  setupResources()
    .catch(() => process.exit(1));
}

export { setupResources }; 