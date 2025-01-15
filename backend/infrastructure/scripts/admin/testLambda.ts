import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { logger } from '../../../src/config/logger';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const lambda = new LambdaClient({ region: process.env.AWS_REGION });

async function testLambda() {
  try {
    const functionName = 'gameUpdateHandler';
    logger.info(`Testing Lambda function: ${functionName}`);

    // Get function configuration
    const config = await lambda.send(new InvokeCommand({
      FunctionName: functionName,
      LogType: 'Tail',
      Payload: JSON.stringify({
        games: [{
          gameId: "0022300001",
          gameStatus: 1,
          gameStatusText: "7:30 pm ET",
          homeTeam: {
            teamId: "1610612738",
            teamName: "Celtics",
            score: 0
          },
          awayTeam: {
            teamId: "1610612752",
            teamName: "Knicks",
            score: 0
          },
          period: 0,
          gameClock: "PT12M",
          gameDate: "2024-01-14"
        }]
      })
    }));

    logger.info('Function configuration:', config);

    if (config.FunctionError) {
      logger.error('Lambda function returned error:', {
        error: config.FunctionError,
        logs: Buffer.from(config.LogResult || '', 'base64').toString()
      });
      return;
    }

    const response = JSON.parse(Buffer.from(config.Payload!).toString());
    if (response.statusCode !== 200) {
      logger.error(`Lambda function ${functionName} returned error status:`, response);
      return;
    }

    logger.info(`Lambda function ${functionName} executed successfully:`, response);

  } catch (error) {
    logger.error('Failed to test Lambda function:', error);
    throw error;
  }
}

if (require.main === module) {
  testLambda().catch(() => process.exit(1));
} 