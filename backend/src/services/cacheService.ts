import { redisClient } from '../config/redis';
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { 
  DynamoDBDocumentClient, 
  PutCommand, 
  ScanCommand 
} from "@aws-sdk/lib-dynamodb";
import { GameScore } from '../types';
import { logger } from '../config/logger';

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  } : undefined
});

const docClient = DynamoDBDocumentClient.from(client);
const CACHE_KEY = 'nba:scoreboard';

export async function saveToDatabase(games: GameScore[]) {
  try {
    logger.info('Saving games to cache:', {
      firstGame: games[0],
      firstGameHomeTeam: games[0].homeTeam,
      firstGameAwayTeam: games[0].awayTeam
    });
    logger.info(`Saving games to DynamoDB in region ${process.env.AWS_REGION}`);
    
    // Log what we're saving
    logger.debug('Games being saved:', games);

    // Save to Redis
    await redisClient.set(CACHE_KEY, JSON.stringify(games), 'EX', 120);

    // Save to DynamoDB
    for (const game of games) {
      const command = new PutCommand({
        TableName: process.env.DYNAMODB_TABLE_NAME || 'nba_games',
        Item: game
      });
      await docClient.send(command);
    }

    logger.info('Successfully saved games to DynamoDB');
  } catch (error) {
    logger.error('Failed to save games:', error);
    throw error;
  }
}

export async function getScoreboardFromCache(): Promise<GameScore[]> {
  try {
    // Try Redis first
    const cachedData = await redisClient.get(CACHE_KEY);
    if (cachedData) {
      const games = JSON.parse(cachedData);
      logger.debug('Retrieved from Redis:', games);
      return games;
    }

    // If not in Redis, try DynamoDB
    const command = new ScanCommand({
      TableName: process.env.DYNAMODB_TABLE_NAME || 'nba_games'
    });

    const data = await docClient.send(command);
    if (data.Items && data.Items.length > 0) {
      logger.debug('Retrieved from DynamoDB:', data.Items);
      return data.Items as GameScore[];
    }

    return [];
  } catch (error) {
    logger.error('Failed to get games from cache:', error);
    return [];
  }
} 