import { executeCommand } from './utils/aws-commands';
import { logger } from '../backend/src/config/logger';
import dotenv from 'dotenv';
import path from 'path';
import readline from 'readline';
dotenv.config();

async function emptyS3Bucket(bucketName: string): Promise<void> {
  try {
    logger.info(`Emptying S3 bucket: ${bucketName}`);
    await executeCommand(`aws s3 rm s3://${bucketName} --recursive`);
  } catch (error: any) {
    if (error.stderr?.includes('AccessDenied')) {
      logger.warn('No permission to delete S3 objects. Please ask your AWS admin to grant:');
      logger.warn('- s3:DeleteObject');
      logger.warn('- s3:ListBucket');
    } else if (!error.stderr?.includes('NoSuchBucket')) {
      throw error;
    }
  }
}

async function deleteS3Bucket(bucketName: string): Promise<void> {
  try {
    logger.info(`Deleting S3 bucket: ${bucketName}`);
    await executeCommand(`aws s3 rb s3://${bucketName} --force`);
  } catch (error: any) {
    if (error.stderr?.includes('AccessDenied')) {
      logger.warn('No permission to delete S3 bucket. Please ask your AWS admin to grant:');
      logger.warn('- s3:DeleteBucket');
    } else if (!error.stderr?.includes('NoSuchBucket')) {
      throw error;
    }
  }
}

async function deleteDynamoDBTable(tableName: string): Promise<void> {
  try {
    logger.info(`Deleting DynamoDB table: ${tableName}`);
    await executeCommand(
      `aws dynamodb delete-table --table-name ${tableName} ` +
      `--region ${process.env.AWS_REGION}`
    );
    
    // Wait for table deletion
    logger.info('Waiting for table deletion...');
    await executeCommand(
      `aws dynamodb wait table-not-exists ` +
      `--table-name ${tableName} ` +
      `--region ${process.env.AWS_REGION}`
    );
  } catch (error: any) {
    if (!error.stderr?.includes('ResourceNotFoundException')) {
      throw error;
    }
  }
}

async function confirmCleanup(): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(
      '\n⚠️  WARNING: This will delete all resources. Are you sure? (y/N) ', 
      (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === 'y');
      }
    );
  });
}

async function cleanup() {
  try {
    logger.info('Starting cleanup...');

    // Add confirmation
    const confirmed = await confirmCleanup();
    if (!confirmed) {
      logger.info('Cleanup cancelled');
      return;
    }

    // Validate AWS credentials
    logger.info('Validating AWS credentials...');
    const identity = await executeCommand('aws sts get-caller-identity');
    logger.info('Using AWS identity:', identity);

    // Get resource names from env
    const bucketName = process.env.S3_BUCKET_NAME;
    const gamesTableName = process.env.DYNAMODB_TABLE_NAME;

    if (!bucketName || !gamesTableName) {
      throw new Error('Required environment variables are not set');
    }

    // Clean up S3
    logger.info('Cleaning up S3...');
    await emptyS3Bucket(bucketName);
    await deleteS3Bucket(bucketName);

    // Clean up DynamoDB
    logger.info('Cleaning up DynamoDB...');
    await deleteDynamoDBTable(gamesTableName);

    logger.info('Cleanup completed successfully');
    logger.info('\nYou can now run:');
    logger.info('npm run setup');
    logger.info('to recreate the infrastructure');

  } catch (error: any) {
    if (error.stderr?.includes('AccessDenied') || error.stderr?.includes('AccessDeniedException')) {
      logger.error('Insufficient permissions for cleanup.');
      logger.error('Please ask your AWS admin to grant these additional permissions:');
      logger.error('- s3:DeleteObject');
      logger.error('- s3:DeleteBucket');
      logger.error('- dynamodb:DeleteTable');
    } else {
      logger.error('Cleanup failed:', error);
    }
    process.exit(1);
  }
}

// Add handler for script interruption
process.on('SIGINT', () => {
  logger.warn('Cleanup interrupted');
  process.exit(1);
});

cleanup(); 