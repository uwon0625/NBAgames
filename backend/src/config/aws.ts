import { LambdaClient } from '@aws-sdk/client-lambda';
import { S3Client } from '@aws-sdk/client-s3';
import { IAMClient } from '@aws-sdk/client-iam';

// Initialize AWS clients
export const lambda = new LambdaClient({ region: process.env.AWS_REGION });
export const s3 = new S3Client({ region: process.env.AWS_REGION });
export const iam = new IAMClient({ region: process.env.AWS_REGION }); 