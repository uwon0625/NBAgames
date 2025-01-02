import { GameScore, GameBoxScore } from '../types';
import { fetchNBAScoreboard, fetchGameById, fetchNBABoxScore, transformNBAGame, transformNBABoxScore } from './nbaService';
import { generateMockBoxScore } from '../utils/mockData';
import { logger } from '../config/logger';

const USE_TEST_DATA = process.env.USE_TEST_DATA === 'true';

type GameStatus = 'scheduled' | 'live' | 'final';

interface NBAGameData {
  gameId: string;
  gameStatus: number;
  period: number;
  gameClock: string;
  homeTeam: {
    teamId: number;
    teamName: string;
    teamCity: string;
    score: number;
  };
  awayTeam: {
    teamId: number;
    teamName: string;
    teamCity: string;
    score: number;
  };
}

function validateGameStatus(status: number): GameStatus {
  switch (status) {
    case 1:
      return 'scheduled';
    case 2:
      return 'live';
    case 3:
      return 'final';
    default:
      return 'scheduled';
  }
}

export async function getGames(): Promise<GameScore[]> {
  try {
    const scoreboard = await fetchNBAScoreboard();
    if (!scoreboard?.games) {
      logger.warn('No games data in scoreboard');
      return [];
    }

    return scoreboard.games
      .map((game: NBAGameData) => {
        if (!game) return null;
        return {
          ...transformNBAGame(game),
          status: validateGameStatus(game.gameStatus)
        };
      })
      .filter((game: GameScore | null): game is GameScore => game !== null);
  } catch (error) {
    logger.error('Failed to get games:', error);
    throw error;
  }
}

export async function getGameById(id: string): Promise<GameScore | null> {
  try {
    const game = await fetchGameById(id);
    if (!game) return null;

    return {
      ...transformNBAGame(game),
      status: validateGameStatus(game.gameStatus)
    };
  } catch (error) {
    logger.error(`Failed to get game ${id}:`, error);
    throw error;
  }
}

export async function getGameBoxScore(id: string): Promise<GameBoxScore | null> {
  try {
    if (USE_TEST_DATA) {
      logger.info(`Using mock data for game ${id}`);
      return generateMockBoxScore(id);
    }

    // First try to get the game from the scoreboard
    const game = await fetchGameById(id);
    if (!game) {
      logger.warn(`Game ${id} not found in scoreboard`);
      return null;
    }

    try {
      // Then try to get detailed box score
      const boxScore = await fetchNBABoxScore(id);
      if (boxScore) {
        return transformNBABoxScore(boxScore);
      }
    } catch (boxScoreError) {
      logger.error(`Failed to fetch box score, falling back to basic game data:`, boxScoreError);
      // Fall back to basic game data if box score fails
      return transformNBABoxScore(game);
    }

    // If all else fails and we're in test mode, use mock data
    if (USE_TEST_DATA) {
      logger.info(`Falling back to mock data for game ${id}`);
      return generateMockBoxScore(id);
    }

    return null;
  } catch (error) {
    logger.error(`Failed to get box score for game ${id}:`, error);
    if (USE_TEST_DATA) {
      logger.info('Using mock data due to error');
      return generateMockBoxScore(id);
    }
    throw error;
  }
} 