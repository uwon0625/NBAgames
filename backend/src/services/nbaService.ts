import axios from 'axios';
import { logger } from '../config/logger';
import { GameBoxScore, GameScore, NBAGame } from '../types';
import { mockScoreboard, mockBoxScore } from './mockData';
import dotenv from 'dotenv';
dotenv.config();

// Move constants to use env vars
const USE_MOCK_DATA = process.env.USE_MOCK_DATA === 'true';
const NBA_BASE_URL = process.env.NBA_BASE_URL || 'https://nba-prod-us-east-1-mediaops-stats.s3.amazonaws.com/NBA/liveData';
const NBA_API_URL = process.env.NBA_API_URL || `${NBA_BASE_URL}/scoreboard/todaysScoreboard_00.json`;
const NBA_BOXSCORE_URL = (gameId: string) => 
  `${NBA_BASE_URL}/boxscore/boxscore_${gameId}.json`;

// Add axios config
const axiosConfig = {
  headers: {
    'Accept': 'application/json',
    'Cache-Control': 'no-cache'
  }
};

export async function fetchNBAScoreboard() {
  if (USE_MOCK_DATA) {
    logger.info('Using mock scoreboard data');
    const data = mockScoreboard.scoreboard;
    logger.info('Mock data structure:', {
      gameCount: data.games.length,
      sampleGame: data.games[0]
    });
    return data;
  }

  try {
    const response = await axios.get(NBA_API_URL, axiosConfig);
    return response.data.scoreboard;
  } catch (error) {
    logger.error('Failed to fetch NBA scoreboard:', error);
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
    
    if (!response.data?.game) {
      logger.warn(`No box score data for game ${gameId}`);
      return null;
    }

    return response.data.game;
  } catch (error) {
    logger.error(`Failed to fetch box score: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export function transformNBAGame(nbaGame: NBAGame): GameScore {
  const transformTeam = (team: any) => {
    // Parse all string values to numbers
    const stats = {
      rebounds: parseInt(team.statistics?.reboundsDefensive || '0') + 
                parseInt(team.statistics?.reboundsOffensive || '0'),
      assists: parseInt(team.statistics?.assists || '0'),
      blocks: parseInt(team.statistics?.blocks || '0')
    };

    logger.info(`Transformed team stats for ${team.teamTricode}:`, {
      rawStats: team.statistics,
      parsedStats: stats
    });

    return {
      teamId: team.teamId.toString(),
      teamTricode: team.teamTricode,
      score: parseInt(team.score.toString() || '0'),
      stats
    };
  };

  const mapGameStatus = (status: number, statusText: string): 'scheduled' | 'live' | 'final' => {
    logger.info(`Mapping game status for game ${nbaGame.gameId}:`, {
      rawStatus: status,
      rawStatusText: statusText,
      mappedStatus: status === 2 ? 'live' : status === 3 ? 'final' : 'scheduled'
    });
    
    switch (status) {
      case 2:
        return 'live';
      case 3:
        return 'final';
      default:
        return 'scheduled';
    }
  };

  const transformed = {
    gameId: nbaGame.gameId,
    status: mapGameStatus(nbaGame.gameStatus, nbaGame.gameStatusText),
    period: parseInt(nbaGame.period.toString() || '0'),
    clock: nbaGame.gameClock || '',
    homeTeam: transformTeam(nbaGame.homeTeam),
    awayTeam: transformTeam(nbaGame.awayTeam),
    lastUpdate: Date.now()
  };

  logger.info(`Transformed game ${nbaGame.gameId}:`, {
    rawGame: {
      status: nbaGame.gameStatus,
      statusText: nbaGame.gameStatusText,
      homeTeam: nbaGame.homeTeam,
      awayTeam: nbaGame.awayTeam
    },
    transformedGame: transformed
  });

  return transformed;
}

export async function fetchGameById(gameId: string) {
  try {
    const scoreboard = await fetchNBAScoreboard();
    const game = scoreboard.games.find((game: NBAGame) => game.gameId === gameId);
    return game ? transformNBAGame(game) : null;
  } catch (error) {
    logger.error(`Failed to fetch game ${gameId}:`, error);
    throw error;
  }
}

export async function fetchLiveGames(): Promise<GameScore[]> {
  try {
    const scoreboard = await fetchNBAScoreboard();
    return scoreboard.games
      .filter((game: NBAGame) => game.gameStatus === 2)
      .map(transformNBAGame);
  } catch (error) {
    logger.error('Failed to fetch live games:', error);
    throw error;
  }
}

export async function getGames(): Promise<GameScore[]> {
  try {
    const scoreboard = await fetchNBAScoreboard();
    logger.info('Raw scoreboard data:', {
      gameCount: scoreboard.games.length,
      gameStatuses: scoreboard.games.map((g: NBAGame) => g.gameStatus)
    });

    // Transform each game
    const transformedGames = scoreboard.games.map((game: NBAGame) => {
      const transformedGame = transformNBAGame(game);
      logger.info(`Transformed game ${game.gameId}:`, {
        rawStatus: game.gameStatus,
        transformedStatus: transformedGame.status,
        rawStats: {
          home: game.homeTeam.statistics,
          away: game.awayTeam.statistics
        },
        transformedStats: {
          home: transformedGame.homeTeam.stats,
          away: transformedGame.awayTeam.stats
        }
      });
      return transformedGame;
    });

    logger.info('All transformed games:', {
      count: transformedGames.length,
      statuses: transformedGames.map((g: GameScore) => g.status),
      stats: transformedGames.map((g: GameScore) => ({
        id: g.gameId,
        homeStats: g.homeTeam.stats,
        awayStats: g.awayTeam.stats
      }))
    });
    
    return transformedGames;
  } catch (error) {
    logger.error('Failed to get games:', error);
    throw error;
  }
}

export function transformNBABoxScore(nbaBoxScore: any, parentGame?: GameScore): GameBoxScore {
  const transformTeam = (team: any) => {
    return {
      teamId: team.teamId.toString(),
      teamTricode: team.teamTricode,
      score: team.score || 0,
      players: team.players?.map(transformPlayerStats) || [],
      stats: {
        rebounds: parseInt(team.statistics?.reboundsDefensive || '0') + 
                 parseInt(team.statistics?.reboundsOffensive || '0'),
        assists: parseInt(team.statistics?.assists || '0'),
        blocks: parseInt(team.statistics?.blocks || '0')
      },
      totals: {
        points: team.score || 0,
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

  // More strict arena name extraction
  let arenaName = '';
  if (nbaBoxScore.arena) {
    if (typeof nbaBoxScore.arena === 'string') {
      arenaName = nbaBoxScore.arena;
    } else if (typeof nbaBoxScore.arena === 'object' && nbaBoxScore.arena.arenaName) {
      arenaName = nbaBoxScore.arena.arenaName;
    }
  }

  return {
    gameId: nbaBoxScore.gameId,
    status: parentGame?.status || 'scheduled',
    period: nbaBoxScore.period || 0,
    clock: parentGame?.clock || nbaBoxScore.gameClock || '',
    homeTeam: transformTeam(nbaBoxScore.homeTeam),
    awayTeam: transformTeam(nbaBoxScore.awayTeam),
    arena: arenaName,
    attendance: nbaBoxScore.attendance || 0,
    lastUpdate: Date.now()
  };
}

function transformPlayerStats(player: any) {
  return {
    playerId: player.personId,
    name: `${player.firstName} ${player.familyName}`,
    position: player.position || '',
    minutes: player.statistics?.minutesCalculated || '0',
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
    plusMinus: parseInt(player.statistics?.plusMinusPoints || '0')
  };
} 