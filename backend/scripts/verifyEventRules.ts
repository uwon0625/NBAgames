import { EventBridgeClient, ListRulesCommand, ListTargetsByRuleCommand } from '@aws-sdk/client-eventbridge';
import { logger } from '../src/config/logger';

const eventbridge = new EventBridgeClient({ region: 'us-east-1' });

async function verifyEventRules() {
  try {
    // List all rules
    const rulesResponse = await eventbridge.send(new ListRulesCommand({}));
    
    const rules = rulesResponse.Rules?.filter(rule => 
      rule.Name?.includes('nba-') || 
      rule.Name?.includes('game-')
    );

    if (!rules?.length) {
      logger.error('No NBA-related EventBridge rules found');
      return false;
    }

    // Check targets for each rule
    for (const rule of rules) {
      const targetsResponse = await eventbridge.send(new ListTargetsByRuleCommand({
        Rule: rule.Name
      }));

      if (!targetsResponse.Targets?.length) {
        logger.error(`No targets found for rule: ${rule.Name}`);
        return false;
      }

      logger.info(`Rule ${rule.Name} is properly configured with ${targetsResponse.Targets.length} targets`);
    }

    return true;
  } catch (error) {
    logger.error('Error verifying EventBridge rules:', error);
    return false;
  }
}

verifyEventRules()
  .then(success => process.exit(success ? 0 : 1)); 