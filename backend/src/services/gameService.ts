import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import Redis from 'ioredis';
import { logger } from '../config/logger';
import { GameScore, GameBoxScore } from '../types';
import { GameStatus } from '../types/enums';
import { getTodaysGames } from './nbaService';

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
      // Try Redis first
      const cachedLiveGames = await this.redis.get('games:live');
      if (cachedLiveGames) {
        logger.debug('Cache hit for live games');
        return JSON.parse(cachedLiveGames);
      }

      // Query DynamoDB using GSI
      const result = await this.docClient.send(new QueryCommand({
        TableName: this.tableName,
        IndexName: 'StatusIndex',
        KeyConditionExpression: '#status = :status',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':status': GameStatus.LIVE
        }
      }));

      const games = (result.Items || []) as GameScore[];
      
      // Cache live games with short TTL
      await this.redis.set(
        'games:live',
        JSON.stringify(games),
        'EX',
        30 // 30 seconds
      );

      return games;
    } catch (error) {
      logger.error('Error fetching live games:', error);
      throw error;
    }
  }

  async getAllGames(): Promise<GameScore[]> {
    try {
      // Try Redis first with a shorter TTL for live games
      const cachedGames = await this.redis.get('games:all');
      if (cachedGames) {
        const games = JSON.parse(cachedGames);
        // Check if we need to refresh live games
        const hasLiveGames = games.some((g: GameScore) => g.status === GameStatus.LIVE);
        if (!hasLiveGames) {
          logger.debug('Cache hit for all games (no live games)');
          return games;
        }
      }

      // Fallback to DynamoDB
      logger.info('Cache miss or has live games, fetching from DynamoDB');
      const result = await this.docClient.send(new ScanCommand({
        TableName: this.tableName
      }));

      const games = (result.Items || []) as GameScore[];
      
      // Cache with TTL based on game states
      const ttl = games.some(g => g.status === GameStatus.LIVE) ? 30 : 300; // 30s for live games, 5m otherwise
      await this.redis.set(
        'games:all',
        JSON.stringify(games),
        'EX',
        ttl
      );

      return games;
    } catch (error) {
      logger.error('Error fetching all games:', error);
      throw error;
    }
  }

  async getTodaysGames(): Promise<GameScore[]> {
    try {
      // Try Redis first
      const cachedGames = await this.redis.get('games:today');
      if (cachedGames) {
        const games = JSON.parse(cachedGames);
        const hasLiveGames = games.some((g: GameScore) => g.status === GameStatus.LIVE);
        if (!hasLiveGames) {
          logger.debug('Cache hit for today\'s games (no live games)');
          return games;
        }
      }

      // Get basic game data from NBA API
      const basicGames = await getTodaysGames();
      
      // Get full game data from DynamoDB to get the stats
      const result = await this.docClient.send(new ScanCommand({
        TableName: this.tableName,
        FilterExpression: 'gameId IN (' + basicGames.map((_,i) => `:id${i}`).join(',') + ')',
        ExpressionAttributeValues: basicGames.reduce((acc: Record<string, string>, game, idx) => {
          acc[`:id${idx}`] = game.gameId;
          return acc;
        }, {})
      }));

      const dbGames = (result.Items || []) as GameScore[];
      
      // Merge NBA API data with DynamoDB data (keeping stats from DB)
      const games = basicGames.map(apiGame => {
        const dbGame = dbGames.find(g => g.gameId === apiGame.gameId);
        if (dbGame) {
          return {
            ...apiGame,
            homeTeam: {
              ...apiGame.homeTeam,
              stats: dbGame.homeTeam.stats
            },
            awayTeam: {
              ...apiGame.awayTeam,
              stats: dbGame.awayTeam.stats
            }
          };
        }
        return apiGame;
      });

      // Cache with dynamic TTL
      const ttl = games.some(g => g.status === GameStatus.LIVE) ? 30 : 300;
      await this.redis.set(
        'games:today',
        JSON.stringify(games),
        'EX',
        ttl
      );

      return games;
    } catch (error) {
      logger.error('Error fetching today\'s games:', error);
      throw error;
    }
  }

  async cleanup(): Promise<void> {
    await this.redis.quit();
    await this.ddbClient.destroy();
  }
} 