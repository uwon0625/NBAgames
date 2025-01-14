import { S3Client, CreateBucketCommand, PutBucketPolicyCommand, HeadBucketCommand, BucketLocationConstraint } from '@aws-sdk/client-s3';
import { logger } from '../../../src/config/logger';
import dotenv from 'dotenv';
import path from 'path';

// Fix the path to .env file
const envPath = path.resolve(__dirname, '../../../.env');
dotenv.config({ path: envPath });

const s3 = new S3Client({ region: process.env.AWS_REGION });

async function checkBucketExists(bucketName: string): Promise<boolean> {
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

async function createS3Bucket() {
  try {
    const bucketName = process.env.S3_BUCKET_NAME;
    const accountId = process.env.AWS_ACCOUNT_ID;
    const region = process.env.AWS_REGION;

    // Debug log to verify environment variables
    logger.info('Environment variables:', {
      bucketName,
      accountId,
      region,
      envPath
    });

    if (!bucketName || !accountId) {
      throw new Error('S3_BUCKET_NAME and AWS_ACCOUNT_ID environment variables are required');
    }

    // Check if bucket already exists
    const exists = await checkBucketExists(bucketName);
    if (exists) {
      logger.info(`S3 bucket '${bucketName}' already exists`);
      return bucketName;
    }

    // Create bucket
    await s3.send(new CreateBucketCommand({
      Bucket: bucketName,
      CreateBucketConfiguration: {
        LocationConstraint: region !== 'us-east-1' ? (region as BucketLocationConstraint) : undefined
      }
    }));

    // Set bucket policy
    const bucketPolicy = {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'LambdaAccess',
          Effect: 'Allow',
          Principal: {
            AWS: `arn:aws:iam::${accountId}:root`
          },
          Action: [
            's3:GetObject',
            's3:PutObject',
            's3:DeleteObject'
          ],
          Resource: `arn:aws:s3:::${bucketName}/*`
        }
      ]
    };

    await s3.send(new PutBucketPolicyCommand({
      Bucket: bucketName,
      Policy: JSON.stringify(bucketPolicy)
    }));
    logger.info(`Set bucket policy for: ${bucketName}`);

    return bucketName;
  } catch (error) {
    logger.error('Failed to create S3 bucket:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  createS3Bucket()
    .catch(() => process.exit(1));
}

export { createS3Bucket }; 