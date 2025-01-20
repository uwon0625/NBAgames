import { GameService } from './gameService';
import { logger } from '../config/logger';
import { getTodaysGames, getGameBoxScore } from './nbaService';
import { GameStatus } from '../types/enums';

export class PollingService {
  private gameService: GameService;
  private pollingInterval: NodeJS.Timeout | null = null;
  private readonly POLL_INTERVAL = 30000; // 30 seconds

  constructor() {
    // Use getInstance instead of new GameService()
    this.gameService = GameService.getInstance();
  }

  public startPolling(): void {
    logger.info('Starting polling service');
    this.pollGames(); // Initial poll
    this.pollingInterval = setInterval(() => this.pollGames(), this.POLL_INTERVAL);
  }

  public stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      logger.info('Polling service stopped');
    }
  }

  private async pollGames(): Promise<void> {
    try {
      logger.debug('Starting game poll');
      const games = await getTodaysGames();
      logger.debug(`Found ${games.length} games to process`);
      
      for (const game of games) {
        logger.debug(`Processing game ${game.gameId}`);
        
        // Update basic game info first
        await this.gameService.updateGame(game);
        
        // Fetch box score for live and recently finished games
        if (game.status === GameStatus.LIVE || 
            (game.status === GameStatus.FINAL && game.lastUpdate > Date.now() - 5 * 60 * 1000)) { // 5 minutes
          logger.debug(`Fetching box score for game ${game.gameId} (${game.status})`);
          const boxScore = await getGameBoxScore(game.gameId);
          
          if (boxScore) {
            await this.gameService.updateGame(boxScore);
            logger.debug(`Updated box score for game ${game.gameId}`);
          } else {
            logger.warn(`Failed to fetch box score for game ${game.gameId}`);
          }
        }
      }

      logger.debug(`Completed polling ${games.length} games`);
    } catch (error) {
      logger.error('Error polling games:', error);
    }
  }
} 