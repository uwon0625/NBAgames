import axios from 'axios';
import { logger } from '../config/logger';
import { GameScore, GameBoxScore, NBAGame, Team, TeamBoxScore } from '../types';
import { mockScoreboard, mockBoxScore } from './mockData';
import dotenv from 'dotenv';
import { GameStatus } from '../types/enums';
dotenv.config();

// Configuration constants
const USE_MOCK_DATA = process.env.USE_MOCK_DATA === 'true';
const NBA_BASE_URL = process.env.NBA_BASE_URL || 'https://nba-prod-us-east-1-mediaops-stats.s3.amazonaws.com/NBA/liveData';
const NBA_API_URL = `${NBA_BASE_URL}/scoreboard/todaysScoreboard_00.json`;
const NBA_BOXSCORE_URL = (gameId: string) => 
  `${NBA_BASE_URL}/boxscore/boxscore_${gameId}.json`;

// Axios config
const axiosConfig = {
  headers: {
    'Accept': 'application/json',
    'Cache-Control': 'no-cache'
  }
};

function transformTeamStats(team: any) {
  // Use the full statistics object if available, otherwise use basic stats
  const stats = team.statistics || {};
  
  return {
    rebounds: parseInt(String(stats.reboundsTotal || '0')),
    assists: parseInt(String(stats.assists || '0')),
    blocks: parseInt(String(stats.blocks || '0'))
  };
}

function transformTeam(team: any): Team {
  // For game cards, we need to use the full statistics
  const stats = transformTeamStats(team);
  
  return {
    teamId: team.teamId.toString(),
    teamTricode: team.teamTricode,
    score: parseInt(String(team.score || '0')),
    stats: {
      rebounds: stats.rebounds,
      assists: stats.assists,
      blocks: stats.blocks
    }
  };
}

function transformPlayerStats(player: any) {
  return {
    playerId: player.personId,
    name: player.name,
    position: player.position || '',
    minutes: player.statistics?.minutesCalculated || '0:00',
    points: parseInt(String(player.statistics?.points || '0')),
    rebounds: parseInt(String(player.statistics?.reboundsTotal || '0')),
    assists: parseInt(String(player.statistics?.assists || '0')),
    steals: parseInt(String(player.statistics?.steals || '0')),
    blocks: parseInt(String(player.statistics?.blocks || '0')),
    personalFouls: parseInt(String(player.statistics?.foulsPersonal || '0')),
    fgm: parseInt(String(player.statistics?.fieldGoalsMade || '0')),
    fga: parseInt(String(player.statistics?.fieldGoalsAttempted || '0')),
    threePm: parseInt(String(player.statistics?.threePointersMade || '0')),
    threePa: parseInt(String(player.statistics?.threePointersAttempted || '0')),
    ftm: parseInt(String(player.statistics?.freeThrowsMade || '0')),
    fta: parseInt(String(player.statistics?.freeThrowsAttempted || '0')),
    plusMinus: parseInt(String(player.statistics?.plusMinusPoints || '0'))
  };
}

function transformBoxScoreTeam(team: any): TeamBoxScore {
  const baseTeam = transformTeam(team);
  
  // Transform players
  const players = (team.players || []).map(transformPlayerStats);

  return {
    ...baseTeam,
    players,
    totals: {
      points: parseInt(String(team.score || '0')),
      rebounds: parseInt(String(team.statistics?.reboundsTotal || '0')),
      assists: parseInt(String(team.statistics?.assists || '0')),
      steals: parseInt(String(team.statistics?.steals || '0')),
      blocks: parseInt(String(team.statistics?.blocks || '0')),
      personalFouls: parseInt(String(team.statistics?.foulsPersonal || '0')),
      fgm: parseInt(String(team.statistics?.fieldGoalsMade || '0')),
      fga: parseInt(String(team.statistics?.fieldGoalsAttempted || '0')),
      threePm: parseInt(String(team.statistics?.threePointersMade || '0')),
      threePa: parseInt(String(team.statistics?.threePointersAttempted || '0')),
      ftm: parseInt(String(team.statistics?.freeThrowsMade || '0')),
      fta: parseInt(String(team.statistics?.freeThrowsAttempted || '0'))
    }
  };
}

