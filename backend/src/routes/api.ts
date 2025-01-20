import express, { Request, Response, Router, RequestHandler } from 'express';
import { GameService } from '../services/gameService';
import { logger } from '../config/logger';
import { GameScore, GameBoxScore } from '../types';
import { getTodaysGames } from '../services/nbaService';

const router: Router = express.Router();

// Define route parameter interfaces
interface GameParams {
  gameId: string;
}

// Define response types
type GameResponse = GameScore[];
type GameBoxScoreResponse = GameBoxScore | { error: string };

// Define route handlers
const getGames: RequestHandler<{}, GameResponse> = async (_req, res) => {
  try {
    const gameService = GameService.getInstance();
    // Use getTodaysGames to get fresh data from NBA API
    const games = await gameService.getTodaysGames();
    res.json(games || []);
  } catch (error) {
    logger.error('Error fetching games:', error);
    res.json([]);
  }
};

const getGameBoxScore: RequestHandler<GameParams, GameBoxScoreResponse> = async (req, res) => {
  const gameId = req.params.gameId;
  logger.debug(`Box score request for game ${gameId}`);
  
  try {
    const gameService = GameService.getInstance();
    const game = await gameService.getGame(gameId);
    
    if (!game) {
      logger.debug(`Game ${gameId} not found`);
      res.status(404).json({ error: 'Game not found' });
      return;
    }

    logger.debug(`Returning box score for game ${gameId}`);
    res.json(game);
  } catch (error) {
    logger.error(`Error fetching game ${gameId}:`, error);
    res.status(500).json({ error: 'Error fetching game' });
  }
};

// Mount routes
router.get('/games', getGames);
router.get('/games/:gameId/boxscore', getGameBoxScore);

// Add development-only route to trigger game updates
if (process.env.NODE_ENV === 'development') {
  router.post('/admin/update-games', async (_req, res) => {
    try {
      const games = await getTodaysGames();
      const gameService = GameService.getInstance();
      
      for (const game of games) {
        await gameService.updateGame(game);
      }
      
      res.json({ message: `Updated ${games.length} games` });
    } catch (error) {
      logger.error('Error updating games:', error);
      res.status(500).json({ error: 'Failed to update games' });
    }
  });
}

export default router; 