import axios from 'axios';
import { logger } from '../config/logger';
import { GameScore, GameBoxScore, NBAGame } from '../types';
import { mockScoreboard, mockBoxScore } from './mockData';
import dotenv from 'dotenv';
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

export async function fetchNBAScoreboard() {
  try {
    if (USE_MOCK_DATA) {
      logger.info('Using mock scoreboard data');
      return mockScoreboard.scoreboard;
    }

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
  const transformTeam = (team: any) => ({
    teamId: team.teamId.toString(),
    teamTricode: team.teamTricode,
    score: team.score || 0,
    stats: {
      rebounds: parseInt(team.statistics?.reboundsDefensive || '0') + 
                parseInt(team.statistics?.reboundsOffensive || '0'),
      assists: parseInt(team.statistics?.assists || '0'),
      blocks: parseInt(team.statistics?.blocks || '0')
    }
  });

  return {
    gameId: nbaGame.gameId,
    status: nbaGame.gameStatus === 2 ? 'live' : 
            nbaGame.gameStatus === 3 ? 'final' : 
            'scheduled',
    period: nbaGame.period || 0,
    clock: nbaGame.gameClock || '',
    homeTeam: transformTeam(nbaGame.homeTeam),
    awayTeam: transformTeam(nbaGame.awayTeam),
    lastUpdate: Date.now()
  };
}

export function transformNBABoxScore(nbaBoxScore: any): GameBoxScore {
  const transformTeam = (team: any) => {
    const stats = {
      rebounds: parseInt(team.statistics?.reboundsDefensive || '0') + 
                parseInt(team.statistics?.reboundsOffensive || '0'),
      assists: parseInt(team.statistics?.assists || '0'),
      blocks: parseInt(team.statistics?.blocks || '0')
    };

    // Transform players with proper minutes format
    const players = (team.players || []).map((player: any) => {
      // Convert PT format to MM:SS
      const minutesStr = player.statistics?.minutesCalculated || '';
      let minutes = '0:00';
      if (minutesStr.startsWith('PT')) {
        const matches = minutesStr.match(/PT(\d+)M(?:(\d+(?:\.\d+)?)S)?/);
        if (matches) {
          const mins = matches[1];
          const secs = matches[2] ? Math.floor(parseFloat(matches[2])) : 0;
          minutes = `${mins}:${secs.toString().padStart(2, '0')}`;
        }
      }

      return {
        ...player,
        statistics: {
          ...player.statistics,
          minutesCalculated: minutes
        }
      };
    });

    return {
      teamId: team.teamId,
      teamTricode: team.teamTricode,
      score: team.score,
      players,
      stats,
      totals: {
        points: team.score,
        rebounds: stats.rebounds,
        assists: stats.assists,
        steals: parseInt(team.statistics?.steals || '0'),
        blocks: stats.blocks,
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

  return {
    gameId: nbaBoxScore.gameId,
    status: 'scheduled',
    period: nbaBoxScore.period,
    clock: nbaBoxScore.gameClock || '',
    homeTeam: transformTeam(nbaBoxScore.homeTeam),
    awayTeam: transformTeam(nbaBoxScore.awayTeam),
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