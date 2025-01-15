import { logger } from '../../../src/config/logger';
import { exec } from 'child_process';
import { promisify } from 'util';
import { 
  LambdaClient, 
  UpdateFunctionConfigurationCommand,
  CreateFunctionCommand,
  FunctionConfiguration
} from '@aws-sdk/client-lambda';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const execAsync = promisify(exec);
const lambda = new LambdaClient({ region: process.env.AWS_REGION });

interface LambdaEnvironment {
  Variables: {
    [key: string]: string;
  };
}

export async function setupLambda() {
  try {
    // 1. Install Lambda dependencies
    logger.info('Installing Lambda dependencies...');
    await execAsync('yarn setup:lambda');

    // 2. Build Lambda functions
    logger.info('Building Lambda functions...');
    await execAsync('yarn build:lambda');

    // 3. Deploy Lambda functions
    logger.info('Deploying Lambda functions...');
    await execAsync('yarn deploy:lambda');

    // 4. Test Lambda functions
    logger.info('Testing Lambda functions...');
    await execAsync('yarn test:lambda');

    // Update Lambda environment variables
    const environment: LambdaEnvironment = {
      Variables: {
        NODE_ENV: process.env.NODE_ENV || 'production',
        AWS_REGION: process.env.AWS_REGION || 'us-east-1',
        DYNAMODB_TABLE_NAME: process.env.DYNAMODB_TABLE_NAME || '',
        KAFKA_BROKERS: process.env.KAFKA_BROKERS || '',
        REDIS_ENDPOINT: process.env.REDIS_ENDPOINT || '',
      }
    };

    const functionName = `nba-live-gameUpdateHandler-${process.env.ENVIRONMENT}`;

    // Update Lambda configuration
    await lambda.send(new UpdateFunctionConfigurationCommand({
      FunctionName: functionName,
      Environment: environment,
      Timeout: 30,
      MemorySize: 256,
      VpcConfig: {
        SubnetIds: [
          process.env.SUBNET_1!,
          process.env.SUBNET_2!,
          process.env.SUBNET_3!
        ],
        SecurityGroupIds: [process.env.SECURITY_GROUP_ID!]
      }
    }));

    logger.info('Lambda setup completed successfully');
  } catch (error) {
    logger.error('Error setting up Lambda:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  setupLambda()
    .catch(() => process.exit(1));
} 