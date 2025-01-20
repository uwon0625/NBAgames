import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { logger } from '../config/logger';
import { GameScore } from '../types';

export class SQSService {
  private sqsClient: SQSClient;
  private queueUrl: string;

  constructor() {
    this.sqsClient = new SQSClient({});
    this.queueUrl = process.env.GAME_QUEUE_URL || '';
  }

  async sendGameUpdate(game: GameScore): Promise<void> {
    try {
      const messageId = Date.now().toString();
      logger.info(`Sending game update to SQS for game ${game.gameId} (MessageId: ${messageId})`);
      
      await this.sqsClient.send(new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(game),
        MessageGroupId: `game${game.gameId}`,
        MessageDeduplicationId: messageId,
        MessageAttributes: {
          'gameId': {
            DataType: 'String',
            StringValue: game.gameId
          },
          'status': {
            DataType: 'String',
            StringValue: game.status
          },
          'period': {
            DataType: 'String',
            StringValue: game.period.toString()
          }
        }
      }));
      
      logger.info(`Successfully sent game update to SQS (MessageId: ${messageId})`);
    } catch (error) {
      logger.error('Error sending game update to SQS:', error);
      throw error;
    }
  }

  async cleanup(): Promise<void> {
    this.sqsClient.destroy();
  }
} 