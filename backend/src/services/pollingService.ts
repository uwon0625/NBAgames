import { GameService } from './gameService';
import { WebSocketService } from './websocketService';
import { logger } from '../config/logger';
import { GameScore } from '../types';

export class PollingService {
  private gameService: GameService;
  private wsService: WebSocketService;
  private pollInterval: NodeJS.Timeout | null = null;
  private knownGames: Map<string, GameScore> = new Map();

  constructor() {
    this.gameService = new GameService();
    this.wsService = new WebSocketService();
  }

  async startPolling() {
    const interval = parseInt(process.env.SCOREBOARD_TTL || '120000');
    
    const poll = async () => {
      try {
        const { games, changedGameIds } = await this.gameService.getGames();
        logger.info('Polling received games:', {
          gameCount: games.length,
          gameStatuses: games.map(g => g.status),
          changedIds: changedGameIds
        });
        
        // Update known games
        games.forEach(game => {
          const oldGame = this.knownGames.get(game.gameId);
          if (oldGame) {
            logger.info(`Game ${game.gameId} status change:`, {
              old: oldGame.status,
              new: game.status
            });
          }
          this.knownGames.set(game.gameId, game);
        });
        
        // Only broadcast if there are changes
        if (changedGameIds.length > 0) {
          logger.info('Broadcasting updates for games:', changedGameIds);
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

  getGame(gameId: string): GameScore | undefined {
    return this.knownGames.get(gameId);
  }
} 