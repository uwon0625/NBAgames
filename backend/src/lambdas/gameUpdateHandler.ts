import { Kafka } from 'kafkajs';
import axios from 'axios';

// Simple logger for Lambda
const logger = {
  info: (message: string, ...args: any[]) => console.log(message, ...args),
  error: (message: string, ...args: any[]) => console.error(message, ...args),
  warn: (message: string, ...args: any[]) => console.warn(message, ...args),
  debug: (message: string, ...args: any[]) => {
    if (process.env.DEBUG) console.debug(message, ...args);
  }
};

const NBA_BASE_URL = process.env.NBA_BASE_URL || 'https://nba-prod-us-east-1-mediaops-stats.s3.amazonaws.com/NBA/liveData';
const NBA_API_URL = `${NBA_BASE_URL}/scoreboard/todaysScoreboard_00.json`;

// Log environment variables (excluding sensitive data)
logger.info('Environment:', {
  NBA_BASE_URL,
  KAFKA_TOPIC: process.env.KAFKA_TOPIC,
  NODE_ENV: process.env.NODE_ENV
});

const kafka = new Kafka({
  clientId: 'nba-live-producer',
  brokers: (process.env.KAFKA_BROKERS || '').split(','),
  ssl: true
});

const handler = async (event: any) => {
  try {
    logger.info('Starting game update handler');
    
    const producer = kafka.producer();
    logger.info('Connecting to Kafka...');
    await producer.connect();
    logger.info('Connected to Kafka');

    // Fetch games directly using NBA API URL
    logger.info('Fetching games from NBA API...');
    const response = await axios.get(NBA_API_URL);
    
    if (response.status !== 200) {
      throw new Error(`NBA API responded with status: ${response.status}`);
    }

    const games = response.data.scoreboard.games;
    logger.info(`Found ${games.length} games to process`);

    // Publish games to Kafka
    await Promise.all(games.map(async (game: any) => {
      try {
        await producer.send({
          topic: process.env.KAFKA_TOPIC || 'nba-game-updates',
          messages: [{
            key: game.gameId,
            value: JSON.stringify(game),
          }],
        });
        logger.info(`Published update for game ${game.gameId}`);
      } catch (error) {
        logger.error(`Failed to publish game ${game.gameId}:`, error);
        throw error;
      }
    }));

    await producer.disconnect();
    logger.info('Successfully published all games');

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Games published to Kafka' })
    };
  } catch (error: any) {
    logger.error('Error publishing games:', {
      error: error.message,
      stack: error.stack,
      details: error.toString()
    });
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Failed to publish games',
        details: error.message,
        type: error.name
      })
    };
  }
};

exports.handler = handler; 