import axios from 'axios';
import { logger } from '../config/logger';
import { GameBoxScore, PlayerStats, TeamBoxScore, GameScore } from '../types';
import { createClient } from 'redis';
import { PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../config/dynamoDB';

const NBA_BASE_URL = 'https://nba-prod-us-east-1-mediaops-stats.s3.amazonaws.com/NBA/liveData';
const NBA_API_URL = `${NBA_BASE_URL}/scoreboard/todaysScoreboard_00.json`;
const NBA_BOXSCORE_URL = (gameId: string) => 
  `${NBA_BASE_URL}/boxscore/boxscore_${gameId}.json`;

const axiosConfig = {
  headers: {
    'Accept': 'application/json',
    'Cache-Control': 'no-cache'
  }
};

// Add interface for NBA game data
interface NBAGame {
  gameId: string;
  gameStatus: number;
  period: number;
  gameClock: string;
  homeTeam: {
    teamId: number;
    teamCity: string;
    teamName: string;
    score: number;
    statistics?: {
      reboundsDefensive: string;
      reboundsOffensive: string;
      assists: string;
      blocks: string;
    };
  };
  awayTeam: {
    teamId: number;
    teamCity: string;
    teamName: string;
    score: number;
    statistics?: {
      reboundsDefensive: string;
      reboundsOffensive: string;
      assists: string;
      blocks: string;
    };
  };
}

// Add scoreboard cache
interface ScoreboardCache {
  data: any;
  timestamp: number;
  games: Map<string, GameScore>;
}

let scoreboardCache: ScoreboardCache | null = null;
const CACHE_TTL = parseInt(process.env.CACHE_TTL || '300000'); // 5 minutes default
const SCOREBOARD_TTL = parseInt(process.env.SCOREBOARD_TTL || '120000'); // 2 minutes default

// Add new interfaces for DynamoDB items
interface ScoreboardItem {
  date: string;
  type: string;
  data: any;
  timestamp: number;
  games: GameScore[];
  ttl: number;
}

interface BoxScoreItem {
  date: string;
  type: string;
  gameId: string;
  data: GameBoxScore;
  timestamp: number;
  ttl: number;
}

// Add fallback mechanism when Redis is not available
let isRedisAvailable = false;

// Add URL logging when creating Redis client
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
logger.info('Connecting to Redis at:', redisUrl);

const redisClient = createClient({
  url: redisUrl,
  socket: {
    reconnectStrategy: (retries) => {
      logger.info(`Redis reconnection attempt ${retries}`);
      if (retries > 10) {
        logger.error('Max Redis reconnection attempts reached');
        return new Error('Max Redis reconnection attempts reached');
      }
      return Math.min(retries * 100, 3000);
    }
  }
});

redisClient.on('error', err => {
  logger.error('Redis Client Error:', err);
  isRedisAvailable = false;
});

redisClient.on('connect', () => {
  logger.info('Redis Client Connected');
  isRedisAvailable = true;
  // Test Redis connection
  testRedisConnection();
});

// Add test function
async function testRedisConnection() {
  try {
    await redisClient.set('test:connection', 'ok', { EX: 60 });
    const testValue = await redisClient.get('test:connection');
    logger.info('Redis test successful:', testValue);
    
    // List all keys
    const keys = await redisClient.keys('*');
    logger.info('Current Redis keys:', keys);
  } catch (error) {
    logger.error('Redis test failed:', error);
  }
}

// Initialize Redis connection with retries
async function initRedis() {
  try {
    await redisClient.connect();
    logger.info('Redis Client Connected');
    isRedisAvailable = true;
  } catch (err) {
    logger.error('Redis Connection Error:', err);
    isRedisAvailable = false;
  }
}

// Call initRedis when the service starts
initRedis().catch(err => {
  logger.error('Failed to initialize Redis:', err);
  isRedisAvailable = false;
});

// Cache keys
const SCOREBOARD_KEY = 'nba:scoreboard';
const getBoxScoreKey = (gameId: string) => `nba:boxscore:${gameId}`;

// Add monitoring function
async function monitorCache() {
  if (!isRedisAvailable) return;

  try {
    const keys = await redisClient.keys('nba:*');
    const details = await Promise.all(
      keys.map(async key => {
        const ttl = await redisClient.ttl(key);
        const value = await redisClient.get(key);
        return {
          key,
          ttl,
          hasValue: !!value,
          valueSize: value ? Buffer.byteLength(value) : 0
        };
      })
    );

    logger.info('Cache Monitor:', {
      totalKeys: keys.length,
      details
    });
  } catch (error) {
    logger.error('Cache monitoring failed:', error);
  }
}

// Add function to save to DynamoDB with better error handling
async function saveToDatabase(games: GameScore[]) {
  const now = Date.now();
  const ttl = Math.floor(now/1000) + (24 * 60 * 60); // 24 hour TTL

  try {
    logger.info(`Saving games to DynamoDB in region ${process.env.AWS_REGION}`);
    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        date: new Date().toISOString().split('T')[0],
        type: 'scoreboard',
        games,
        timestamp: now,
        ttl
      }
    }));
    logger.info('Successfully saved games to DynamoDB');
  } catch (error) {
    logger.error('Failed to save to DynamoDB:', error, {
      region: process.env.AWS_REGION,
      tableName: TABLE_NAME
    });
  }
}

