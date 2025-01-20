import { SQSEvent, Context } from 'aws-lambda';
import { GameService } from '../services/gameService';
import { getGameBoxScore } from '../services/nbaService';
import { logger } from '../config/logger';

export const handler = async (event: SQSEvent, context: Context): Promise<void> => {
  const gameService = new GameService();

  try {
    // Process each message from SQS
    for (const record of event.Records) {
      const message = JSON.parse(record.body);
      const gameId = message.gameId;

      logger.info(`Processing box score update for game ${gameId}`);

      try {
        // Get box score from NBA API
        const boxScore = await getGameBoxScore(gameId);
        if (boxScore) {
          // Update game record with box score data
          await gameService.updateGame(boxScore);
          logger.debug(`Updated box score for game ${gameId}`);
        } else {
          logger.warn(`No box score available for game ${gameId}`);
        }
      } catch (error) {
        logger.error(`Error processing box score for game ${gameId}:`, error);
        // Don't throw here to continue processing other messages
      }
    }
  } catch (error) {
    logger.error('Error in box score handler:', error);
    throw error;
  } finally {
    await gameService.cleanup();
  }
}; 