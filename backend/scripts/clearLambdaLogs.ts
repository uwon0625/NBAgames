import { CloudWatchLogsClient, DeleteLogGroupCommand, DescribeLogGroupsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { logger } from '../src/config/logger';

const cloudwatch = new CloudWatchLogsClient({ region: process.env.AWS_REGION || 'us-east-1' });

async function clearLambdaLogs(functionName?: string) {
  try {
    // Get all Lambda log groups
    const logGroups = await cloudwatch.send(new DescribeLogGroupsCommand({
      logGroupNamePrefix: '/aws/lambda/' + (functionName || '')
    }));

    if (!logGroups.logGroups?.length) {
      logger.info('No log groups found');
      return;
    }

    // Delete each log group
    for (const group of logGroups.logGroups) {
      if (!group.logGroupName) continue;
      
      try {
        logger.info(`Deleting log group: ${group.logGroupName}`);
        await cloudwatch.send(new DeleteLogGroupCommand({
          logGroupName: group.logGroupName
        }));
        logger.info(`Successfully deleted: ${group.logGroupName}`);
      } catch (error) {
        logger.error(`Failed to delete log group ${group.logGroupName}:`, error);
        // Continue with other groups even if one fails
      }
    }

    logger.info('Finished clearing Lambda logs');
  } catch (error) {
    logger.error('Failed to list Lambda logs:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  const functionName = process.argv[2]; // Optional function name argument
  clearLambdaLogs(functionName)
    .catch(() => process.exit(1));
}

export { clearLambdaLogs }; 