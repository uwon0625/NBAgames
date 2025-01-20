import { logger } from '../config/logger';
import { GameService } from './gameService';
import { getTodaysGames } from './nbaService';
import { SQSService } from './sqsService';
import { GameStatus } from '../types/enums';

export class PollingService {
  private gameService: GameService;
  private sqsService: SQSService;
  private pollingInterval: NodeJS.Timeout | null;

  constructor() {
    this.gameService = new GameService();
    this.sqsService = new SQSService();
    this.pollingInterval = null;
  }

  async startPolling(): Promise<void> {
    logger.info('Starting game polling service');
    
    // Initial poll
    await this.pollGames();

    // Set up regular polling
    this.pollingInterval = setInterval(async () => {
      await this.pollGames();
    }, this.getPollingInterval());
  }

  private async pollGames(): Promise<void> {
    try {
      const games = await getTodaysGames();
      
      for (const game of games) {
        const existingGame = await this.gameService.getGame(game.gameId);
        
        // Check for important events that need immediate processing
        if (this.isImportantUpdate(game, existingGame)) {
          await this.sqsService.sendGameUpdate(game);
          logger.info(`Queued important update for game ${game.gameId}`);
        }
        
        // Always update the game in database
        await this.gameService.updateGame(game);
      }
    } catch (error) {
      logger.error('Error polling games:', error);
    }
  }

  private isImportantUpdate(currentGame: any, previousGame: any): boolean {
    if (!previousGame) return true;
    
    return (
      // Quarter end
      currentGame.period !== previousGame.period ||
      // Game status change
      currentGame.status !== previousGame.status ||
      // Final score
      currentGame.status === GameStatus.FINAL
    );
  }

  private getPollingInterval(): number {
    // More frequent polling during game times
    const hour = new Date().getHours();
    return (hour >= 17 && hour <= 23) ? 30000 : 60000; // 30s during games, 1m otherwise
  }

  async stopPolling(): Promise<void> {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    
    await Promise.all([
      this.gameService.cleanup(),
      this.sqsService.cleanup()
    ]);
    
    logger.info('Stopped game polling service');
  }
} 