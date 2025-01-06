import express from 'express';
import { getGames, getGameBoxScore } from '../services/nbaService';
import { logger } from '../config/logger';

const router = express.Router();

// GET /api/games
router.get('/', async (req, res) => {
  try {
    const games = await getGames();
    res.json(games);
  } catch (error) {
    logger.error('Failed to get games:', error);
    res.status(500).json({ error: 'Failed to get games' });
  }
});

// GET /api/games/:gameId/boxscore
router.get('/:gameId/boxscore', async (req, res) => {
  try {
    const { gameId } = req.params;
    const boxScore = await getGameBoxScore(gameId);
    
    if (!boxScore) {
      res.status(404).json({ error: 'Box score not found' });
      return;
    }
    
    res.json(boxScore);
  } catch (error) {
    logger.error(`Failed to get box score for game ${req.params.gameId}:`, error);
    res.status(500).json({ error: 'Failed to get box score' });
  }
});

export default router; 