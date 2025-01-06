import { GameScore, GameBoxScore } from '../types';
import { fetchNBAScoreboard, fetchGameById, fetchNBABoxScore, transformNBAGame, transformNBABoxScore } from './nbaService';
import { generateMockBoxScore } from '../utils/mockData';
import { logger } from '../config/logger';
import { CacheService } from './cacheService';

const USE_TEST_DATA = process.env.USE_TEST_DATA === 'true';

type GameStatus = 'scheduled' | 'live' | 'final';

interface NBAGameData {
  gameId: string;
  gameStatus: number;
  period: number;
  gameClock: string;
  homeTeam: {
    teamId: number;
    teamTricode: string;
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
    teamTricode: string;
    score: number;
    statistics?: {
      reboundsDefensive: string;
      reboundsOffensive: string;
      assists: string;
      blocks: string;
    };
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

export class GameService {
  private cacheService: CacheService;

  constructor() {
    this.cacheService = new CacheService();
  }

  async getGame(gameId: string): Promise<GameScore | null> {
    // Try cache first
    const cached = await this.cacheService.getCachedGame(gameId);
    if (cached) {
      return cached;
    }

    // If not in cache, get from DB
    const game = await this.getGameFromDB(gameId);
    
    // Cache the result if it exists
    if (game) {
      await this.cacheService.cacheGameScore(gameId, game);
    }
    
    return game;
  }

  async getBoxScore(gameId: string): Promise<GameBoxScore | null> {
    try {
      // Try cache first
      const cached = await this.cacheService.getCachedBoxScore(gameId);
      if (cached) {
        return cached;
      }

      // If not in cache, get from DB
      const boxScore = await this.getBoxScoreFromDB(gameId);
      
      // Cache the result if it exists
      if (boxScore) {
        await this.cacheService.cacheBoxScore(gameId, boxScore);
      }
      
      return boxScore;
    } catch (error) {
      logger.error(`Failed to get box score for game ${gameId}:`, error);
      throw error;
    }
  }

  async getGameFromDB(gameId: string): Promise<GameScore | null> {
    try {
      const game = await fetchGameById(gameId);
      if (!game) return null;

      return {
        ...transformNBAGame(game),
        status: validateGameStatus(game.gameStatus)
      };
    } catch (error) {
      logger.error(`Failed to get game ${gameId}:`, error);
      throw error;
    }
  }

  async getBoxScoreFromDB(gameId: string): Promise<GameBoxScore | null> {
    try {
      if (USE_TEST_DATA) {
        logger.info(`Using mock data for game ${gameId}`);
        return generateMockBoxScore(gameId);
      }

      // First try to get the game from the scoreboard
      const game = await fetchGameById(gameId);
      if (!game) {
        logger.warn(`Game ${gameId} not found in scoreboard`);
        return null;
      }

      try {
        // Then try to get detailed box score
        const boxScore = await fetchNBABoxScore(gameId);
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
        logger.info(`Falling back to mock data for game ${gameId}`);
        return generateMockBoxScore(gameId);
      }

      return null;
    } catch (error) {
      logger.error(`Failed to get box score for game ${gameId}:`, error);
      if (USE_TEST_DATA) {
        logger.info('Using mock data due to error');
        return generateMockBoxScore(gameId);
      }
      throw error;
    }
  }

  async getGames(): Promise<GameScore[]> {
    try {
      const scoreboard = await fetchNBAScoreboard();
      if (!scoreboard?.games) {
        logger.warn('No games data in scoreboard');
        return [];
      }

      logger.info('Raw scoreboard data:', {
        firstGame: scoreboard.games[0],
        firstGameHomeTeam: scoreboard.games[0].homeTeam,
        firstGameAwayTeam: scoreboard.games[0].awayTeam
      });

      return scoreboard.games
        .map((game: NBAGameData) => {
          if (!game) return null;
          
          logger.info('Processing game data:', {
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

          const transformed = {
            gameId: game.gameId,
            status: validateGameStatus(game.gameStatus),
            period: game.period || 0,
            clock: game.gameClock || '',
            homeTeam: {
              teamId: game.homeTeam.teamId.toString(),
              teamTricode: game.homeTeam.teamTricode,
              score: parseInt(game.homeTeam.score.toString()) || 0,
              stats: {
                rebounds: 0,
                assists: 0,
                blocks: 0
              }
            },
            awayTeam: {
              teamId: game.awayTeam.teamId.toString(),
              teamTricode: game.awayTeam.teamTricode,
              score: parseInt(game.awayTeam.score.toString()) || 0,
              stats: {
                rebounds: 0,
                assists: 0,
                blocks: 0
              }
            },
            lastUpdate: Date.now()
          };

          logger.info('Transformed game data:', transformed);

          return transformed;
        })
        .filter((game: GameScore | null): game is GameScore => game !== null);
    } catch (error) {
      logger.error('Failed to get games:', error);
      throw error;
    }
  }

  generateMockGame(id: number): NBAGameData {
    const teams = [
      { teamTricode: 'LAL' },
      { teamTricode: 'GSW' },
      { teamTricode: 'BOS' },
      { teamTricode: 'BKN' },
      { teamTricode: 'MIA' },
      { teamTricode: 'PHX' }
    ];

    const homeTeamIndex = id % teams.length;
    const awayTeamIndex = (id + 1) % teams.length;

    return {
      gameId: `00${id}`,
      gameStatus: Math.random() > 0.7 ? 2 : Math.random() > 0.5 ? 3 : 1,
      period: Math.floor(Math.random() * 4) + 1,
      gameClock: 'PT11M52.00S',
      homeTeam: {
        teamId: id * 2,
        teamTricode: teams[homeTeamIndex].teamTricode,
        score: Math.floor(Math.random() * 120),
        statistics: {
          reboundsDefensive: '30',
          reboundsOffensive: '10',
          assists: '25',
          blocks: '5'
        }
      },
      awayTeam: {
        teamId: id * 2 + 1,
        teamTricode: teams[awayTeamIndex].teamTricode,
        score: Math.floor(Math.random() * 120),
        statistics: {
          reboundsDefensive: '28',
          reboundsOffensive: '12',
          assists: '22',
          blocks: '4'
        }
      }
    };
  }
} 