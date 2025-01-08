import { GameScore, GameBoxScore } from '../types';
import { getGames as getNBAGames, getGameBoxScore as getNBABoxScore } from './nbaService';
import { logger } from '../config/logger';
import { CacheService } from './cacheService';
import { generateGames, generateBoxScore } from '../testData/generateGames';

export class GameService {
  private cacheService: CacheService;
  private lastGameStates: Map<string, string> = new Map(); // gameId -> hash of game state

  constructor() {
    this.cacheService = new CacheService();
  }

  public async cacheGame(gameId: string, game: GameScore): Promise<void> {
    await this.cacheService.cacheGameScore(gameId, game);
  }

  private getGameStateHash(game: GameScore): string {
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

    // If not in cache, get from list of games
    const { games } = await this.getGames();
    const game = games.find(g => g.gameId === gameId);
    
    // Cache the result if it exists
    if (game) {
      await this.cacheService.cacheGameScore(gameId, game);
    }
    
    return game || null;
  }

  async getBoxScore(gameId: string): Promise<GameBoxScore | null> {
    try {
      // Try cache first
      const cached = await this.cacheService.getCachedBoxScore(gameId);
      if (cached) {
        return cached;
      }

      // If not in cache, get from NBA API
      const boxScore = await getNBABoxScore(gameId);
      
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

  async getGames(): Promise<{ games: GameScore[], changedGameIds: string[] }> {
    try {
      const games = await getNBAGames();
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
} 