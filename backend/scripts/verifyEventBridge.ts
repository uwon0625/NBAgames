import { 
  EventBridgeClient, 
  ListRulesCommand, 
  ListTargetsByRuleCommand,
  DescribeRuleCommand
} from '@aws-sdk/client-eventbridge';
import { logger } from '../src/config/logger';

const eventbridge = new EventBridgeClient({ region: 'us-east-1' });

const EXPECTED_RULES = [
  {
    name: 'nba-score-updates',
    schedule: 'rate(1 minute)',
    targetFunction: 'gameUpdateHandler'
  },
  {
    name: 'nba-boxscore-updates',
    schedule: 'rate(2 minutes)',
    targetFunction: 'boxScoreHandler'
  }
];

export async function verifyEventBridgeSetup() {
  try {
    logger.info('Verifying EventBridge setup...');

    // List all rules
    const rulesResponse = await eventbridge.send(new ListRulesCommand({
      NamePrefix: 'nba-'
    }));

    if (!rulesResponse.Rules?.length) {
      logger.error('No EventBridge rules found with prefix "nba-"');
      return false;
    }

    // Verify each expected rule
    for (const expectedRule of EXPECTED_RULES) {
      logger.info(`Checking rule: ${expectedRule.name}`);

      // Check rule exists and is enabled
      const ruleDetails = await eventbridge.send(new DescribeRuleCommand({
        Name: expectedRule.name
      }));

      if (!ruleDetails.State || ruleDetails.State !== 'ENABLED') {
        logger.error(`Rule ${expectedRule.name} is not enabled`);
        return false;
      }

      // Check rule schedule
      if (ruleDetails.ScheduleExpression !== expectedRule.schedule) {
        logger.error(`Rule ${expectedRule.name} has incorrect schedule: ${ruleDetails.ScheduleExpression}`);
        return false;
      }

      // Check rule targets
      const targetsResponse = await eventbridge.send(new ListTargetsByRuleCommand({
        Rule: expectedRule.name
      }));

      const target = targetsResponse.Targets?.find(t => 
        t.Arn?.includes(expectedRule.targetFunction)
      );

      if (!target) {
        logger.error(`Rule ${expectedRule.name} is not targeting ${expectedRule.targetFunction}`);
        return false;
      }

      logger.info(`✓ Rule ${expectedRule.name} is properly configured`);
    }

    logger.info('All EventBridge rules are properly configured');
    return true;

  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('AccessDenied')) {
        logger.error('Access denied. Please check IAM permissions for EventBridge:');
        logger.error('Required permissions:');
        logger.error('- events:ListRules');
        logger.error('- events:DescribeRule');
        logger.error('- events:ListTargetsByRule');
      } else {
        logger.error('Error verifying EventBridge setup:', error);
      }
    }
    return false;
  }
}

// Only run if called directly
if (require.main === module) {
  verifyEventBridgeSetup()
    .then(success => {
      if (!success) {
        process.exit(1);
      }
    })
    .catch(error => {
      logger.error('Verification failed:', error);
      process.exit(1);
    });
} 