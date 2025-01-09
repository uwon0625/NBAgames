import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Kafka, Partitioners, RetryOptions } from 'kafkajs';
import { redisClient } from '../config/redis';
import { GameScore } from '../types';
import { logger } from '../config/logger';

const dynamodb = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
  }
});

const docClient = DynamoDBDocumentClient.from(dynamodb);

// Kafka retry configuration
const retryOptions: RetryOptions = {
  initialRetryTime: 1000,
  maxRetryTime: 30000,
  retries: 10,
  factor: 1.5,
};

// Initialize Kafka producer once
const kafka = new Kafka({
  clientId: process.env.KAFKA_CLIENT_ID || 'nba-game-updates',
  brokers: ['localhost:9092'],
  retry: retryOptions
});

const producer = kafka.producer({
  createPartitioner: Partitioners.LegacyPartitioner,
  idempotent: false,
  maxInFlightRequests: 1,
  transactionTimeout: 60000,
  retry: {
    initialRetryTime: 1000,
    maxRetryTime: 30000,
    retries: 10,
    factor: 1.5
  }
});

let isProducerConnected = false;
let connectionPromise: Promise<void> | null = null;

// Function to handle producer connection with retries
async function ensureProducerConnected() {
  if (isProducerConnected) return;
  
  if (!connectionPromise) {
    connectionPromise = producer.connect()
      .then(() => {
        isProducerConnected = true;
        logger.info('Kafka producer connected successfully');
      })
      .catch(error => {
        logger.error('Failed to connect Kafka producer:', error);
        isProducerConnected = false;
      })
      .finally(() => {
        connectionPromise = null;
      });
  }

  return connectionPromise;
}

// Connect producer on startup
ensureProducerConnected();

// Add reconnection handler
producer.on('producer.disconnect', () => {
  isProducerConnected = false;
  logger.warn('Kafka producer disconnected - will attempt to reconnect');
  ensureProducerConnected();
});

export async function handleGameUpdate(gameUpdate: GameScore) {
  try {
    // Store in DynamoDB
    await docClient.send(new PutCommand({
      TableName: process.env.DYNAMODB_UPDATES_TABLE_NAME || 'nba_game_updates',
      Item: {
        gameId: gameUpdate.gameId,
        timestamp: Date.now(),
        data: gameUpdate
      }
    }));

    // Update Redis cache
    await redisClient.setex(
      `game:${gameUpdate.gameId}`,
      parseInt(process.env.REDIS_CACHE_TTL || '300'),
      JSON.stringify(gameUpdate)
    );

    try {
      // Try to ensure producer is connected
      await ensureProducerConnected();

      // Publish to Kafka if connected
      if (isProducerConnected) {
        await producer.send({
          topic: process.env.KAFKA_TOPIC || 'nba-game-updates',
          messages: [{
            key: gameUpdate.gameId,
            value: JSON.stringify({
              type: 'GAME_UPDATE',
              data: gameUpdate,
              timestamp: Date.now()
            })
          }]
        });
      } else {
        logger.warn('Kafka producer not connected - skipping message');
      }
    } catch (kafkaError) {
      logger.error('Failed to publish to Kafka:', kafkaError);
      isProducerConnected = false;
    }

    logger.info(`Game update processed for game ${gameUpdate.gameId}`);
  } catch (error) {
    logger.error('Error processing game update:', error);
    throw error;
  }
}

export async function cleanup() {
  try {
    if (isProducerConnected) {
      await producer.disconnect();
      isProducerConnected = false;
      logger.info('Kafka producer disconnected');
    }
  } catch (error) {
    logger.error('Error disconnecting Kafka producer:', error);
  }
} 