function getGameStatus(gameStatus: number): GameStatus {
  switch (gameStatus) {
    case 2:
      return GameStatus.LIVE;
    case 3:
      return GameStatus.FINAL;
    default:
      return GameStatus.SCHEDULED;
  }
}

export async function fetchNBAScoreboard() {
  try {
    if (USE_MOCK_DATA) {
      logger.info('Using mock scoreboard data');
      return mockScoreboard.scoreboard;
    }

    console.log('Fetching NBA scoreboard from:', NBA_API_URL);
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

  try {
    const response = await axios.get(NBA_BOXSCORE_URL(gameId), axiosConfig);
    return response.data.game;
  } catch (error) {
    logger.error(`Failed to fetch box score for game ${gameId}:`, error);
    return null;
  }
}

export async function transformNBAGame(nbaGame: NBAGame): Promise<GameScore> {
  try {
    // Fetch box score data to get detailed statistics
    const boxScore = await fetchNBABoxScore(nbaGame.gameId);
    
    // Use box score stats if available, otherwise use basic game stats
    const homeTeamStats = boxScore?.homeTeam?.statistics || {};
    const awayTeamStats = boxScore?.awayTeam?.statistics || {};

    return {
      gameId: nbaGame.gameId,
      status: getGameStatus(nbaGame.gameStatus),
      period: nbaGame.period || 0,
      clock: nbaGame.gameClock || '',
      homeTeam: {
        teamId: nbaGame.homeTeam.teamId.toString(),
        teamTricode: nbaGame.homeTeam.teamTricode,
        score: parseInt(String(nbaGame.homeTeam.score || '0')),
        stats: {
          rebounds: parseInt(String(homeTeamStats.reboundsTotal || '0')),
          assists: parseInt(String(homeTeamStats.assists || '0')),
          blocks: parseInt(String(homeTeamStats.blocks || '0'))
        }
      },
      awayTeam: {
        teamId: nbaGame.awayTeam.teamId.toString(),
        teamTricode: nbaGame.awayTeam.teamTricode,
        score: parseInt(String(nbaGame.awayTeam.score || '0')),
        stats: {
          rebounds: parseInt(String(awayTeamStats.reboundsTotal || '0')),
          assists: parseInt(String(awayTeamStats.assists || '0')),
          blocks: parseInt(String(awayTeamStats.blocks || '0'))
        }
      },
      lastUpdate: Date.now()
    };
  } catch (error) {
    logger.error(`Error transforming game ${nbaGame.gameId}:`, error);
    // Return basic game data without statistics if box score fetch fails
    return {
      gameId: nbaGame.gameId,
      status: getGameStatus(nbaGame.gameStatus),
      period: nbaGame.period || 0,
      clock: nbaGame.gameClock || '',
      homeTeam: transformTeam(nbaGame.homeTeam),
      awayTeam: transformTeam(nbaGame.awayTeam),
      lastUpdate: Date.now()
    };
  }
}

export function transformNBABoxScore(nbaBoxScore: any): GameBoxScore {
  return {
    gameId: nbaBoxScore.gameId,
    status: GameStatus.SCHEDULED,
    period: nbaBoxScore.period,
    clock: nbaBoxScore.gameClock || '',
    homeTeam: transformBoxScoreTeam(nbaBoxScore.homeTeam),
    awayTeam: transformBoxScoreTeam(nbaBoxScore.awayTeam),
    arena: nbaBoxScore.arena?.arenaName || '',
    attendance: nbaBoxScore.attendance || 0,
    lastUpdate: Date.now()
  };
}

export async function getGames(): Promise<GameScore[]> {
  try {
    const scoreboard = await fetchNBAScoreboard();
    return Promise.all(scoreboard.games.map(transformNBAGame));
  } catch (error) {
    logger.error('Failed to get games:', error);
    throw error;
  }
}

export async function getGameBoxScore(gameId: string): Promise<GameBoxScore | null> {
  try {
    const boxScore = await fetchNBABoxScore(gameId);
    return boxScore ? transformNBABoxScore(boxScore) : null;
  } catch (error) {
    logger.error(`Failed to get box score for game ${gameId}:`, error);
    throw error;
  }
} 