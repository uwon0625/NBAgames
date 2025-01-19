import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { Handler } from 'aws-lambda';
import axios from 'axios';
import { Kafka, Partitioners } from 'kafkajs';

// Define interface for NBA game data
interface NBAGame {
  gameId: string;
  gameStatus: number;
  gameStatusText: string;
  period: number;
  gameClock: string;
  homeTeam: {
    teamId: string;
    score: number;
    [key: string]: any;
  };
  awayTeam: {
    teamId: string;
    score: number;
    [key: string]: any;
  };
  [key: string]: any;
}

// Configuration flags
const USE_MSK = process.env.USE_MSK === 'true';
const USE_SQS = process.env.USE_SQS === 'true';

// Log all environment variables first
console.info('Environment variables:', {
  USE_MSK: process.env.USE_MSK,
  USE_SQS: process.env.USE_SQS,
  KAFKA_BROKERS: process.env.KAFKA_BROKERS,
  DEBUG_RAW_MSK: process.env.DEBUG_RAW_MSK,
  SQS_QUEUE_URL: process.env.SQS_QUEUE_URL,
  NODE_ENV: process.env.NODE_ENV
});

// Parse Kafka brokers
const parsedBrokers = (() => {
  try {
    console.info('Raw KAFKA_BROKERS env:', typeof process.env.KAFKA_BROKERS, process.env.KAFKA_BROKERS);
    
    if (!process.env.KAFKA_BROKERS) {
      console.info('No KAFKA_BROKERS environment variable found');
      return [];
    }

    // Try parsing as JSON first
    try {
      const brokers = JSON.parse(process.env.KAFKA_BROKERS);
      console.info('Parsed KAFKA_BROKERS as JSON:', brokers);
      return brokers;
    } catch (e) {
      // If not JSON, try splitting by comma
      const brokers = process.env.KAFKA_BROKERS.split(',');
      console.info('Split KAFKA_BROKERS by comma:', brokers);
      return brokers;
    }
  } catch (error) {
    console.error('Failed to process KAFKA_BROKERS:', error);
    return [];
  }
})();

// Initialize clients
const sqs = new SQSClient({ region: process.env.AWS_REGION });
const NBA_BASE_URL = process.env.NBA_BASE_URL || 'https://nba-prod-us-east-1-mediaops-stats.s3.amazonaws.com/NBA/liveData';
const NBA_API_URL = `${NBA_BASE_URL}/scoreboard/todaysScoreboard_00.json`;

// Initialize Kafka if enabled
const kafka = USE_MSK && parsedBrokers.length > 0 ? new Kafka({
  clientId: 'nba-game-updates',
  brokers: parsedBrokers,
  retry: {
    initialRetryTime: 100,
    retries: 3
  }
}) : null;

const handler: Handler = async (event, context) => {
  console.info('Starting game update handler');
  
  try {
    // Fetch games from NBA API
    const response = await axios.get(NBA_API_URL);
    const games = response.data.scoreboard.games as NBAGame[];
    
    // Try Kafka first if enabled
    if (USE_MSK && kafka && parsedBrokers.length > 0) {
      const producer = kafka.producer({
        createPartitioner: Partitioners.LegacyPartitioner
      });

      try {
        console.info('Attempting Kafka connection with configuration:', {
          brokers: parsedBrokers,
          producer,
          topic: 'nba-game-updates'
        });
        
        console.info('Connecting to Kafka...');
        await producer.connect();
        console.info('Successfully connected to Kafka');

        await producer.send({
          topic: 'nba-game-updates',
          messages: games.map((game: NBAGame) => ({
            key: game.gameId,
            value: JSON.stringify(game)
          }))
        });
        console.info('Successfully published games to Kafka');
      } catch (kafkaError) {
        console.error('Failed to publish to Kafka:', kafkaError);
        if (!USE_SQS) throw kafkaError;
      } finally {
        try {
          await producer?.disconnect();
        } catch (error) {
          console.error('Error disconnecting from Kafka:', error);
        }
      }
    }

    // Use SQS if enabled or as fallback
    if (USE_SQS) {
      console.info('Publishing to SQS...', {
        queueUrl: process.env.SQS_QUEUE_URL,
        gameCount: games.length
      });
      
      try {
        await Promise.all(games.map(async (game: NBAGame) => {
          const messageParams = {
            QueueUrl: process.env.SQS_QUEUE_URL,
            MessageBody: JSON.stringify(game),
            MessageGroupId: game.gameId,
            MessageDeduplicationId: `${game.gameId}-${Date.now()}`,
          };
          console.debug('Sending SQS message:', messageParams);
          
          const result = await sqs.send(new SendMessageCommand(messageParams));
          console.info('SQS message sent successfully:', {
            gameId: game.gameId,
            messageId: result.MessageId
          });
        }));
        console.info('Successfully published all games to SQS');
      } catch (error) {
        console.error('Error publishing to SQS:', error);
        throw error;  // Re-throw to trigger Lambda retry
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Games processed successfully' })
    };
  } catch (error) {
    console.error('Error processing game updates:', error);
    throw error;
  }
};

export { handler }; 