import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { CacheService } from '../services/cacheService';
import { GameScore, GameAlert } from '../types';

const dynamoDb = new DynamoDBClient({});
const eventBridge = new EventBridgeClient({});
const cacheService = new CacheService();

async function updateGameData(gameUpdate: GameScore): Promise<void> {
  try {
    await dynamoDb.send(new PutItemCommand({
      TableName: process.env.DYNAMODB_TABLE_NAME || 'nba_games',
      Item: {
        gameId: { S: gameUpdate.gameId },
        data: { S: JSON.stringify(gameUpdate) },
        timestamp: { N: Date.now().toString() }
      }
    }));
  } catch (error) {
    console.error('Failed to update game data:', error);
    throw error;
  }
}

async function publishAlerts(alerts: GameAlert[]): Promise<void> {
  try {
    await eventBridge.send(new PutEventsCommand({
      Entries: alerts.map(alert => ({
        Source: 'nba-live-updates',
        DetailType: alert.type,
        Detail: JSON.stringify(alert),
        EventBusName: process.env.EVENT_BUS_NAME || 'default'
      }))
    }));
  } catch (error) {
    console.error('Failed to publish alerts:', error);
    throw error;
  }
}

function isLeadChange(gameUpdate: GameScore): boolean {
  // Implement lead change detection logic
  // For example, compare with previous state from DynamoDB
  return false; // Placeholder
}

export const handler = async (event: any) => {
  const gameUpdate = JSON.parse(event.Records[0].value) as GameScore;
  
  // Update DynamoDB
  await updateGameData(gameUpdate);
  
  // Update Redis cache
  await cacheService.cacheGameScore(gameUpdate.gameId, gameUpdate);
  
  // Check for significant events
  const alerts = detectSignificantEvents(gameUpdate);
  if (alerts.length > 0) {
    // Invalidate cache for significant updates
    await cacheService.invalidateGameCache(gameUpdate.gameId);
    await publishAlerts(alerts);
  }
};

const detectSignificantEvents = (gameUpdate: GameScore): GameAlert[] => {
  const alerts: GameAlert[] = [];
  
  // Detect lead changes, quarter ends, etc.
  if (isLeadChange(gameUpdate)) {
    alerts.push({
      gameId: gameUpdate.gameId,
      type: 'SCORE_UPDATE',
      message: `Lead change! ${gameUpdate.homeTeam.teamTricode} ${gameUpdate.homeTeam.score} - ${gameUpdate.awayTeam.score} ${gameUpdate.awayTeam.teamTricode}`,
      timestamp: Date.now()
    });
  }
  
  return alerts;
}; 