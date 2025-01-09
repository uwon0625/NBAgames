import { redisClient } from '../config/redis';
import { GameScore, GameBoxScore } from '../types';

const GAME_CACHE_TTL = 60; // 1 minute for live games
const BOXSCORE_CACHE_TTL = 300; // 5 minutes for box scores

export class CacheService {
  // Cache live game scores
  async cacheGameScore(gameId: string, gameData: GameScore): Promise<void> {
    const key = `game:${gameId}`;
    await redisClient.setex(
      key,
      parseInt(process.env.REDIS_CACHE_TTL || '300'),
      JSON.stringify(gameData)
    );
  }

  // Cache box scores
  async cacheBoxScore(gameId: string, boxScore: GameBoxScore): Promise<void> {
    const key = `boxscore:${gameId}`;
    await redisClient.setex(
      key,
      BOXSCORE_CACHE_TTL,
      JSON.stringify(boxScore)
    );
  }

  // Get cached game data
  async getCachedGame(gameId: string): Promise<GameScore | null> {
    const key = `game:${gameId}`;
    const cached = await redisClient.get(key);
    return cached ? JSON.parse(cached) : null;
  }

  // Invalidate cache on significant updates
  async invalidateGameCache(gameId: string): Promise<void> {
    const keys = [
      `game:${gameId}`,
      `boxscore:${gameId}`
    ];
    await redisClient.del(...keys);
  }

  // Get cached box score data
  async getCachedBoxScore(gameId: string): Promise<GameBoxScore | null> {
    const key = `boxscore:${gameId}`;
    const cached = await redisClient.get(key);
    return cached ? JSON.parse(cached) : null;
  }
} 