import { GameScore, GameBoxScore } from '../types';
import { fetchNBAScoreboard, fetchGameById, fetchNBABoxScore, transformNBAGame, transformNBABoxScore } from './nbaService';
import { logger } from '../config/logger';
import { CacheService } from './cacheService';
import { generateGames, generateBoxScore } from '../testData/generateGames';

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
  private lastGameStates: Map<string, string> = new Map(); // gameId -> hash of game state

  constructor() {
    this.cacheService = new CacheService();
  }

  // Add public method for caching
  public async cacheGame(gameId: string, game: GameScore): Promise<void> {
    await this.cacheService.cacheGameScore(gameId, game);
  }

  private getGameStateHash(game: GameScore): string {
    // Only hash the fields we care about
    const relevantData = {
      status: game.status,
      period: game.period,
      clock: game.clock,
      homeTeam: {
        score: game.homeTeam.score,
        stats: game.homeTeam.stats
      },
      awayTeam: {
        score: game.awayTeam.score,
        stats: game.awayTeam.stats
      }
    };
    return JSON.stringify(relevantData);
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
      if (process.env.USE_MOCK_DATA === 'true') {
        logger.info(`Using mock data for game ${gameId}`);
        const { games } = await this.getGames();
        return games.find(g => g.gameId === gameId) || null;
      }

      const game = await fetchGameById(gameId);
      if (!game) return null;

      return {
        ...transformNBAGame(game),
        status: validateGameStatus(game.gameStatus)
      };
    } catch (error) {
      logger.error(`Failed to get game ${gameId}:`, error);
      if (process.env.USE_MOCK_DATA === 'true') {
        const { games } = await this.getGames();
        return games.find(g => g.gameId === gameId) || null;
      }
      throw error;
    }
  }

  async getBoxScoreFromDB(gameId: string): Promise<GameBoxScore | null> {
    try {
      if (process.env.USE_MOCK_DATA === 'true') {
        logger.info(`Using mock data for game ${gameId}`);
        const { games } = await this.getGames();
        const game = games.find(g => g.gameId === gameId);
        if (!game) {
          logger.warn(`Game ${gameId} not found`);
          return null;
        }
        return generateBoxScore(game);
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

      if (process.env.USE_MOCK_DATA === 'true') {
        logger.info(`Falling back to mock data for game ${gameId}`);
        const { games } = await this.getGames();
        const game = games.find(g => g.gameId === gameId);
        return game ? generateBoxScore(game) : null;
      }

      return null;
    } catch (error) {
      logger.error(`Failed to get box score for game ${gameId}:`, error);
      if (process.env.USE_MOCK_DATA === 'true') {
        logger.info('Using mock data due to error');
        const { games } = await this.getGames();
        const game = games.find(g => g.gameId === gameId);
        return game ? generateBoxScore(game) : null;
      }
      throw error;
    }
  }

  private async fetchGames(): Promise<GameScore[]> {
    try {
      if (process.env.USE_MOCK_DATA === 'true') {
        logger.info('Using mock data for games');
        return generateGames(6); // Generate 6 mock games
      }

      const scoreboard = await fetchNBAScoreboard();
      if (!scoreboard?.games) {
        logger.warn('No games data in scoreboard');
        return [];
      }

      return scoreboard.games
        .map((game: NBAGameData) => {
          if (!game) return null;
          
          return {
            gameId: game.gameId,
            status: validateGameStatus(game.gameStatus),
            period: game.period || 0,
            clock: game.gameClock || '',
            homeTeam: {
              teamId: game.homeTeam.teamId.toString(),
              teamTricode: game.homeTeam.teamTricode,
              score: parseInt(game.homeTeam.score.toString()) || 0,
              stats: {
                rebounds: parseInt(game.homeTeam.statistics?.reboundsDefensive || '0') + 
                         parseInt(game.homeTeam.statistics?.reboundsOffensive || '0'),
                assists: parseInt(game.homeTeam.statistics?.assists || '0'),
                blocks: parseInt(game.homeTeam.statistics?.blocks || '0')
              }
            },
            awayTeam: {
              teamId: game.awayTeam.teamId.toString(),
              teamTricode: game.awayTeam.teamTricode,
              score: parseInt(game.awayTeam.score.toString()) || 0,
              stats: {
                rebounds: parseInt(game.awayTeam.statistics?.reboundsDefensive || '0') + 
                         parseInt(game.awayTeam.statistics?.reboundsOffensive || '0'),
                assists: parseInt(game.awayTeam.statistics?.assists || '0'),
                blocks: parseInt(game.awayTeam.statistics?.blocks || '0')
              }
            },
            lastUpdate: Date.now()
          };
        })
        .filter((game: GameScore | null): game is GameScore => game !== null);
    } catch (error) {
      logger.error('Failed to fetch games:', error);
      if (process.env.USE_MOCK_DATA === 'true') {
        logger.info('Using mock data due to error');
        return generateGames(6);
      }
      throw error;
    }
  }

  async getGames(): Promise<{ games: GameScore[], changedGameIds: string[] }> {
    try {
      const games = await this.fetchGames();
      const changedGameIds: string[] = [];

      games.forEach(game => {
        const newStateHash = this.getGameStateHash(game);
        const oldStateHash = this.lastGameStates.get(game.gameId);
        
        if (newStateHash !== oldStateHash) {
          changedGameIds.push(game.gameId);
          this.lastGameStates.set(game.gameId, newStateHash);
        }
      });

      return { games, changedGameIds };
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