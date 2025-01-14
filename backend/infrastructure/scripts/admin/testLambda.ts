import { LambdaClient, InvokeCommand, GetFunctionCommand } from '@aws-sdk/client-lambda';
import { logger } from '../../../src/config/logger';

const lambda = new LambdaClient({ region: 'us-east-1' });

async function testLambda(functionName: string) {
  try {
    logger.info(`Testing Lambda function: ${functionName}`);

    // First, get the function configuration to verify the handler
    const getFunctionCommand = new GetFunctionCommand({
      FunctionName: functionName
    });
    const functionConfig = await lambda.send(getFunctionCommand);
    logger.info(`Function configuration:`, functionConfig.Configuration);
    
    const command = new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'RequestResponse',
      Payload: JSON.stringify({
        gameId: '0022300476' // Test game ID
      })
    });

    const response = await lambda.send(command);
    
    if (response.StatusCode === 200) {
      const payload = JSON.parse(Buffer.from(response.Payload!).toString());
      
      // Check if the payload contains an error
      if (payload.errorType || payload.errorMessage) {
        logger.error(`Lambda function ${functionName} failed:`, payload);
        return false;
      }

      // Check if the response contains an error status code
      if (payload.statusCode && payload.statusCode >= 400) {
        logger.error(`Lambda function ${functionName} returned error status:`, {
          statusCode: payload.statusCode,
          error: payload.body ? JSON.parse(payload.body) : payload
        });
        return false;
      }

      logger.info(`Lambda test successful for ${functionName}:`, payload);
      return true;
    } else {
      logger.error(`Lambda function ${functionName} returned status code ${response.StatusCode}`);
      return false;
    }
  } catch (error) {
    logger.error(`Error testing ${functionName}:`, error);
    return false;
  }
}

async function runTests() {
  const results = await Promise.all([
    testLambda('gameUpdateHandler')
  ]);

  const allPassed = results.every(result => result);
  
  if (allPassed) {
    logger.info('All Lambda tests passed');
    process.exit(0);
  } else {
    logger.error('Some Lambda tests failed');
    process.exit(1);
  }
}

// Add handler for script interruption
process.on('SIGINT', () => {
  logger.warn('Tests interrupted');
  process.exit(1);
});

runTests(); 