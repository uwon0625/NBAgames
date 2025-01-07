import { GameService } from './gameService';
import { WebSocketService } from './websocketService';
import { logger } from '../config/logger';

export class PollingService {
  private gameService: GameService;
  private wsService: WebSocketService;
  private pollInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.gameService = new GameService();
    this.wsService = new WebSocketService();
  }

  async startPolling() {
    // SCOREBOARD_TTL is in milliseconds (e.g., 120000 for 2 minutes)
    const interval = parseInt(process.env.SCOREBOARD_TTL || '120000');
    
    const poll = async () => {
      try {
        const { games, changedGameIds } = await this.gameService.getGames();
        
        // Only broadcast if there are changes
        if (changedGameIds.length > 0) {
          this.wsService.broadcastGameUpdates(games, changedGameIds);
          
          // Update Redis cache only for changed games
          for (const gameId of changedGameIds) {
            const game = games.find(g => g.gameId === gameId);
            if (game) {
              await this.gameService.cacheGameScore(gameId, game);
            }
          }
        }
      } catch (error) {
        logger.error('Polling error:', error);
      }
    };

    // Initial poll
    await poll();
    
    // Set up interval
    this.pollInterval = setInterval(poll, interval);
  }

  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
} 