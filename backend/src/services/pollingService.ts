import { GameService } from './gameService';
import { WebSocketService } from './websocketService';
import { handleGameUpdate } from '../lambdas/gameUpdateHandler';
import { logger } from '../config/logger';

export class PollingService {
  private gameService: GameService;
  private wsService: WebSocketService;
  private pollTimeout: NodeJS.Timeout | null = null;
  private isPolling: boolean = false;

  constructor() {
    this.gameService = new GameService();
    this.wsService = new WebSocketService();
  }

  private async doPoll() {
    try {
      const { games, changedGameIds } = await this.gameService.getGames();
      
      if (changedGameIds.length > 0) {
        // Process updates through lambda handler
        await Promise.all(
          games
            .filter(game => changedGameIds.includes(game.gameId))
            .map(handleGameUpdate)
        );

        // Broadcast to WebSocket clients
        this.wsService.broadcastGameUpdates(games, changedGameIds);
      }
    } catch (error) {
      logger.error('Polling error:', error);
    }
  }

  private scheduleNextPoll() {
    if (!this.isPolling) return;

    const interval = parseInt(process.env.SCOREBOARD_TTL || '120000');
    this.pollTimeout = setTimeout(async () => {
      await this.doPoll();
      this.scheduleNextPoll();
    }, interval);
  }

  async startPolling() {
    if (this.isPolling) return;
    
    this.isPolling = true;
    logger.info('Starting polling service...');
    
    // Do initial poll
    await this.doPoll();
    
    // Schedule next poll
    this.scheduleNextPoll();
  }

  stopPolling() {
    logger.info('Stopping polling service...');
    this.isPolling = false;
    
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
  }
} 