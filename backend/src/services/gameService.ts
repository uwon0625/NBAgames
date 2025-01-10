import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import Redis from 'ioredis';
import { logger } from '../config/logger';
import { GameScore, GameBoxScore } from '../types';

export class GameService {
  private ddbClient: DynamoDBClient;
  private docClient: DynamoDBDocumentClient;
  private redis: Redis;
  private tableName: string;

  constructor() {
    this.ddbClient = new DynamoDBClient({});
    this.docClient = DynamoDBDocumentClient.from(this.ddbClient);
    this.redis = new Redis(process.env.REDIS_ENDPOINT || '');
    this.tableName = process.env.DYNAMODB_TABLE_NAME || '';
  }

  async getGame(gameId: string): Promise<GameBoxScore | null> {
    try {
      // Try Redis first for box score
      const cachedBoxScore = await this.redis.get(`boxscore:${gameId}`);
      if (cachedBoxScore) {
        logger.debug(`Box score cache hit for game ${gameId}`);
        return JSON.parse(cachedBoxScore);
      }

      // Try Redis for basic game data
      const cachedGame = await this.redis.get(`game:${gameId}`);
      if (cachedGame) {
        logger.debug(`Basic game cache hit for game ${gameId}, but no box score available`);
        return null;
      }

      // Fallback to DynamoDB
      logger.info(`Cache miss for game ${gameId}, fetching from DynamoDB`);
      const result = await this.docClient.send(new GetCommand({
        TableName: this.tableName,
        Key: { gameId }
      }));

      if (!result.Item) {
        return null;
      }

      // Check if the item is a box score (has totals property)
      const gameData = result.Item;
      if ('homeTeam' in gameData && 'totals' in gameData.homeTeam) {
        // It's a box score
        const boxScore = gameData as GameBoxScore;
        await this.redis.set(
          `boxscore:${gameId}`,
          JSON.stringify(boxScore),
          'EX',
          60 * 5
        );
        return boxScore;
      }

      // If it's just basic game data, return null for box score request
      logger.debug(`Found basic game data for ${gameId}, but no box score available`);
      return null;
    } catch (error) {
      logger.error('Error fetching game:', error);
      throw error;
    }
  }

  async updateGame(game: GameScore | GameBoxScore): Promise<void> {
    try {
      // logger.debug('Updating game data:', game);
      
      // Update DynamoDB
      await this.docClient.send(new PutCommand({
        TableName: this.tableName,
        Item: game
      }));

      // Store in appropriate Redis key based on type
      const isBoxScore = 'homeTeam' in game && 'totals' in game.homeTeam;
      const key = isBoxScore ? `boxscore:${game.gameId}` : `game:${game.gameId}`;
      
      await this.redis.set(
        key,
        JSON.stringify(game),
        'EX',
        60 * 5
      );

      logger.debug(`Updated ${isBoxScore ? 'box score' : 'game'} data in Redis for ${game.gameId}`);
    } catch (error) {
      logger.error('Error updating game:', error);
      throw error;
    }
  }

  async getLiveGames(): Promise<GameScore[]> {
    try {
      const result = await this.docClient.send(new QueryCommand({
        TableName: this.tableName,
        IndexName: 'StatusLastUpdatedIndex',
        KeyConditionExpression: '#status = :status',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':status': 'LIVE'
        }
      }));

      return (result.Items || []) as GameScore[];
    } catch (error) {
      logger.error('Error fetching live games:', error);
      throw error;
    }
  }

  async getAllGames(): Promise<GameScore[]> {
    try {
      // Try Redis first
      const cachedGames = await this.redis.get('games:all');
      if (cachedGames) {
        logger.debug('Cache hit for all games');
        return JSON.parse(cachedGames);
      }

      // Fallback to DynamoDB
      logger.info('Cache miss for all games, fetching from DynamoDB');
      const result = await this.docClient.send(new ScanCommand({
        TableName: this.tableName
      }));

      const games = (result.Items || []) as GameScore[];
      
      // Cache the results
      await this.redis.set(
        'games:all',
        JSON.stringify(games),
        'EX',
        60 * 5 // 5 minutes
      );

      return games;
    } catch (error) {
      logger.error('Error fetching all games:', error);
      throw error;
    }
  }

  async cleanup(): Promise<void> {
    await this.redis.quit();
    await this.ddbClient.destroy();
  }
} 