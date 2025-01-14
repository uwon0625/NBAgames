import { EventBridgeClient, PutRuleCommand } from '@aws-sdk/client-eventbridge';
import { logger } from '../../src/config/logger';

const eventbridge = new EventBridgeClient({});

export async function setupEventBridge() {
  try {
    // Rule for score updates
    await eventbridge.send(new PutRuleCommand({
      Name: 'ScoreUpdateRule',
      EventPattern: JSON.stringify({
        source: ['nba-live-updates'],
        detailType: ['SCORE_UPDATE']
      }),
      State: 'ENABLED'
    }));
    
    // Rule for game state changes
    await eventbridge.send(new PutRuleCommand({
      Name: 'GameStateRule',
      EventPattern: JSON.stringify({
        source: ['nba-live-updates'],
        detailType: ['GAME_START', 'GAME_END', 'QUARTER_END']
      }),
      State: 'ENABLED'
    }));

    logger.info('EventBridge rules created successfully');
  } catch (error) {
    logger.error('Failed to setup EventBridge rules:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  setupEventBridge()
    .catch(() => process.exit(1));
} 