import axios from 'axios';
import { logger } from '../config/logger';
import { GameBoxScore, PlayerStats, TeamBoxScore, GameScore, NBAGame, NBATeamStatistics, NBATeam } from '../types';
import { createClient } from 'redis';
import { DynamoDBClient, CreateTableCommand, DescribeTableCommand, ResourceNotFoundException } from "@aws-sdk/client-dynamodb";
import { 
  DynamoDBDocumentClient, 
  PutCommand, 
  GetCommand,
  ScanCommand
} from "@aws-sdk/lib-dynamodb";
import { mockScoreboard, mockBoxScore } from './mockData';
import dotenv from 'dotenv';
dotenv.config();

// Create DynamoDB client
const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  } : undefined
});

const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'nba_games';

// Move constants to use env vars
const USE_MOCK_DATA = process.env.USE_MOCK_DATA === 'true';
const NBA_BASE_URL = process.env.NBA_BASE_URL || 'https://nba-prod-us-east-1-mediaops-stats.s3.amazonaws.com/NBA/liveData';
const NBA_API_URL = process.env.NBA_API_URL || `${NBA_BASE_URL}/scoreboard/todaysScoreboard_00.json`;
const NBA_BOXSCORE_URL = (gameId: string) => 
  `${NBA_BASE_URL}/boxscore/boxscore_${gameId}.json`;
const CACHE_TTL = parseInt(process.env.CACHE_TTL || '300000'); // 5 minutes default
const SCOREBOARD_TTL = parseInt(process.env.SCOREBOARD_TTL || '120000'); // 2 minutes default

// Add axios config
const axiosConfig = {
  headers: {
    'Accept': 'application/json',
    'Cache-Control': 'no-cache'
  }
};

// Add some validation
if (!NBA_BASE_URL) {
  logger.error('NBA_BASE_URL is not set in environment variables');
  process.exit(1);
}

// Log the configuration on startup
logger.info('NBA Service Configuration:', {
  USE_MOCK_DATA,
  NBA_BASE_URL,
  CACHE_TTL,
  SCOREBOARD_TTL
});

// Add scoreboard cache
interface ScoreboardCache {
  data: any;
  timestamp: number;
  games: Map<string, GameScore>;
}

let scoreboardCache: ScoreboardCache | null = null;

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
  try {
    logger.info(`Saving games to DynamoDB in region ${process.env.AWS_REGION}`);
    
    const command = new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        date: new Date().toISOString().split('T')[0],
        type: 'scoreboard',
        games,
        timestamp: Date.now(),
        ttl: Math.floor(Date.now()/1000) + (24 * 60 * 60)
      }
    });

    await docClient.send(command);
    logger.info('Successfully saved games to DynamoDB');
  } catch (error) {
    logger.error('Failed to save to DynamoDB:', error);
    throw error;
  }
}