// Add function to load from DynamoDB
async function loadFromDatabase(): Promise<GameScore[] | null> {
  try {
    const result = await docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        date: new Date().toISOString().split('T')[0],
        type: 'scoreboard'
      }
    }));

    if (result.Item) {
      logger.info('Retrieved games from DynamoDB');
      return result.Item.games;
    }
    return null;
  } catch (error) {
    logger.error('Failed to load from DynamoDB:', error);
    return null;
  }
}

// Update getScoreboardFromCache with multi-level caching
async function getScoreboardFromCache(): Promise<GameScore[]> {
  try {
    // Monitor cache before operation
    await monitorCache();

    if (!isRedisAvailable) {
      logger.warn('Redis not available, trying DynamoDB');
      const dbGames = await loadFromDatabase();
      if (dbGames) {
        return dbGames;
      }
      logger.warn('No data in DynamoDB, fetching from API');
    }

    try {
      // Try Redis first
      const cached = await redisClient.get(SCOREBOARD_KEY);
      if (cached) {
        logger.info('Using cached scoreboard data from Redis');
        const games = JSON.parse(cached);
        logger.info(`Retrieved ${games.length} games from Redis cache`);
        return games;
      }

      // Try DynamoDB if Redis cache miss
      logger.info('Redis cache miss, trying DynamoDB');
      const dbGames = await loadFromDatabase();
      if (dbGames) {
        // Store in Redis for next time
        await redisClient.set(SCOREBOARD_KEY, JSON.stringify(dbGames), {
          EX: SCOREBOARD_TTL / 1000
        });
        logger.info('Loaded from DynamoDB and cached in Redis');
        return dbGames;
      }
    } catch (cacheError) {
      logger.error('Cache operation failed:', cacheError);
    }

    // If both caches miss, fetch from API
    logger.info('Cache miss, fetching fresh scoreboard data from API');
    const response = await axios.get(NBA_API_URL, axiosConfig);
    const games = response.data.scoreboard.games.map((game: NBAGame) => transformNBAGame(game));
    logger.info(`Fetched ${games.length} games from API`);

    try {
      // Store in both Redis and DynamoDB
      const setResult = await redisClient.set(SCOREBOARD_KEY, JSON.stringify(games), {
        EX: SCOREBOARD_TTL / 1000
      });
      logger.info(`Redis SET operation result: ${setResult}`);
      logger.info(`Cached ${games.length} games in Redis with TTL: ${SCOREBOARD_TTL/1000}s`);
      
      // Save to DynamoDB in background
      saveToDatabase(games).catch(err => 
        logger.error('Background DynamoDB save failed:', err)
      );

      // Monitor cache after operation
      await monitorCache();
    } catch (cacheError) {
      logger.error('Cache operation failed:', cacheError);
    }

    return games;
  } catch (error) {
    logger.error('Failed to get scoreboard:', error);
    throw error;
  }
}

