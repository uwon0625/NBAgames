import { SQSEvent } from 'aws-lambda';
import { GameService } from '../services/gameService';
import { getTodaysGames } from '../services/nbaService';
import { SQSService } from '../services/sqsService';
import { logger } from '../config/logger';
import { GameStatus } from '../types/enums';
import { GameScore } from '../types';

export const handler = async (event: SQSEvent): Promise<void> => {
  const gameService = GameService.getInstance();
  const sqsService = new SQSService();

  try {
    // Get today's games from NBA API
    const games = await getTodaysGames();
    
    // Process each game
    for (const game of games) {
      // Update basic game info in database
      await gameService.updateGame(game);
      
      // For live games or important updates, send to SQS
      if (game.status === GameStatus.LIVE || 
          game.status === GameStatus.FINAL || 
          game.period > 0) {  // Include quarter changes
        await sqsService.sendGameUpdate(game);
        logger.debug(`Sent game update to SQS for game ${game.gameId} (Period: ${game.period})`);
      }
    }

    logger.info(`Successfully processed ${games.length} games`);
  } catch (error) {
    logger.error('Error in game update handler:', error);
    throw error;
  } finally {
    await sqsService.cleanup();
  }
};

export const sqsHandler = async (event: SQSEvent): Promise<void> => {
  const gameService = GameService.getInstance();  // Initialize gameService
  
  try {
    for (const record of event.Records) {
      const gameUpdate = JSON.parse(record.body) as GameScore;
      await gameService.updateGame(gameUpdate);
      logger.info(`Updated game ${gameUpdate.gameId}`);
    }
  } catch (error) {
    logger.error('Error in game update handler:', error);
    throw error;  // Let Lambda retry the batch
  }
}; 