// Add function to load from DynamoDB
async function loadFromDatabase(): Promise<GameScore[] | null> {
  try {
    const command = new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        date: new Date().toISOString().split('T')[0],
        type: 'scoreboard'
      }
    });

    const result = await docClient.send(command);
    
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

    // Get current data from cache or DB
    let games: GameScore[] = [];
    
    if (isRedisAvailable) {
      const cached = await redisClient.get(SCOREBOARD_KEY);
      if (cached) {
        games = JSON.parse(cached);
        // Log cached data format
        logger.info('Retrieved from Redis:', {
          firstGame: games[0],
          format: 'Checking data format'
        });
      } else {
        logger.info('Redis cache miss, trying DynamoDB');
        const dbGames = await loadFromDatabase();
        if (dbGames) {
          // Transform old format to new format if needed
          games = dbGames.map(game => ({
            ...game,
            homeTeam: {
              teamId: game.homeTeam.teamId,
              teamTricode: game.homeTeam.teamTricode || 'XXX', // Use teamTricode or fallback
              score: game.homeTeam.score,
              stats: game.homeTeam.stats
            },
            awayTeam: {
              teamId: game.awayTeam.teamId,
              teamTricode: game.awayTeam.teamTricode || 'XXX', // Use teamTricode or fallback
              score: game.awayTeam.score,
              stats: game.awayTeam.stats
            }
          }));
          logger.info('Loaded and transformed from DynamoDB:', {
            firstGame: games[0],
            format: 'After transformation'
          });
        }
      }
    }

    // For live games, always fetch fresh data
    const updatedGames = await Promise.all(games.map(async (game) => {
      if (game.status === 'live') {
        logger.info(`Refreshing live game data for ${game.gameId}`);
        try {
          const response = await axios.get(NBA_API_URL, axiosConfig);
          const liveGame = response.data.scoreboard.games.find(
            (g: NBAGame) => g.gameId === game.gameId
          );

          if (liveGame) {
            return transformNBAGame(liveGame);
          }
        } catch (error) {
          logger.error(`Failed to refresh live game ${game.gameId}:`, error);
        }
      }
      return game;
    }));

    // Update cache with fresh data
    if (isRedisAvailable && updatedGames.length > 0) {
      await redisClient.set(SCOREBOARD_KEY, JSON.stringify(updatedGames), {
        EX: SCOREBOARD_TTL / 1000
      });
      logger.info('Updated cache with fresh data:', {
        firstGame: updatedGames[0],
        format: 'Final format'
      });
    }

    return updatedGames;
  } catch (error) {
    logger.error('Failed to get scoreboard:', error);
    throw error;
  }
}

export async function getGameBoxScore(gameId: string, parentGame?: GameScore): Promise<GameBoxScore | null> {
  try {
    if (USE_MOCK_DATA) {
      logger.info(`Using mock data for game ${gameId}`);
      return generateMockBoxScore(gameId);
    }

    const boxScore = await fetchNBABoxScore(gameId);
    if (!boxScore) {
      logger.warn(`Game ${gameId} not found in box score`);
      return null;
    }

    // Use parent game's status and clock
    if (parentGame) {
      boxScore.gameStatus = parentGame.status === 'live' ? 2 : 
                           parentGame.status === 'final' ? 3 : 1;
      boxScore.gameClock = parentGame.clock;
    }

    return transformNBABoxScore(boxScore, parentGame);

  } catch (error) {
    logger.error(`Failed to get box score for game ${gameId}:`, error);
    throw error;
  }
}

async function fetchAndCacheBoxScore(gameId: string): Promise<GameBoxScore | null> {
  logger.info(`Fetching fresh box score for game ${gameId}`);
  const boxScore = await fetchNBABoxScore(gameId);
  
  if (!boxScore) {
    logger.warn(`No box score available for game ${gameId}`);
    return null;
  }

  // Log raw box score data
  logger.info('Raw box score data:', {
    gameId,
    homeTeam: {
      name: boxScore.homeTeam?.teamName,
      players: boxScore.homeTeam?.players?.length,
      rawStats: boxScore.homeTeam?.statistics,
    },
    awayTeam: {
      name: boxScore.awayTeam?.teamName,
      players: boxScore.awayTeam?.players?.length,
      rawStats: boxScore.awayTeam?.statistics,
    }
  });

  const transformedBoxScore = transformNBABoxScore(boxScore);

  // Log transformed data
  logger.info('Transformed box score:', {
    gameId,
    homeTeamTotals: transformedBoxScore.homeTeam.totals,
    awayTeamTotals: transformedBoxScore.awayTeam.totals,
  });

  // Cache in both Redis and DynamoDB
  try {
    await Promise.all([
      redisClient.set(
        getBoxScoreKey(gameId), 
        JSON.stringify(transformedBoxScore),
        { EX: CACHE_TTL / 1000 }
      ),
      docClient.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          date: new Date().toISOString().split('T')[0],
          type: `boxscore:${gameId}`,
          gameId,
          data: transformedBoxScore,
          timestamp: Date.now(),
          ttl: Math.floor(Date.now()/1000) + (24 * 60 * 60)
        }
      }))
    ]);
    logger.info(`Cached box score for game ${gameId} with totals:`, {
      homeTeam: transformedBoxScore.homeTeam.totals,
      awayTeam: transformedBoxScore.awayTeam.totals
    });
  } catch (error) {
    logger.error(`Failed to cache box score for game ${gameId}:`, error);
  }

  return transformedBoxScore;
}

