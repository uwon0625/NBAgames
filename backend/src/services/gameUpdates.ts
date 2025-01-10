import { getGames } from './nbaService';
import { GameService } from './gameService';
import { logger } from '../config/logger';
import { GameScore } from '../types';

export class GameUpdatesService {
  private gameService: GameService;
  private updateCallbacks: ((games: GameScore[]) => void)[] = [];
  private pollingInterval: NodeJS.Timeout | null = null;
  private isPolling = false;

  constructor() {
    this.gameService = new GameService();
  }

  async pollForUpdates(intervalMs: number = 10000) {
    if (this.isPolling) {
      logger.warn('Already polling for updates');
      return;
    }

    this.isPolling = true;
    logger.info('Starting game updates polling');

    const poll = async () => {
      try {
        const games = await getGames();
        this.notifySubscribers(games);
      } catch (error) {
        logger.error('Error polling for game updates:', error);
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
      logger.info('Stopped game updates polling');
    }
  }

  subscribe(callback: (games: GameScore[]) => void) {
    this.updateCallbacks.push(callback);
    return () => {
      this.updateCallbacks = this.updateCallbacks.filter(cb => cb !== callback);
    };
  }

  private notifySubscribers(games: GameScore[]) {
    this.updateCallbacks.forEach(callback => {
      try {
        callback(games);
      } catch (error) {
        logger.error('Error in game update callback:', error);
      }
    });
  }

  async cleanup() {
    this.stopPolling();
    await this.gameService.cleanup();
  }
} 