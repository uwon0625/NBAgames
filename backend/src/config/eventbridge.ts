import { EventBridgeClient, PutRuleCommand } from '@aws-sdk/client-eventbridge';

const eventbridge = new EventBridgeClient({});

export const setupEventRules = async () => {
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
}; 