// Prefetch box scores for all games
async function prefetchBoxScores(games: NBAGame[]): Promise<void> {
  logger.debug('Prefetching box scores for all games');
  await Promise.all(
    games.map(game => fetchAndCacheBoxScore(game.gameId))
  );
}

// Update getGames function
export async function getGames(): Promise<GameScore[]> {
  try {
    // Try cache first
    const cachedGames = await getScoreboardFromCache();
    if (cachedGames.length > 0) {
      logger.info('Returning cached games:', {
        firstGame: cachedGames[0],
        firstGameHomeTeam: cachedGames[0].homeTeam,
        firstGameAwayTeam: cachedGames[0].awayTeam
      });
      return cachedGames;
    }

    // If cache is empty, try API
    logger.info('Cache empty, fetching from API');
    const scoreboard = await fetchNBAScoreboard();
    
    // Log raw data before transformation
    logger.info('Raw scoreboard data:', {
      firstGame: scoreboard.games[0],
      firstGameStats: {
        home: scoreboard.games[0]?.homeTeam?.statistics,
        away: scoreboard.games[0]?.awayTeam?.statistics
      }
    });

    // Use Promise.all to handle async transformations
    const games = await Promise.all(
      scoreboard.games.map(async (game: NBAGame) => {
        logger.info('Processing game:', {
          gameId: game.gameId,
          homeTeam: {
            teamId: game.homeTeam.teamId,
            teamTricode: game.homeTeam.teamTricode
          },
          awayTeam: {
            teamId: game.awayTeam.teamId,
            teamTricode: game.awayTeam.teamTricode
          }
        });

        return await transformNBAGame(game);
      })
    );

    // Cache the results
    if (games.length > 0) {
      await saveToDatabase(games);
    }

    return games;
  } catch (error) {
    logger.error('Failed to get games:', error);
    throw error;
  }
}

export async function fetchNBAScoreboard() {
  try {
    if (USE_MOCK_DATA) {
      logger.info('Using mock scoreboard data');
      return mockScoreboard.scoreboard;
    }

    const response = await axios.get(NBA_API_URL, axiosConfig);
    
    // Log the complete raw response structure
    logger.info('Complete NBA API Response:', {
      firstGame: response.data.scoreboard.games[0],
      rawResponse: JSON.stringify(response.data.scoreboard.games[0], null, 2)
    });

    return response.data.scoreboard;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error('NBA API Error:', {
        message: error.message,
        status: error.response?.status,
        url: error.config?.url,
        response: error.response?.data
      });
    } else {
      logger.error('Unexpected error:', error);
    }
    throw error;
  }
}

