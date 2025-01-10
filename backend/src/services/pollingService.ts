import { logger } from '../config/logger';
import { GameScore } from '../types';
import { getGames, getGameBoxScore } from './nbaService';
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
    // Rate limiting check
    const now = Date.now();
    if (now - this.lastUpdate < this.minUpdateInterval) {
      logger.debug('Skipping update due to rate limiting');
      return;
    }

    try {
      // Fetch latest games from NBA API
      const games = await getGames();
      
      // Process each game
      for (const game of games) {
        if (game.status === GameStatus.SCHEDULED) {
          // For scheduled games, just store basic game data
          await this.gameService.updateGame(game);
        } else {
          // Get box score for all non-scheduled games
          const boxScore = await getGameBoxScore(game.gameId);
          
          if (boxScore) {
            // Store complete box score data
            await this.gameService.updateGame(boxScore);

            // Also store basic game data for list view
            const gameScore: GameScore = {
              gameId: boxScore.gameId,
              status: boxScore.status,
              period: boxScore.period,
              clock: boxScore.clock,
              homeTeam: {
                teamId: boxScore.homeTeam.teamId,
                teamTricode: boxScore.homeTeam.teamTricode,
                score: boxScore.homeTeam.score,
                stats: boxScore.homeTeam.stats
              },
              awayTeam: {
                teamId: boxScore.awayTeam.teamId,
                teamTricode: boxScore.awayTeam.teamTricode,
                score: boxScore.awayTeam.score,
                stats: boxScore.awayTeam.stats
              },
              lastUpdate: boxScore.lastUpdate
            };

            await this.gameService.updateGame(gameScore);
            
            // Track live games and broadcast updates
            if (boxScore.status === GameStatus.LIVE) {
              this.liveGames.add(gameScore.gameId);
              this.wsService.broadcastGameUpdate(boxScore);
            } else if (boxScore.status === GameStatus.FINAL) {
              // If game was being tracked as live, send final update
              if (this.liveGames.has(game.gameId)) {
                this.wsService.broadcastGameUpdate(boxScore);
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