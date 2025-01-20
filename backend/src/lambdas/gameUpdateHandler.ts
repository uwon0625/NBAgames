import { Context } from 'aws-lambda';
import { GameService } from '../services/gameService';
import { getTodaysGames } from '../services/nbaService';
import { SQSService } from '../services/sqsService';
import { logger } from '../config/logger';
import { GameStatus } from '../types/enums';

export const handler = async (event: any, context: Context): Promise<void> => {
  const gameService = new GameService();
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
    await gameService.cleanup();
    await sqsService.cleanup();
  }
}; 