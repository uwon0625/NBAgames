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
    return mockScoreboard.scoreboard;
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

export async function fetchGameById(gameId: string) {
  try {
    const scoreboard = await fetchNBAScoreboard();
    return scoreboard.games.find((game: NBAGame) => game.gameId === gameId) || null;
  } catch (error) {
    logger.error(`Failed to fetch game ${gameId}:`, error);
    throw error;
  }
}

export async function fetchLiveGames(): Promise<GameScore[]> {
  try {
    const scoreboard = await fetchNBAScoreboard();
    return scoreboard.games.filter((game: NBAGame) => game.gameStatus === 2);
  } catch (error) {
    logger.error('Failed to fetch live games:', error);
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

  return {
    gameId: nbaBoxScore.gameId,
    status: parentGame?.status || 'scheduled',
    period: nbaBoxScore.period || 0,
    clock: parentGame?.clock || nbaBoxScore.gameClock || '',
    homeTeam: transformTeam(nbaBoxScore.homeTeam),
    awayTeam: transformTeam(nbaBoxScore.awayTeam),
    arena: nbaBoxScore.arena?.arenaName || '',
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