async function cacheBoxScore(gameId: string): Promise<GameBoxScore | null> {
  try {
    const boxScore = await fetchNBABoxScore(gameId);
    if (!boxScore) return null;

    const transformedBoxScore = transformNBABoxScore(boxScore);
    
    // Cache the transformed box score
    await redisClient.set(
      getBoxScoreKey(gameId), 
      JSON.stringify(transformedBoxScore),
      { EX: CACHE_TTL / 1000 }
    );

    return transformedBoxScore;
  } catch (error) {
    logger.error(`Failed to cache box score for game ${gameId}:`, error);
    return null;
  }
}

export async function getGameBoxScore(gameId: string): Promise<GameBoxScore | null> {
  try {
    // Try to get from cache
    const cached = await redisClient.get(getBoxScoreKey(gameId));
    if (cached) {
      return JSON.parse(cached);
    }

    return await cacheBoxScore(gameId);
  } catch (error) {
    logger.error(`Failed to get box score for game ${gameId}:`, error);
    return null;
  }
}

// Prefetch box scores for all games
async function prefetchBoxScores(games: NBAGame[]): Promise<void> {
  logger.debug('Prefetching box scores for all games');
  await Promise.all(
    games.map(game => cacheBoxScore(game.gameId))
  );
}

// Update getGames to use Redis cache
export async function getGames(): Promise<GameScore[]> {
  try {
    return await getScoreboardFromCache();
  } catch (error) {
    logger.error('Failed to get games:', error);
    throw error;
  }
}

export async function fetchNBAScoreboard() {
  try {
    const response = await axios.get(NBA_API_URL, axiosConfig);
    
    logger.debug('NBA API Response:', {
      url: NBA_API_URL,
      status: response.status,
      gamesCount: response.data?.scoreboard?.games?.length || 0
    });

    return response.data.scoreboard;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error('NBA API Error:', {
        message: error.message,
        status: error.response?.status,
        url: error.config?.url
      });
    } else {
      logger.error('Unexpected error:', error);
    }
    throw error;
  }
}

export async function fetchNBABoxScore(gameId: string) {
  const url = NBA_BOXSCORE_URL(gameId);
  logger.debug(`Fetching box score from: ${url}`);
  
  try {
    const response = await axios.get(url, axiosConfig);

    if (!response.data?.game) {
      logger.warn(`No box score data for game ${gameId}`);
      return null;
    }

    return response.data.game;
  } catch (error: unknown) {
    if (error instanceof Error) {
      logger.error(`Failed to fetch box score: ${error.message}`);
    }
    return null;
  }
}

export function transformNBAGame(nbaGame: NBAGame): GameScore {
  const getTeamStats = (team: NBAGame['homeTeam'] | NBAGame['awayTeam']) => {
    if (team.statistics) {
      return {
        rebounds: (parseInt(team.statistics.reboundsDefensive) || 0) + 
                 (parseInt(team.statistics.reboundsOffensive) || 0),
        assists: parseInt(team.statistics.assists) || 0,
        blocks: parseInt(team.statistics.blocks) || 0
      };
    }
    return {
      rebounds: 0,
      assists: 0,
      blocks: 0
    };
  };

  return {
    gameId: nbaGame.gameId,
    status: nbaGame.gameStatus === 2 ? 'live' : nbaGame.gameStatus === 3 ? 'final' : 'scheduled',
    period: nbaGame.period,
    clock: nbaGame.gameClock || '',
    homeTeam: {
      teamId: nbaGame.homeTeam.teamId.toString(),
      name: `${nbaGame.homeTeam.teamCity} ${nbaGame.homeTeam.teamName}`,
      score: parseInt(nbaGame.homeTeam.score.toString()) || 0,
      stats: getTeamStats(nbaGame.homeTeam)
    },
    awayTeam: {
      teamId: nbaGame.awayTeam.teamId.toString(),
      name: `${nbaGame.awayTeam.teamCity} ${nbaGame.awayTeam.teamName}`,
      score: parseInt(nbaGame.awayTeam.score.toString()) || 0,
      stats: getTeamStats(nbaGame.awayTeam)
    },
    lastUpdate: Date.now()
  };
}

