import { Kafka } from 'kafkajs';
import { logger } from './logger';

const isDevelopment = process.env.NODE_ENV === 'development';
const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');

export const kafka = new Kafka({
  clientId: 'nba-live-scores',
  brokers,
  retry: {
    initialRetryTime: 1000,
    retries: 15,
    maxRetryTime: 30000
  }
});

export const producer = kafka.producer();
export const consumer = kafka.consumer({ 
  groupId: 'nba-live-scores-group' 
});

export const connectKafka = async () => {
  if (isDevelopment && process.env.SKIP_KAFKA === 'true') {
    logger.info('Skipping Kafka connection in development mode');
    return;
  }

  const maxRetries = 5;
  let retries = 0;

  try {
    while (retries < maxRetries) {
      try {
        await producer.connect();
        await consumer.connect();
        logger.info('Successfully connected to Kafka');
        return;
      } catch (err) {
        retries++;
        logger.warn(`Failed to connect to Kafka (attempt ${retries}/${maxRetries})`);
        if (retries === maxRetries) throw err;
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds before retry
      }
    }
  } catch (error) {
    logger.error('Failed to connect to Kafka', error);
    if (isDevelopment) {
      logger.warn('Continuing without Kafka in development mode');
      return;
    }
    throw error;
  }
}; 