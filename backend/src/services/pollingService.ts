import { logger } from '../config/logger';
import { GameScore } from '../types';
import { getTodaysGames, getGameBoxScore } from './nbaService';
import { GameService } from './gameService';
import { WebSocketService } from './websocketService';
import { GameStatus } from '../types/enums';

export class PollingService {
  private gameService: GameService;
  private wsService: WebSocketService;
  private pollingInterval: NodeJS.Timeout | null = null;
  private isPolling = false;
  private lastUpdate = 0;
  private readonly minUpdateInterval = 30000; // 30 seconds minimum between updates
  private liveGames: Set<string> = new Set(); // Track live game IDs

  constructor(gameService: GameService, wsService: WebSocketService) {
    this.gameService = gameService;
    this.wsService = wsService;
  }

  async startPolling(intervalMs: number = 60000) {
    if (this.isPolling) {
      logger.warn('Polling service is already running');
      return;
    }

    this.isPolling = true;
    logger.info('Starting game polling service');

    const poll = async () => {
      try {
        await this.fetchAndUpdateGames();
      } catch (error) {
        logger.error('Error in polling cycle:', error);
      }
    };

    // Initial poll
    await poll();

    // Set up interval polling
    this.pollingInterval = setInterval(poll, intervalMs);
  }

  stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      this.isPolling = false;
      logger.info('Stopped game polling service');
    }
  }

  private async fetchAndUpdateGames() {
    try {
      const now = Date.now();
      if (now - this.lastUpdate < this.minUpdateInterval) {
        logger.debug('Skipping update - too soon since last update');
        return;
      }

      const games = await getTodaysGames();
      logger.info(`Fetched ${games.length} games, processing updates`);

      // Process each game
      for (const game of games) {
        if (game.status === GameStatus.SCHEDULED) {
          // For scheduled games, just store basic game data
          await this.gameService.updateGame(game);
        } else {
          // For live/final games, get box score for stats
          const boxScore = await getGameBoxScore(game.gameId);
          
          if (boxScore) {
            // Store complete box score data
            await this.gameService.updateGame(boxScore);

            // Create game score with stats from box score
            const gameScore: GameScore = {
              gameId: game.gameId,
              status: game.status,
              period: game.period,
              clock: game.clock,
              homeTeam: {
                teamId: game.homeTeam.teamId,
                teamTricode: game.homeTeam.teamTricode,
                score: game.homeTeam.score,
                stats: boxScore.homeTeam.stats  // Use stats from box score
              },
              awayTeam: {
                teamId: game.awayTeam.teamId,
                teamTricode: game.awayTeam.teamTricode,
                score: game.awayTeam.score,
                stats: boxScore.awayTeam.stats  // Use stats from box score
              },
              lastUpdate: now
            };

            await this.gameService.updateGame(gameScore);
            
            if (game.status === GameStatus.LIVE) {
              this.liveGames.add(game.gameId);
              this.wsService.broadcastGameUpdate(gameScore);
            } else if (game.status === GameStatus.FINAL) {
              if (this.liveGames.has(game.gameId)) {
                this.wsService.broadcastGameUpdate(gameScore);
                this.liveGames.delete(game.gameId);
                logger.info(`Game ${game.gameId} finished, removing from live games`);
              }
            }
          }
        }
      }

      this.lastUpdate = now;
      logger.info(`Updated ${games.length} games, ${this.liveGames.size} live`);
    } catch (error) {
      logger.error('Error fetching and updating games:', error);
      throw error;
    }
  }

  async cleanup() {
    this.stopPolling();
    await this.gameService.cleanup();
  }
} 