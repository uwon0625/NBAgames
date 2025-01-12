import { executeCommand, CommandError } from './utils/aws-commands';
import { logger } from '../backend/src/config/logger';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
dotenv.config();

const LAMBDA_CONFIG = {
  boxScoreHandler: {
    name: 'boxScoreHandler',
    arn: `arn:aws:lambda:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}:function:boxScoreHandler`
  },
  gameUpdateHandler: {
    name: 'gameUpdateHandler',
    arn: `arn:aws:lambda:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}:function:gameUpdateHandler`
  }
};

async function ensureDirectoryExists(dirPath: string): Promise<void> {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

async function checkS3BucketExists(bucketName: string): Promise<boolean> {
  try {
    await executeCommand(`aws s3api head-bucket --bucket ${bucketName}`);
    return true;
  } catch (error: any) {
    if (error.stderr?.includes('404')) {
      return false;
    }
    // If it's not a 404, it might be permissions or other issues
    throw error;
  }
}

async function checkS3ObjectExists(bucketName: string, key: string): Promise<boolean> {
  try {
    await executeCommand(`aws s3api head-object --bucket ${bucketName} --key ${key}`);
    return true;
  } catch (error: any) {
    if (error.stderr?.includes('404')) {
      return false;
    }
    throw error;
  }
}

async function checkDynamoTableExists(tableName: string): Promise<boolean> {
  try {
    await executeCommand(
      `aws dynamodb describe-table --table-name ${tableName} ` +
      `--region ${process.env.AWS_REGION}`
    );
    return true;
  } catch (error: any) {
    if (error.stderr?.includes('ResourceNotFoundException')) {
      return false;
    }
    if (error.stderr?.includes('AccessDeniedException')) {
      logger.warn('No permission to check DynamoDB table. Assuming table needs to be created.');
      return false;
    }
    throw error;
  }
}

async function waitForDynamoTableStatus(tableName: string, expectedStatus: string): Promise<void> {
  logger.info(`Waiting for DynamoDB table ${tableName} to be ${expectedStatus}...`);
  for (let i = 0; i < 30; i++) {
    try {
      const result = await executeCommand(
        `aws dynamodb describe-table --table-name ${tableName} ` +
        `--region ${process.env.AWS_REGION} ` +
        '--query Table.TableStatus --output text'
      );
      if (result.trim() === expectedStatus) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
    } catch (error) {
      const cmdError = error as CommandError;
      // If table not found, keep waiting
      if (!cmdError.stderr?.includes('ResourceNotFoundException')) {
        throw error;
      }
    }
  }
  throw new Error(`Timeout waiting for table ${tableName} to be ${expectedStatus}`);
}

async function setupEventBridgeRules() {
  try {
    // Create EventBridge rule for game updates
    await executeCommand(
      'aws events put-rule ' +
      '--name nba-game-updates ' +
      '--schedule-expression "rate(1 minute)" ' +
      '--state ENABLED'
    );

    // Set Lambda as target
    await executeCommand(
      'aws events put-targets ' +
      '--rule nba-game-updates ' +
      '--targets ' + 
      `'[{"Id": "1", "Arn": "${LAMBDA_CONFIG.gameUpdateHandler.arn}"}]'`
    );

    logger.info('EventBridge rules configured successfully');
  } catch (error) {
    logger.error('Failed to setup EventBridge rules:', error);
    throw error;
  }
}

async function setupLambdaPermissions() {
  try {
    // Allow EventBridge to invoke game update handler
    await executeCommand(
      'aws lambda add-permission ' +
      `--function-name ${LAMBDA_CONFIG.gameUpdateHandler.name} ` +
      '--statement-id EventBridgeInvoke ' +
      '--action lambda:InvokeFunction ' +
      '--principal events.amazonaws.com ' +
      `--source-arn arn:aws:events:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}:rule/nba-game-updates`
    );

    logger.info('Lambda permissions configured successfully');
  } catch (error) {
    logger.error('Failed to setup Lambda permissions:', error);
    throw error;
  }
}

async function setup() {
  try {
    // Validate AWS credentials
    logger.info('Validating AWS credentials...');
    const identity = await executeCommand('aws sts get-caller-identity');
    logger.info('Using AWS identity:', identity);

    // Check and create S3 bucket for artifacts
    const bucketName = process.env.S3_BUCKET_NAME;
    if (!bucketName) {
      throw new Error('S3_BUCKET_NAME is not defined in .env');
    }

    const bucketExists = await checkS3BucketExists(bucketName);
    if (bucketExists) {
      logger.info(`S3 bucket already exists: ${bucketName}`);
    } else {
      logger.info(`Creating S3 bucket: ${bucketName}`);
      await executeCommand(`aws s3 mb s3://${bucketName} --region ${process.env.AWS_REGION}`);
    }

    // Package and upload Lambda code
    logger.info('Packaging Lambda code...');
    const sourceDir = path.join('..', 'backend', 'src', 'lambdas');
    const targetDir = path.join('.', 'lambda');
    const lambdaKey = 'lambda/gameUpdateHandler.zip';
    
    // Create lambda directory
    await ensureDirectoryExists(targetDir);

    // Check if Lambda code already exists in S3
    const lambdaExists = await checkS3ObjectExists(bucketName, lambdaKey);
    
    if (lambdaExists) {
      logger.info('Lambda code already exists in S3, checking for local changes...');
      
      // Create new zip for comparison
      const isWindows = process.platform === 'win32';
      if (isWindows) {
        await executeCommand(
          `powershell Compress-Archive -Path "${path.join(sourceDir, 'gameUpdateHandler.ts')}" ` +
          `-DestinationPath "${path.join(targetDir, 'gameUpdateHandler.zip')}" -Force`
        );
      } else {
        await executeCommand(
          `cd ${sourceDir} && zip -r ${path.join('..', '..', '..', 'infrastructure', targetDir, 'gameUpdateHandler.zip')} gameUpdateHandler.ts`
        );
      }

      // Download existing zip for comparison
      const tempFile = path.join(targetDir, 'existing-gameUpdateHandler.zip');
      await executeCommand(
        `aws s3 cp s3://${bucketName}/${lambdaKey} ${tempFile}`
      );

      // Compare files (using PowerShell on Windows, diff on Unix)
      let filesMatch = false;
      if (isWindows) {
        try {
          await executeCommand(
            `powershell Compare-Object -ReferenceObject (Get-FileHash "${path.join(targetDir, 'gameUpdateHandler.zip')}").Hash ` +
            `-DifferenceObject (Get-FileHash "${tempFile}").Hash`
          );
          filesMatch = true;
        } catch {
          filesMatch = false;
        }
      } else {
        try {
          await executeCommand(
            `diff "${path.join(targetDir, 'gameUpdateHandler.zip')}" "${tempFile}"`
          );
          filesMatch = true;
        } catch {
          filesMatch = false;
        }
      }

      if (filesMatch) {
        logger.info('Lambda code is up to date');
      } else {
        logger.info('Lambda code has changed, uploading new version...');
        await executeCommand(
          `aws s3 cp ${path.join(targetDir, 'gameUpdateHandler.zip')} s3://${bucketName}/${lambdaKey}`
        );
      }

      // Clean up temp file
      fs.unlinkSync(tempFile);
    } else {
      // Create and upload new Lambda package
      logger.info('Creating new Lambda package...');
      const isWindows = process.platform === 'win32';
      if (isWindows) {
        await executeCommand(
          `powershell Compress-Archive -Path "${path.join(sourceDir, 'gameUpdateHandler.ts')}" ` +
          `-DestinationPath "${path.join(targetDir, 'gameUpdateHandler.zip')}" -Force`
        );
      } else {
        await executeCommand(
          `cd ${sourceDir} && zip -r ${path.join('..', '..', '..', 'infrastructure', targetDir, 'gameUpdateHandler.zip')} gameUpdateHandler.ts`
        );
      }

      logger.info('Uploading Lambda package to S3...');
      await executeCommand(
        `aws s3 cp ${path.join(targetDir, 'gameUpdateHandler.zip')} s3://${bucketName}/${lambdaKey}`
      );
    }

    // Check and create DynamoDB tables
    const gamesTableName = process.env.DYNAMODB_TABLE_NAME;
    if (!gamesTableName) {
      throw new Error('DYNAMODB_TABLE_NAME is not defined in .env');
    }

    let tableExists = false; // Declare variable outside try block
    try {
      tableExists = await checkDynamoTableExists(gamesTableName);
      if (tableExists) {
        logger.info(`DynamoDB table already exists: ${gamesTableName}`);
      } else {
        logger.info(`Attempting to create DynamoDB table: ${gamesTableName}`);
        try {
          await executeCommand(
            'aws dynamodb create-table ' +
            `--table-name ${gamesTableName} ` +
            '--attribute-definitions AttributeName=gameId,AttributeType=S ' +
            '--key-schema AttributeName=gameId,KeyType=HASH ' +
            '--billing-mode PAY_PER_REQUEST ' +
            `--region ${process.env.AWS_REGION}`
          );
          await waitForDynamoTableStatus(gamesTableName, 'ACTIVE');
          logger.info(`DynamoDB table created successfully: ${gamesTableName}`);
          tableExists = true; // Update after successful creation
        } catch (error: any) {
          if (error.stderr?.includes('AccessDeniedException')) {
            logger.warn('No permission to create DynamoDB table.');
            logger.warn('Please ask your AWS admin to create the table with these properties:');
            logger.warn(`- Table name: ${gamesTableName}`);
            logger.warn('- Partition key: gameId (String)');
            logger.warn('- Billing mode: PAY_PER_REQUEST');
          } else {
            throw error;
          }
        }
      }
    } catch (error: any) {
      if (error.stderr?.includes('AccessDeniedException')) {
        logger.warn('No DynamoDB permissions available.');
        logger.warn('Please ask your AWS admin to grant these permissions:');
        logger.warn('- dynamodb:DescribeTable');
        logger.warn('- dynamodb:CreateTable');
        logger.warn('- dynamodb:PutItem');
        logger.warn('- dynamodb:GetItem');
        logger.warn('- dynamodb:UpdateItem');
      } else {
        throw error;
      }
    }

    // Setup Lambda permissions and EventBridge rules
    await setupLambdaPermissions();
    await setupEventBridgeRules();

    logger.info('Infrastructure setup completed successfully');
  } catch (error) {
    logger.error('Infrastructure setup failed:', error);
    process.exit(1);
  }
}

setup(); 