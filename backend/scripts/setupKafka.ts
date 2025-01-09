import { Kafka } from 'kafkajs';
import { logger } from '../src/config/logger';
import dotenv from 'dotenv';
dotenv.config();

const RETRY_OPTIONS = {
  initialRetryTime: 1000,
  maxRetryTime: 30000,
  retries: 10,
  factor: 1.5,
};

const kafka = new Kafka({
  clientId: process.env.KAFKA_CLIENT_ID || 'nba-game-updates',
  brokers: process.env.KAFKA_BROKERS?.split(',') || ['localhost:9092'],
  connectionTimeout: 10000,
  retry: RETRY_OPTIONS
});

const admin = kafka.admin();

function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    const timeoutId = setTimeout(() => {
      clearTimeout(timeoutId);
      resolve();
    }, ms);
  });
}

async function waitForKafka(maxAttempts = 10): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await admin.connect();
      logger.info('Successfully connected to Kafka');
      return true;
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }
      logger.warn(`Waiting for Kafka to be ready (attempt ${attempt}/${maxAttempts})...`);
      await delay(2000); // Fixed 2-second delay between attempts
    }
  }
  return false;
}

async function setupKafka() {
  try {
    logger.info('Starting Kafka setup...');
    
    // Wait for Kafka to be ready
    await waitForKafka();
    
    const existingTopics = await admin.listTopics();
    const topicName = process.env.KAFKA_TOPIC || 'nba-game-updates';
    
    if (existingTopics.includes(topicName)) {
      logger.info(`Topic ${topicName} already exists`);
    } else {
      // Create topics if they don't exist
      await admin.createTopics({
        topics: [{
          topic: topicName,
          numPartitions: 1,
          replicationFactor: 1
        }]
      });
      logger.info(`Topic ${topicName} created successfully`);
    }

  } catch (error: any) {
    if (error.message?.includes('Timeout')) {
      logger.error('Failed to connect to Kafka - timeout reached');
    } else {
      logger.error('Failed to setup Kafka topics:', error);
    }
    throw error;
  } finally {
    try {
      await admin.disconnect();
      logger.info('Kafka admin client disconnected');
    } catch (error) {
      logger.warn('Error disconnecting Kafka admin client:', error);
    }
  }
}

// Execute setup with a fixed timeout
const SETUP_TIMEOUT = 30000; // 30 seconds

let timeoutId: NodeJS.Timeout;
const timeoutPromise = new Promise((_, reject) => {
  timeoutId = setTimeout(() => {
    reject(new Error('Kafka setup timeout'));
  }, SETUP_TIMEOUT);
});

Promise.race([setupKafka(), timeoutPromise])
  .then(() => {
    clearTimeout(timeoutId);
    logger.info('Kafka setup completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    clearTimeout(timeoutId);
    logger.error('Kafka setup failed:', error);
    process.exit(1);
  }); 