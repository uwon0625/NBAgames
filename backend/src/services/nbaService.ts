import axios from 'axios';
import { logger } from '../config/logger';
import { GameBoxScore, PlayerStats, TeamBoxScore, GameScore } from '../types';

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

// Improved cache interface with box score data
interface BoxScoreCache {
  [gameId: string]: {
    data: GameBoxScore;
    timestamp: number;
  }
}

const boxScoreCache: BoxScoreCache = {};
const CACHE_TTL = 60 * 1000; // 1 minute cache

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

// Get box score with cache
async function getBoxScoreWithCache(gameId: string): Promise<GameBoxScore | null> {
  const now = Date.now();
  const cached = boxScoreCache[gameId];

  if (cached && (now - cached.timestamp) < CACHE_TTL) {
    logger.debug(`Using cached box score for game ${gameId}`);
    return cached.data;
  }

  try {
    const boxScore = await fetchNBABoxScore(gameId);
    if (boxScore) {
      const transformedBoxScore = transformNBABoxScore(boxScore);
      boxScoreCache[gameId] = {
        data: transformedBoxScore,
        timestamp: now
      };
      return transformedBoxScore;
    }
    return null;
  } catch (error) {
    logger.error(`Error fetching box score for game ${gameId}:`, error);
    return null;
  }
}

// Prefetch box scores for all games
async function prefetchBoxScores(games: NBAGame[]): Promise<void> {
  logger.debug('Prefetching box scores for all games');
  await Promise.all(
    games.map(game => getBoxScoreWithCache(game.gameId))
  );
}

// Get team stats from cache if available
function getTeamStatsFromCache(gameId: string, isHome: boolean): any {
  const cached = boxScoreCache[gameId];
  if (cached) {
    const team = isHome ? cached.data.homeTeam : cached.data.awayTeam;
    return team.stats;
  }
  return null;
}

export async function getGames(): Promise<GameScore[]> {
  try {
    const scoreboard = await fetchNBAScoreboard();
    if (!scoreboard?.games) {
      logger.warn('No games data in scoreboard');
      return [];
    }

    // Prefetch box scores in the background
    prefetchBoxScores(scoreboard.games).catch(error => 
      logger.error('Error prefetching box scores:', error)
    );

    // Transform games with cached stats when available
    return scoreboard.games.map((game: NBAGame) => {
      const transformed = transformNBAGame(game);
      const homeStats = getTeamStatsFromCache(game.gameId, true);
      const awayStats = getTeamStatsFromCache(game.gameId, false);

      return {
        ...transformed,
        homeTeam: {
          ...transformed.homeTeam,
          stats: homeStats || transformed.homeTeam.stats
        },
        awayTeam: {
          ...transformed.awayTeam,
          stats: awayStats || transformed.awayTeam.stats
        }
      };
    });
  } catch (error) {
    logger.error('Failed to get games:', error);
    throw error;
  }
}

export async function getGameBoxScore(gameId: string): Promise<GameBoxScore | null> {
  return getBoxScoreWithCache(gameId);
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

// Keep other necessary functions (transformNBABoxScore, transformNBAGame, etc.)
// but remove unused ones 