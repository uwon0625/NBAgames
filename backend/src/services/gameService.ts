import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import Redis from 'ioredis';
import { logger } from '../config/logger';
import { GameScore, GameBoxScore, NBATeamStats, TeamBoxScore, Team } from '../types';
import { GameStatus } from '../types/enums';
import { getTodaysGames } from './nbaService';
import { getGameBoxScore } from './nbaService';

// Add validation interfaces
interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export class GameService {
  private static instance: GameService;
  private ddbClient: DynamoDBClient;
  private docClient: DynamoDBDocumentClient;
  private redis!: Redis;
  private tableName: string;
  private redisEnabled: boolean;

  private constructor() {
    this.ddbClient = new DynamoDBClient({});
    this.docClient = DynamoDBDocumentClient.from(this.ddbClient);
    this.tableName = process.env.DYNAMODB_TABLE_NAME || 'nba-live-games-dev';
    this.logTableSchema(); // Log table config on initialization
    
    // Initialize Redis with error handling
    this.redisEnabled = !!process.env.REDIS_ENDPOINT;
    if (this.redisEnabled) {
      this.redis = new Redis(process.env.REDIS_ENDPOINT || '');
      this.redis.on('error', (err) => {
        logger.warn('Redis connection error:', err);
        this.redisEnabled = false;
      });
    } else {
      // Initialize with a dummy Redis instance that does nothing
      this.redis = new Redis(null as any);
      this.redis.disconnect();
    }
  }

  public static getInstance(): GameService {
    if (!GameService.instance) {
      GameService.instance = new GameService();
    }
    return GameService.instance;
  }

  private logTableSchema() {
    logger.debug('DynamoDB Table Config:', {
      tableName: this.tableName,
      region: process.env.AWS_REGION || 'default'
    });
  }

  private async tryRedisGet(key: string): Promise<string | null> {
    if (!this.redisEnabled) return null;
    try {
      return await this.redis.get(key);
    } catch (error) {
      logger.warn(`Redis get failed for key ${key}:`, error);
      return null;
    }
  }

  private async tryRedisSet(key: string, value: string, ttl: number): Promise<void> {
    if (!this.redisEnabled) return;
    try {
      await this.redis.set(key, value, 'EX', ttl);
    } catch (error) {
      logger.warn(`Redis set failed for key ${key}:`, error);
    }
  }

  async getGame(gameId: string): Promise<GameBoxScore | null> {
    try {
      // Validate game ID format
      if (!gameId.match(/^[0-9]{10}$/)) {
        logger.warn(`Invalid game ID format: ${gameId}`);
        return null;
      }

      logger.debug(`Fetching game ${gameId} from table ${this.tableName}`);
      
      // Try Redis first for box score
      const cachedBoxScore = await this.tryRedisGet(`boxscore:${gameId}`);
      if (cachedBoxScore) {
        logger.debug(`Box score cache hit for game ${gameId}`);
        return JSON.parse(cachedBoxScore);
      }

      // Fallback to DynamoDB
      logger.debug(`Cache miss for game ${gameId}, querying DynamoDB`);
      const result = await this.docClient.send(new GetCommand({
        TableName: this.tableName,
        Key: {
          gameId: gameId.toString()
        }
      }));

      logger.debug(`DynamoDB result for game ${gameId}:`, {
        tableExists: !!this.tableName,
        hasItem: !!result.Item,
        item: result.Item
      });

      // If game exists but no box score, try to fetch from NBA API
      if (result.Item && !('totals' in result.Item.homeTeam)) {
        logger.debug(`Found basic game data for ${gameId}, fetching box score from NBA API`);
        const boxScore = await getGameBoxScore(gameId);
        if (boxScore) {
          // Update DynamoDB with box score
          await this.updateGame(boxScore);
          return boxScore;
        }
      }

      // Return box score if it exists
      if (result.Item && 'totals' in result.Item.homeTeam) {
        const boxScore = result.Item as GameBoxScore;
        await this.tryRedisSet(
          `boxscore:${gameId}`,
          JSON.stringify(boxScore),
          60 * 5
        );
        return boxScore;
      }

      logger.debug(`No box score available for game ${gameId}`);
      return null;
    } catch (error) {
      logger.error(`Error fetching game ${gameId}:`, error);
      throw error;
    }
  }

  private validateTeamStats(stats: Team['stats']): boolean {
    // Check that stats exists and is an object
    if (!stats || typeof stats !== 'object') return false;

    // Validate required numeric properties
    return !!(
      typeof stats.rebounds === 'number' &&
      typeof stats.assists === 'number' &&
      typeof stats.blocks === 'number'
    );
  }

  private validateGameScore(game: GameScore): ValidationResult {
    const errors: string[] = [];
    
    // Required fields
    if (!game.gameId) errors.push('gameId is required');
    if (!game.status) errors.push('status is required');
    if (typeof game.period !== 'number') errors.push('period must be a number');
    
    // Team validation
    if (!game.homeTeam?.stats || !game.awayTeam?.stats) {
      errors.push('both homeTeam and awayTeam must have stats');
    } else {
      // Validate team stats
      if (!this.validateTeamStats(game.homeTeam.stats)) {
        errors.push('invalid homeTeam stats');
      }
      if (!this.validateTeamStats(game.awayTeam.stats)) {
        errors.push('invalid awayTeam stats');
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  private validateBoxScore(boxScore: GameBoxScore): ValidationResult {
    const errors: string[] = [];
    
    // Basic validation
    if (!boxScore.gameId) errors.push('gameId is required');
    if (!boxScore.status) errors.push('status is required');
    
    // Team validation
    if (!boxScore.homeTeam || !boxScore.awayTeam) {
      errors.push('both homeTeam and awayTeam are required');
    } else {
      // Validate team box scores
      if (!this.validateTeamBoxScore(boxScore.homeTeam)) {
        errors.push('invalid homeTeam box score');
      }
      if (!this.validateTeamBoxScore(boxScore.awayTeam)) {
        errors.push('invalid awayTeam box score');
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  private validateTeamBoxScore(team: TeamBoxScore): boolean {
    return !!(
      team.totals &&
      typeof team.totals.points === 'number' &&
      typeof team.totals.assists === 'number' &&
      typeof team.totals.rebounds === 'number' &&
      Array.isArray(team.players)
    );
  }

  async updateGame(game: GameScore | GameBoxScore): Promise<void> {
    try {
      // Validate data before saving
      const validation = 'totals' in game.homeTeam 
        ? this.validateBoxScore(game as GameBoxScore)
        : this.validateGameScore(game as GameScore);

      if (!validation.isValid) {
        const error = new Error(`Invalid game data: ${validation.errors.join(', ')}`);
        logger.error('Validation failed:', error);
        throw error;
      }

      // Add required DynamoDB attributes
      const item = {
        ...game,
        dataType: 'GAME',
        ttl: Math.floor(Date.now() / 1000) + (24 * 60 * 60)
      };
      
      // Update DynamoDB
      await this.docClient.send(new PutCommand({
        TableName: this.tableName,
        Item: item
      }));

      // Try Redis cache update
      const isBoxScore = 'homeTeam' in game && 'totals' in game.homeTeam;
      const key = isBoxScore ? `boxscore:${game.gameId}` : `game:${game.gameId}`;
      await this.tryRedisSet(key, JSON.stringify(game), 60 * 5);

      logger.debug(`Updated ${isBoxScore ? 'box score' : 'game'} data for ${game.gameId}`);
    } catch (error) {
      logger.error('Error updating game:', error);
      throw error;
    }
  }

  async getLiveGames(): Promise<GameScore[]> {
    try {
      // Try Redis first
      const cachedLiveGames = await this.tryRedisGet('games:live');
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

      // Ensure we return an array even if no games are found
      const games = (result.Items || []) as GameScore[];
      
      // Cache live games with short TTL
      if (games.length > 0) {
        await this.tryRedisSet(
          'games:live',
          JSON.stringify(games),
          30 // 30 seconds
        );
      }

      return games;
    } catch (error) {
      logger.error('Error fetching live games:', error);
      return []; // Return empty array on error
    }
  }

  async getAllGames(): Promise<GameScore[]> {
    try {
      // Try Redis first
      const cachedGames = await this.tryRedisGet('games:all');
      if (cachedGames) {
        const games = JSON.parse(cachedGames);
        // Only use cache for non-live games
        const hasActiveGames = games.some((g: GameScore) => 
          g.status === GameStatus.LIVE || 
          (g.status === GameStatus.FINAL && g.lastUpdate > Date.now() - 5 * 60 * 1000)
        );
        if (!hasActiveGames) {
          logger.debug('Cache hit for all games (no active games)');
          return games;
        }
      }

      // Query DynamoDB for all today's games
      const result = await this.docClient.send(new ScanCommand({
        TableName: this.tableName,
        FilterExpression: 'begins_with(gameId, :today)',
        ExpressionAttributeValues: {
          ':today': new Date().toISOString().slice(0, 10).replace(/-/g, '')
        }
      }));

      const games = (result.Items || []) as GameScore[];
      
      // Cache with TTL based on game states
      const ttl = games.some(g => g.status === GameStatus.LIVE) ? 30 : 300; // 30s for live games, 5m otherwise
      await this.tryRedisSet('games:all', JSON.stringify(games), ttl);

      return games;
    } catch (error) {
      logger.error('Error fetching all games:', error);
      return []; // Return empty array on error
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