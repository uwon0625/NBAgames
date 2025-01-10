import express from 'express';
import { getGames, getGameBoxScore } from '../services/nbaService';
import { logger } from '../config/logger';
import { GameService } from '../services/gameService';
import { GameScore } from '../types';

const router = express.Router();
const gameService = new GameService();

// GET /api/games
router.get('/games', async (req, res) => {
  try {
    // Get all games from our database
    const games = await gameService.getAllGames();
    res.json(games);
  } catch (error) {
    logger.error('Failed to get games:', error);
    res.status(500).json({ error: 'Failed to get games' });
  }
});

// GET /api/games/:gameId/boxscore
router.get('/games/:gameId/boxscore', async (req, res) => {
  try {
    const { gameId } = req.params;
    
    // Get game data from Redis/DynamoDB
    const game = await gameService.getGame(gameId);
    
    if (game) {
      res.json(game);
    } else {
      res.status(404).json({ error: 'Game not found' });
    }
  } catch (error) {
    logger.error('Error fetching game data:', error);
    res.status(500).json({ error: 'Failed to fetch game data' });
  }
});

export default router; 