import { producer } from '../../config/kafka';
import { logger } from '../../config/logger';
import { GameScore } from '../../types';

const isDevelopment = process.env.NODE_ENV === 'development';

export class GameProducer {
  private static readonly TOPIC = 'nba.games.updates';

  static async sendGameUpdate(gameScore: GameScore): Promise<void> {
    try {
      if (isDevelopment && process.env.SKIP_KAFKA === 'true') {
        logger.info(`[DEV] Would send game update for game ${gameScore.gameId}`);
        return;
      }

      await producer.send({
        topic: this.TOPIC,
        messages: [
          {
            key: gameScore.gameId,
            value: JSON.stringify(gameScore),
            headers: {
              'event-type': 'game-update',
              timestamp: Date.now().toString(),
            },
          },
        ],
      });

      logger.info(`Game update sent for game ${gameScore.gameId}`);
    } catch (error) {
      logger.error('Error sending game update to Kafka', error);
      if (isDevelopment) {
        logger.warn('Continuing without Kafka in development mode');
        return;
      }
      throw error;
    }
  }
} 