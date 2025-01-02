import { consumer } from '../../config/kafka';
import { logger } from '../../config/logger';
import { GameScore } from '../../types';
import { eventBridge } from '../../config/aws';
import { PutEventsCommand } from '@aws-sdk/client-eventbridge';

export class GameConsumer {
  private static readonly TOPIC = 'nba.games.updates';

  static async startConsumer(): Promise<void> {
    try {
      await consumer.subscribe({ topic: this.TOPIC, fromBeginning: false });

      await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
          try {
            if (!message.value) return;

            const gameScore: GameScore = JSON.parse(message.value.toString());
            
            // Forward the message to EventBridge
            await eventBridge.send(new PutEventsCommand({
              Entries: [{
                EventBusName: 'nba-live-events',
                Source: 'nba-live.games',
                DetailType: 'game-update',
                Detail: JSON.stringify(gameScore),
              }],
            }));

            logger.info(`Processed game update for game ${gameScore.gameId}`);
          } catch (error) {
            logger.error('Error processing Kafka message', error);
          }
        },
      });

      logger.info('Game consumer started successfully');
    } catch (error) {
      logger.error('Error starting game consumer', error);
      throw error;
    }
  }
} 