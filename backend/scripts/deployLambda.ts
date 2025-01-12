import { LambdaClient, CreateFunctionCommand, UpdateFunctionCodeCommand, UpdateFunctionConfigurationCommand, GetFunctionCommand } from '@aws-sdk/client-lambda';
import { zip } from 'zip-a-folder';
import { logger } from '../src/config/logger';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const lambda = new LambdaClient({ region: 'us-east-1' });

async function createZip(handlerName: string) {
  const sourceDir = path.join(__dirname, '../dist');
  const tempDir = path.join(__dirname, '../dist/temp', handlerName);
  const zipPath = path.join(__dirname, `../dist/${handlerName}.zip`);
  
  try {
    // Create temp directory
    fs.mkdirSync(tempDir, { recursive: true });

    // Copy handler and its dependencies
    const handlerFile = path.join(sourceDir, 'lambdas', `${handlerName}.js`);
    if (!fs.existsSync(handlerFile)) {
      logger.error(`Handler file not found: ${handlerFile}`);
      throw new Error('Handler file not found');
    }

    // Create directory structure
    fs.mkdirSync(path.join(tempDir, 'config'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'services'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'types'), { recursive: true });

    // Copy config files
    const configFiles = fs.readdirSync(path.join(sourceDir, 'config'));
    configFiles.forEach(file => {
      fs.copyFileSync(
        path.join(sourceDir, 'config', file),
        path.join(tempDir, 'config', file)
      );
    });

    // Copy service files
    const serviceFiles = fs.readdirSync(path.join(sourceDir, 'services'));
    serviceFiles.forEach(file => {
      fs.copyFileSync(
        path.join(sourceDir, 'services', file),
        path.join(tempDir, 'services', file)
      );
    });

    // Copy type files
    const typeFiles = fs.readdirSync(path.join(sourceDir, 'types'));
    typeFiles.forEach(file => {
      fs.copyFileSync(
        path.join(sourceDir, 'types', file),
        path.join(tempDir, 'types', file)
      );
    });

    // Copy and rename handler
    fs.copyFileSync(handlerFile, path.join(tempDir, 'index.js'));

    // Create package.json in temp directory
    const packageJson = {
      name: handlerName,
      version: '1.0.0',
      main: 'index.js',
      type: 'commonjs',
      dependencies: {
        'kafkajs': '^2.2.4',
        'axios': '^1.6.0'
      }
    };
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify(packageJson, null, 2)
    );

    // Install dependencies
    logger.info(`Installing dependencies in ${tempDir}`);
    execSync('yarn install --production --no-lockfile', {
      cwd: tempDir,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'production' }
    });

    // Log directory contents
    logger.debug('Zip directory contents:', fs.readdirSync(tempDir));
    logger.debug('Final index.js contents:', fs.readFileSync(path.join(tempDir, 'index.js'), 'utf8'));

    // Create zip file
    await zip(tempDir, zipPath);
    logger.info(`Created zip file: ${zipPath}`);

    return zipPath;
  } catch (error) {
    logger.error('Error creating zip file:', error);
    throw error;
  } finally {
    // Cleanup temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  }
}

async function deployFunction(handlerName: string, functionName: string) {
  try {
    const zipPath = await createZip(handlerName);
    const zipContents = fs.readFileSync(zipPath);

    try {
      // Try to update existing function
      try {
        // First update the configuration
        const updateConfigCommand = new UpdateFunctionConfigurationCommand({
          FunctionName: functionName,
          Handler: 'index.handler'
        });
        await lambda.send(updateConfigCommand);
        logger.info(`Updated Lambda function configuration: ${functionName}`);

        // Wait for the configuration update to complete
        await waitForFunctionUpdate(functionName);

        // Then update the code
        const updateCommand = new UpdateFunctionCodeCommand({
          FunctionName: functionName,
          ZipFile: zipContents
        });
        await lambda.send(updateCommand);
        logger.info(`Updated Lambda function code: ${functionName}`);

        // Wait for the code update to complete
        await waitForFunctionUpdate(functionName);

      } catch (updateError: any) {
        if (updateError.name === 'ResourceNotFoundException') {
          // Create new function if it doesn't exist
          await lambda.send(new CreateFunctionCommand({
            FunctionName: functionName,
            Runtime: 'nodejs18.x',
            Role: process.env.LAMBDA_ROLE_ARN,
            Handler: 'index.handler',
            Code: {
              ZipFile: zipContents
            },
            Environment: {
              Variables: {
                NBA_BASE_URL: process.env.NBA_BASE_URL || '',
                KAFKA_BROKERS: process.env.KAFKA_BROKERS || '',
                KAFKA_TOPIC: 'nba-game-updates',
                KAFKA_SASL_USERNAME: process.env.KAFKA_SASL_USERNAME || '',
                KAFKA_SASL_PASSWORD: process.env.KAFKA_SASL_PASSWORD || '',
                NODE_ENV: 'production'
              }
            },
            Timeout: 30,
            MemorySize: 256
          }));
          logger.info(`Created Lambda function: ${functionName}`);

          // Wait for the function to be ready
          await waitForFunctionUpdate(functionName);
        } else {
          throw updateError;
        }
      }
    } catch (error) {
      logger.error(`Failed to deploy ${functionName}:`, error);
      throw error;
    }
  } catch (error) {
    logger.error(`Failed to create zip for ${functionName}:`, error);
    throw error;
  }
}

// Add this new function to handle waiting for updates
async function waitForFunctionUpdate(functionName: string, maxAttempts = 10) {
  const { GetFunctionCommand } = await import('@aws-sdk/client-lambda');
  
  for (let i = 0; i < maxAttempts; i++) {
    const getFunctionCommand = new GetFunctionCommand({
      FunctionName: functionName
    });
    
    const response = await lambda.send(getFunctionCommand);
    const lastUpdateStatus = response.Configuration?.LastUpdateStatus;
    
    if (lastUpdateStatus === 'Successful') {
      logger.info(`Function ${functionName} update completed successfully`);
      return;
    } else if (lastUpdateStatus === 'Failed') {
      throw new Error(`Function ${functionName} update failed`);
    }
    
    logger.info(`Waiting for function ${functionName} update to complete (attempt ${i + 1}/${maxAttempts})...`);
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  throw new Error(`Timeout waiting for function ${functionName} update to complete`);
}

async function deploy() {
  try {
    await deployFunction('gameUpdateHandler', 'gameUpdateHandler');
    logger.info('Lambda deployment completed');
  } catch (error) {
    logger.error('Lambda deployment failed:', error);
    process.exit(1);
  }
}

deploy(); 