export async function fetchNBABoxScore(gameId: string) {
  if (USE_MOCK_DATA) {
    logger.info(`Using mock box score data for game ${gameId}`);
    return mockBoxScore.game;
  }

  const url = NBA_BOXSCORE_URL(gameId);
  logger.info(`Fetching box score from: ${url}`);
  
  try {
    const response = await axios.get(url, axiosConfig);
    
    // Add detailed logging of game status
    logger.info('Box Score API Response:', {
      gameId,
      gameStatus: response.data?.game?.gameStatus,
      gameStatusText: response.data?.game?.gameStatusText,
      hasData: !!response.data?.game,
      homeTeam: {
        name: response.data?.game?.homeTeam?.teamName,
        players: response.data?.game?.homeTeam?.players?.length || 0,
        hasStats: !!response.data?.game?.homeTeam?.statistics,
      }
    });

    if (!response.data?.game) {
      logger.warn(`No box score data for game ${gameId}`);
      return null;
    }

    return response.data.game;
  } catch (error: unknown) {
    logger.error(`Failed to fetch box score: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

const parseStats = (team: any) => {
  try {
    // Log the raw team data to see the structure
    logger.info('Parsing team stats from:', {
      teamId: team.teamId,
      teamTricode: team.teamTricode,
      rawStats: team.statistics,
      rawTeamStats: team.teamStats,
      rawTotals: team.teamStats?.totals
    });

    // Try different possible paths for stats
    const stats = team.statistics || team.teamStats?.totals || {};
    
    // Parse stats with fallbacks
    const rebounds = parseInt(stats.rebounds || stats.reboundsTotal || '0');
    const assists = parseInt(stats.assists || '0');
    const blocks = parseInt(stats.blocks || '0');

    logger.info('Parsed stats:', { rebounds, assists, blocks });

    return {
      rebounds,
      assists,
      blocks
    };
  } catch (error) {
    logger.error('Failed to parse team stats:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      rawTeam: team
    });
    return { rebounds: 0, assists: 0, blocks: 0 };
  }
};

export async function transformNBAGame(nbaGame: NBAGame): Promise<GameScore> {
  try {
    logger.info('Raw NBA game data:', {
      homeTeam: {
        teamId: nbaGame.homeTeam.teamId,
        teamTricode: nbaGame.homeTeam.teamTricode,
        score: nbaGame.homeTeam.score,
        status: nbaGame.gameStatus
      },
      awayTeam: {
        teamId: nbaGame.awayTeam.teamId,
        teamTricode: nbaGame.awayTeam.teamTricode,
        score: nbaGame.awayTeam.score,
        status: nbaGame.gameStatus
      }
    });

    // For live or final games, fetch box score to get team stats
    let homeStats = { rebounds: 0, assists: 0, blocks: 0 };
    let awayStats = { rebounds: 0, assists: 0, blocks: 0 };

    if (nbaGame.gameStatus === 2 || nbaGame.gameStatus === 3) { // Live or Final game
      try {
        const boxScore = await fetchNBABoxScore(nbaGame.gameId);
        if (boxScore) {
          logger.info('Box score data found:', {
            gameId: nbaGame.gameId,
            status: nbaGame.gameStatus === 2 ? 'live' : 'final',
            homeTeam: boxScore.homeTeam.statistics,
            awayTeam: boxScore.awayTeam.statistics
          });

          homeStats = {
            rebounds: parseInt(boxScore.homeTeam.statistics?.reboundsDefensive || '0') + 
                     parseInt(boxScore.homeTeam.statistics?.reboundsOffensive || '0'),
            assists: parseInt(boxScore.homeTeam.statistics?.assists || '0'),
            blocks: parseInt(boxScore.homeTeam.statistics?.blocks || '0')
          };
          awayStats = {
            rebounds: parseInt(boxScore.awayTeam.statistics?.reboundsDefensive || '0') + 
                     parseInt(boxScore.awayTeam.statistics?.reboundsOffensive || '0'),
            assists: parseInt(boxScore.awayTeam.statistics?.assists || '0'),
            blocks: parseInt(boxScore.awayTeam.statistics?.blocks || '0')
          };
        } else {
          logger.warn(`No box score found for ${nbaGame.gameStatus === 2 ? 'live' : 'final'} game ${nbaGame.gameId}`);
        }
      } catch (error) {
        logger.error(`Failed to fetch box score for game ${nbaGame.gameId}:`, error);
      }
    }

    const transformed = {
      gameId: nbaGame.gameId,
      status: nbaGame.gameStatus === 2 ? 'live' as const : 
              nbaGame.gameStatus === 3 ? 'final' as const : 
              'scheduled' as const,
      period: nbaGame.period || 0,
      clock: nbaGame.gameClock || '',
      homeTeam: {
        teamId: nbaGame.homeTeam.teamId.toString(),
        teamTricode: nbaGame.homeTeam.teamTricode,
        score: nbaGame.homeTeam.score || 0,
        stats: homeStats
      },
      awayTeam: {
        teamId: nbaGame.awayTeam.teamId.toString(),
        teamTricode: nbaGame.awayTeam.teamTricode,
        score: nbaGame.awayTeam.score || 0,
        stats: awayStats
      },
      lastUpdate: Date.now()
    };

    return transformed;
  } catch (error) {
    logger.error('Error transforming NBA game:', error);
    throw error;
  }
}

export function transformNBABoxScore(nbaBoxScore: any, parentGame?: GameScore): GameBoxScore {
  // Add debug logging
  logger.debug('Raw box score data:', {
    gameId: nbaBoxScore.gameId,
    parentStatus: parentGame?.status,
    parentClock: parentGame?.clock,
    boxScoreStatus: nbaBoxScore.gameStatus,
    period: nbaBoxScore.period,
    clock: nbaBoxScore.gameClock
  });

  const transformTeam = (team: any) => {
    return {
      teamId: team.teamId,
      teamTricode: team.teamTricode,
      score: team.score,
      players: team.players?.map(transformNBAPlayerStats) || [],
      stats: {
        rebounds: parseInt(team.statistics?.reboundsDefensive || '0') + 
                 parseInt(team.statistics?.reboundsOffensive || '0'),
        assists: parseInt(team.statistics?.assists || '0'),
        blocks: parseInt(team.statistics?.blocks || '0')
      },
      totals: {
        points: team.score,
        rebounds: parseInt(team.statistics?.reboundsDefensive || '0') + 
                 parseInt(team.statistics?.reboundsOffensive || '0'),
        assists: parseInt(team.statistics?.assists || '0'),
        steals: parseInt(team.statistics?.steals || '0'),
        blocks: parseInt(team.statistics?.blocks || '0'),
        personalFouls: parseInt(team.statistics?.foulsPersonal || '0'),
        fgm: parseInt(team.statistics?.fieldGoalsMade || '0'),
        fga: parseInt(team.statistics?.fieldGoalsAttempted || '0'),
        threePm: parseInt(team.statistics?.threePointersMade || '0'),
        threePa: parseInt(team.statistics?.threePointersAttempted || '0'),
        ftm: parseInt(team.statistics?.freeThrowsMade || '0'),
        fta: parseInt(team.statistics?.freeThrowsAttempted || '0')
      }
    };
  };

  const transformed = {
    gameId: nbaBoxScore.gameId,
    status: parentGame?.status || 'scheduled',
    period: nbaBoxScore.period,
    clock: parentGame?.clock || nbaBoxScore.gameClock || '',
    homeTeam: transformTeam(nbaBoxScore.homeTeam),
    awayTeam: transformTeam(nbaBoxScore.awayTeam),
    arena: nbaBoxScore.arena?.arenaName || '',
    attendance: nbaBoxScore.attendance || 0,
    lastUpdate: Date.now()
  };

  // Add debug logging for transformed data
  logger.debug('Transformed box score:', {
    gameId: transformed.gameId,
    rawStatus: nbaBoxScore.gameStatus,
    transformedStatus: transformed.status,
    period: transformed.period,
    clock: transformed.clock
  });

  return transformed;
}

function transformNBAPlayerStats(player: any): PlayerStats {
  const formatMinutes = (minutesStr: string) => {
    if (!minutesStr) return '0';
    
    // Log raw minutes string for debugging
    logger.debug('Formatting minutes:', { raw: minutesStr });

    // Handle different time formats
    if (minutesStr.startsWith('PT')) {
      const matches = minutesStr.match(/PT(\d+)M(?:(\d+(?:\.\d+)?)S)?/);
      if (matches) {
        const minutes = parseInt(matches[1]);
        const seconds = matches[2] ? parseFloat(matches[2]) : 0;
        
        // If player played at all (any seconds), round up to 1 minute
        if (minutes === 0 && seconds > 0) {
          return '1';
        }
        return minutes.toString();
      }
    }
    return '0';
  };

  // Log raw player data for debugging
  logger.debug('Raw player data:', {
    name: `${player.firstName} ${player.familyName}`,
    minutes: player.statistics?.minutesCalculated,
    statistics: player.statistics
  });

  const stats = {
    playerId: player.personId,
    name: `${player.firstName} ${player.familyName}`,
    position: player.position || '',
    minutes: formatMinutes(player.statistics?.minutesCalculated || '0'),
    points: parseInt(player.statistics?.points || '0'),
    rebounds: parseInt(player.statistics?.reboundsDefensive || '0') + 
              parseInt(player.statistics?.reboundsOffensive || '0'),
    assists: parseInt(player.statistics?.assists || '0'),
    steals: parseInt(player.statistics?.steals || '0'),
    blocks: parseInt(player.statistics?.blocks || '0'),
    personalFouls: parseInt(player.statistics?.foulsPersonal || '0'),
    fgm: parseInt(player.statistics?.fieldGoalsMade || '0'),
    fga: parseInt(player.statistics?.fieldGoalsAttempted || '0'),
    threePm: parseInt(player.statistics?.threePointersMade || '0'),
    threePa: parseInt(player.statistics?.threePointersAttempted || '0'),
    ftm: parseInt(player.statistics?.freeThrowsMade || '0'),
    fta: parseInt(player.statistics?.freeThrowsAttempted || '0'),
    plusMinus: parseInt(player.statistics?.plusMinusPoints || '0'),
  };

  // Log player stats transformation
  logger.info('Player stats transformation:', {
    name: stats.name,
    rawMinutes: player.statistics?.minutesCalculated,
    formattedMinutes: stats.minutes,
    rawStats: player.statistics,
    transformedStats: stats
  });

  return stats;
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

// Add table creation function
async function ensureTableExists() {
  try {
    const describeCommand = new DescribeTableCommand({ 
      TableName: TABLE_NAME 
    });
    
    await docClient.send(describeCommand);
    logger.info('DynamoDB table exists');
  } catch (error: any) {
    if (error.name === 'ResourceNotFoundException') {
      logger.info('Creating DynamoDB table...');
      
      const createCommand = new CreateTableCommand({
        TableName: TABLE_NAME,
        KeySchema: [
          { AttributeName: 'date', KeyType: 'HASH' },
          { AttributeName: 'type', KeyType: 'RANGE' }
        ],
        AttributeDefinitions: [
          { AttributeName: 'date', AttributeType: 'S' },
          { AttributeName: 'type', AttributeType: 'S' }
        ],
        ProvisionedThroughput: {
          ReadCapacityUnits: 5,
          WriteCapacityUnits: 5
        }
      });

      await client.send(createCommand);
      logger.info('DynamoDB table created');
    } else {
      throw error;
    }
  }
}

// Call this when the service starts
ensureTableExists().catch(error => {
  logger.error('Failed to ensure DynamoDB table exists:', error);
});

// Keep other necessary functions (transformNBABoxScore, transformNBAGame, etc.)
// but remove unused ones 

export const getGameById = fetchGameById; 

function generateMockBoxScore(gameId: string): GameBoxScore {
  const mockPlayerStats: PlayerStats = {
    playerId: '1',
    name: 'Mock Player',
    position: 'F',
    minutes: '25',
    points: 15,
    rebounds: 5,
    assists: 3,
    steals: 1,
    blocks: 1,
    personalFouls: 2,
    fgm: 6,
    fga: 10,
    threePm: 1,
    threePa: 3,
    ftm: 2,
    fta: 2,
    plusMinus: 5
  };

  const mockTeamTotals = {
    points: 100,
    rebounds: 40,
    assists: 25,
    steals: 8,
    blocks: 5,
    personalFouls: 15,
    fgm: 40,
    fga: 80,
    threePm: 10,
    threePa: 30,
    ftm: 10,
    fta: 15
  };

  const mockTeam = {
    teamId: '1',
    teamTricode: 'MOK',
    score: 100,
    players: Array(5).fill(mockPlayerStats),
    totals: mockTeamTotals,
    stats: {
      rebounds: 40,
      assists: 25,
      blocks: 5
    }
  };

  return {
    gameId,
    status: 'final',
    period: 4,
    clock: '',
    homeTeam: { ...mockTeam, teamTricode: 'HOM' },
    awayTeam: { ...mockTeam, teamTricode: 'AWY' },
    arena: 'Mock Arena',
    attendance: 18000,
    lastUpdate: Date.now()
  };
} 