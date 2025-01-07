import { redisClient } from '../config/redis';
import { GameScore, GameBoxScore } from '../types';
import { logger } from '../config/logger';

const GAME_CACHE_TTL = 60; // 1 minute for live games
const BOXSCORE_CACHE_TTL = 300; // 5 minutes for box scores

export class CacheService {
  async cacheGameScore(gameId: string, gameData: GameScore): Promise<void> {
    try {
      const key = `game:${gameId}`;
      await redisClient.setex(key, GAME_CACHE_TTL, JSON.stringify(gameData));
    } catch (error) {
      logger.error('Failed to cache game score:', error);
    }
  }

  async cacheBoxScore(gameId: string, boxScore: GameBoxScore): Promise<void> {
    try {
      const key = `boxscore:${gameId}`;
      await redisClient.setex(key, BOXSCORE_CACHE_TTL, JSON.stringify(boxScore));
    } catch (error) {
      logger.error('Failed to cache box score:', error);
    }
  }

  async getCachedGame(gameId: string): Promise<GameScore | null> {
    try {
      const key = `game:${gameId}`;
      const cached = await redisClient.get(key);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      logger.error('Failed to get cached game:', error);
      return null;
    }
  }

  async getCachedBoxScore(gameId: string): Promise<GameBoxScore | null> {
    try {
      const key = `boxscore:${gameId}`;
      const cached = await redisClient.get(key);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      logger.error('Failed to get cached box score:', error);
      return null;
    }
  }

  async invalidateGameCache(gameId: string): Promise<void> {
    try {
      const keys = [`game:${gameId}`, `boxscore:${gameId}`];
      await redisClient.del(...keys);
    } catch (error) {
      logger.error('Failed to invalidate game cache:', error);
    }
  }
} 