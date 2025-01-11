import { LambdaClient, CreateFunctionCommand, UpdateFunctionCodeCommand } from '@aws-sdk/client-lambda';
import { zip } from 'zip-a-folder';
import { logger } from '../src/config/logger';
import path from 'path';
import fs from 'fs';

const lambda = new LambdaClient({ region: 'us-east-1' });

async function createZip(handlerName: string) {
  const sourceDir = path.join(__dirname, '../dist/lambdas');
  const zipPath = path.join(__dirname, `../dist/${handlerName}.zip`);
  
  // Ensure the handler file exists
  const handlerFile = path.join(sourceDir, `${handlerName}.js`);
  if (!fs.existsSync(handlerFile)) {
    throw new Error(`Handler file not found: ${handlerFile}`);
  }

  // Create a temporary directory for the handler
  const tempDir = path.join(__dirname, '../dist/temp', handlerName);
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // Copy handler and its dependencies
  fs.copyFileSync(handlerFile, path.join(tempDir, `${handlerName}.js`));
  
  // Create zip from the temp directory
  await zip(tempDir, zipPath);
  
  // Clean up temp directory
  fs.rmSync(tempDir, { recursive: true, force: true });
  
  return fs.readFileSync(zipPath);
}

async function deployFunction(name: string, handler: string) {
  try {
    const zipFile = await createZip(handler);
    
    try {
      // Try to update existing function
      await lambda.send(new UpdateFunctionCodeCommand({
        FunctionName: name,
        ZipFile: zipFile
      }));
      logger.info(`Updated Lambda function: ${name}`);
    } catch (error: any) {
      if (error.name === 'ResourceNotFoundException') {
        // Create new function if it doesn't exist
        await lambda.send(new CreateFunctionCommand({
          FunctionName: name,
          Runtime: 'nodejs18.x',
          Role: `arn:aws:iam::886436930781:role/lambda-nba-role`,
          Handler: `${handler}.handler`,
          Code: {
            ZipFile: zipFile
          },
          Environment: {
            Variables: {
              DYNAMODB_TABLE_NAME: 'nba_games',
              NBA_BASE_URL: process.env.NBA_BASE_URL || '',
              REDIS_ENDPOINT: process.env.REDIS_ENDPOINT || ''
            }
          },
          Timeout: 30,
          MemorySize: 256
        }));
        logger.info(`Created Lambda function: ${name}`);
      } else {
        throw error;
      }
    }
  } catch (error) {
    logger.error(`Failed to deploy ${name}:`, error);
    throw error;
  }
}

async function deploy() {
  try {
    await deployFunction('boxScoreHandler', 'boxScoreHandler');
    await deployFunction('gameUpdateHandler', 'gameUpdateHandler');
    logger.info('Lambda deployment completed');
  } catch (error) {
    logger.error('Lambda deployment failed:', error);
    process.exit(1);
  }
}

deploy(); 