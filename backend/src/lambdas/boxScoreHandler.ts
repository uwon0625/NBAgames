import { Kafka } from 'kafkajs';
import axios from 'axios';
import { nbaApiConfig } from '../config/nbaApi';
import { logger } from '../config/logger';
import { transformNBABoxScore } from '../services/nbaService';
import { GameStatus } from '../types/enums';

const kafka = new Kafka({
  clientId: 'nba-live-boxscore-producer',
  brokers: (process.env.KAFKA_BROKERS || '').split(','),
  ssl: true,
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