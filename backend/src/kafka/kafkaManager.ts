import { connectKafka, producer, consumer } from '../config/kafka';
import { GameConsumer } from './consumers/gameConsumer';
import { logger } from '../config/logger';

export class KafkaManager {
  static async start(): Promise<void> {
    try {
      await connectKafka();
      await GameConsumer.startConsumer();
      logger.info('Kafka manager started successfully');
    } catch (error) {
      logger.error('Failed to start Kafka manager', error);
      throw error;
    }
  }

  static async shutdown(): Promise<void> {
    try {
      await producer.disconnect();
      await consumer.disconnect();
      logger.info('Kafka manager shut down successfully');
    } catch (error) {
      logger.error('Error shutting down Kafka manager', error);
      throw error;
    }
  }
} 