import { Kafka } from 'kafkajs';
import axios from 'axios';
import { nbaApiConfig } from '../config/nbaApi';
import { logger } from '../config/logger';
import { transformNBABoxScore } from '../services/nbaService';
import { GameStatus } from '../types/enums';

// Log environment variables (excluding sensitive data)
logger.info('Environment:', {
  NBA_BASE_URL: process.env.NBA_BASE_URL,
  KAFKA_TOPIC: process.env.KAFKA_TOPIC,
  NODE_ENV: process.env.NODE_ENV
});

// Check USE_LOCAL_SERVICES and USE_MSK before connecting to Kafka
const useLocalServices = process.env.USE_LOCAL_SERVICES === 'true';
const useMsk = process.env.USE_MSK === 'true';

// Use these variables to determine which Kafka brokers to connect to
const kafkaBrokers = process.env.KAFKA_BROKERS?.split(',') || [];
if (!kafkaBrokers.length) {
  throw new Error('KAFKA_BROKERS environment variable is required');
}

// Add logging to debug connection issues
logger.info(`Connecting to Kafka with settings:
  USE_LOCAL_SERVICES: ${useLocalServices}
  USE_MSK: ${useMsk}
  KAFKA_BROKERS: ${kafkaBrokers.join(',')}
`);

const kafka = new Kafka({
  clientId: 'nba-live-consumer',
  brokers: kafkaBrokers,
  ssl: true
});

interface BoxScoreEvent {
  gameId: string;
}

export async function handler(event: BoxScoreEvent) {
  try {
    const producer = kafka.producer();
    await producer.connect();

    // Fetch box score using the shared NBA API config
    const response = await axios.get(`${nbaApiConfig.baseUrl}/boxscore/boxscore_${event.gameId}.json`);
    
    if (response.status !== 200) {
      throw new Error(`NBA API responded with status: ${response.status}`);
    }

    const boxScore = transformNBABoxScore(response.data.game);

    // Only publish if game is LIVE
    if (boxScore.status === GameStatus.LIVE) {
      await producer.send({
        topic: process.env.KAFKA_BOXSCORE_TOPIC || 'nba-boxscore-updates',
        messages: [{
          key: boxScore.gameId,
          value: JSON.stringify(boxScore),
        }],
      });
      logger.info(`Published box score update for game ${boxScore.gameId}`);
    }

    await producer.disconnect();

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        message: 'Box score processed',
        gameId: event.gameId,
        status: boxScore.status
      })
    };
  } catch (error) {
    logger.error('Error processing box score:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Failed to process box score',
        gameId: event.gameId
      })
    };
  }
} 