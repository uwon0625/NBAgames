import { Kafka } from 'kafkajs';
import axios from 'axios';
import { nbaApiConfig } from '../config/nbaApi';
import { logger } from '../config/logger';
import { transformNBAGames } from '../services/nbaService';

const kafka = new Kafka({
  clientId: 'nba-live-producer',
  brokers: (process.env.KAFKA_BROKERS || '').split(','),
  ssl: true,
});

export async function handler(event: any) {
  try {
    const producer = kafka.producer();
    await producer.connect();

    // Fetch games using the shared NBA API config
    const response = await axios.get(nbaApiConfig.scoreboardUrl);
    
    if (response.status !== 200) {
      throw new Error(`NBA API responded with status: ${response.status}`);
    }

    const games = transformNBAGames(response.data.scoreboard.games);

    // Publish games to Kafka
    await Promise.all(games.map(async (game) => {
      await producer.send({
        topic: process.env.KAFKA_TOPIC || 'nba-game-updates',
        messages: [{
          key: game.gameId,
          value: JSON.stringify(game),
        }],
      });
      logger.info(`Published update for game ${game.gameId}`);
    }));

    await producer.disconnect();

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Games published to Kafka' })
    };
  } catch (error) {
    logger.error('Error publishing games:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to publish games' })
    };
  }
} 