export function transformNBABoxScore(nbaGame: any): GameBoxScore {
  return {
    gameId: nbaGame.gameId,
    status: nbaGame.gameStatus === 2 ? 'live' : nbaGame.gameStatus === 3 ? 'final' : 'scheduled',
    period: nbaGame.period,
    clock: nbaGame.gameClock ? nbaGame.gameClock.substring(2, 7) : '',
    homeTeam: transformNBATeamBoxScore(nbaGame.homeTeam),
    awayTeam: transformNBATeamBoxScore(nbaGame.awayTeam),
    arena: nbaGame.arena?.arenaName || '',
    attendance: nbaGame.attendance || 0,
    lastUpdate: Date.now()
  };
}

function transformNBATeamBoxScore(team: any): TeamBoxScore {
  const players = team.players?.map(transformNBAPlayerStats) || [];
  const totals = {
    points: team.statistics?.points || 0,
    rebounds: (team.statistics?.reboundsDefensive || 0) + (team.statistics?.reboundsOffensive || 0),
    assists: team.statistics?.assists || 0,
    steals: team.statistics?.steals || 0,
    blocks: team.statistics?.blocks || 0,
    fgm: team.statistics?.fieldGoalsMade || 0,
    fga: team.statistics?.fieldGoalsAttempted || 0,
    threePm: team.statistics?.threePointersMade || 0,
    threePa: team.statistics?.threePointersAttempted || 0,
    ftm: team.statistics?.freeThrowsMade || 0,
    fta: team.statistics?.freeThrowsAttempted || 0,
  };

  return {
    teamId: team.teamId,
    name: `${team.teamCity} ${team.teamName}`,
    score: totals.points,
    players,
    totals,
    stats: {
      rebounds: totals.rebounds,
      assists: totals.assists,
      blocks: totals.blocks,
    }
  };
}

function transformNBAPlayerStats(player: any): PlayerStats {
  return {
    playerId: player.personId,
    name: `${player.firstName} ${player.familyName}`,
    position: player.position || '',
    minutes: player.statistics?.minutesCalculated || '0',
    points: player.statistics?.points || 0,
    rebounds: (player.statistics?.reboundsDefensive || 0) + (player.statistics?.reboundsOffensive || 0),
    assists: player.statistics?.assists || 0,
    steals: player.statistics?.steals || 0,
    blocks: player.statistics?.blocks || 0,
    fgm: player.statistics?.fieldGoalsMade || 0,
    fga: player.statistics?.fieldGoalsAttempted || 0,
    threePm: player.statistics?.threePointersMade || 0,
    threePa: player.statistics?.threePointersAttempted || 0,
    ftm: player.statistics?.freeThrowsMade || 0,
    fta: player.statistics?.freeThrowsAttempted || 0,
    plusMinus: player.statistics?.plusMinusPoints || 0,
  };
}

export async function fetchGameById(gameId: string) {
  try {
    const scoreboard = await fetchNBAScoreboard();
    const game = scoreboard.games.find((game: NBAGame) => game.gameId === gameId);
    
    if (!game) {
      logger.warn(`Game ${gameId} not found`);
      return null;
    }

    return game;
  } catch (error) {
    logger.error(`Failed to fetch game ${gameId}:`, error);
    throw error;
  }
}

export async function fetchLiveGames(): Promise<GameScore[]> {
  try {
    const games = await getGames();
    return games.filter(game => game.status === 'live');
  } catch (error) {
    logger.error('Failed to fetch live games:', error);
    throw error;
  }
}

// Add function to verify cache status
export async function getCacheStatus() {
  if (!isRedisAvailable) {
    return { status: 'Redis not connected' };
  }

  try {
    const keys = await redisClient.keys('nba:*');
    const ttls = await Promise.all(
      keys.map(async key => ({
        key,
        ttl: await redisClient.ttl(key)
      }))
    );

    return {
      status: 'connected',
      keys: ttls
    };
  } catch (error: unknown) {
    logger.error('Failed to get cache status:', error);
    if (error instanceof Error) {
      return { status: 'error', message: error.message };
    }
    return { status: 'error', message: 'An unknown error occurred' };
  }
}

// Keep other necessary functions (transformNBABoxScore, transformNBAGame, etc.)
// but remove unused ones 