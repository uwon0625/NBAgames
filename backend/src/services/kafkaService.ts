import { Kafka } from 'kafkajs';

const kafka = new Kafka({
  clientId: 'nba-live-updates',
  brokers: process.env.KAFKA_BROKERS?.split(',') || []
});

const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: 'nba-updates-group' });

export const streamGameUpdates = async (gameData: any) => {
  await producer.connect();
  await producer.send({
    topic: 'nba-live-updates',
    messages: [{
      key: gameData.gameId,
      value: JSON.stringify({
        type: 'GAME_UPDATE',
        data: gameData,
        timestamp: Date.now()
      })
    }]
  });
};

// Alert types for significant events
type AlertType = 'SCORE_UPDATE' | 'GAME_START' | 'GAME_END' | 'QUARTER_END';

interface GameAlert {
  gameId: string;
  type: AlertType;
  message: string;
  timestamp: number;
} 