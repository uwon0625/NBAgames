import { GameScore, GameBoxScore } from '../types';
import { fetchNBAScoreboard, fetchNBABoxScore, fetchGameById } from './nbaService';
import { logger } from '../config/logger';
import { CacheService } from './cacheService';

export class GameService {
  private cacheService: CacheService;
  private lastGameStates: Map<string, string> = new Map();

  constructor() {
    this.cacheService = new CacheService();
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

  async cacheGameScore(gameId: string, game: GameScore): Promise<void> {
    await this.cacheService.cacheGameScore(gameId, game);
  }

  async getGame(gameId: string): Promise<GameScore | null> {
    try {
      // Try cache first
      const cached = await this.cacheService.getCachedGame(gameId);
      if (cached) {
        return cached;
      }

      // If not in cache, fetch from API
      const game = await fetchGameById(gameId);
      if (!game) {
        return null;
      }

      // Cache the result
      await this.cacheGameScore(gameId, game);
      return game;
    } catch (error) {
      logger.error(`Failed to get game ${gameId}:`, error);
      return null;
    }
  }

  async getBoxScore(gameId: string): Promise<GameBoxScore | null> {
    try {
      // Try cache first
      const cached = await this.cacheService.getCachedBoxScore(gameId);
      if (cached) {
        return cached;
      }

      // If not in cache, fetch from API
      const boxScore = await fetchNBABoxScore(gameId);
      if (!boxScore) {
        return null;
      }

      // Cache the result
      await this.cacheService.cacheBoxScore(gameId, boxScore);
      return boxScore;
    } catch (error) {
      logger.error(`Failed to get box score for game ${gameId}:`, error);
      return null;
    }
  }

  async getGames(): Promise<{ games: GameScore[], changedGameIds: string[] }> {
    try {
      const scoreboard = await fetchNBAScoreboard();
      const games = scoreboard.games as GameScore[];
      const changedGameIds: string[] = [];

      games.forEach((game: GameScore) => {
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