import express from 'express';
import { getGames, getGameById, getGameBoxScore } from '../services/gameService';
import { logger } from '../config/logger';

const router = express.Router();

router.get('/games', async (req, res) => {
  try {
    const games = await getGames();
    res.json(games);
  } catch (error) {
    logger.error('Failed to fetch games:', error);
    res.status(500).json({ 
      error: 'Failed to fetch games',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.get('/games/:id/box-score', async (req, res) => {
  try {
    const boxScore = await getGameBoxScore(req.params.id);
    if (!boxScore) {
      return res.status(404).json({ error: 'Box score not found' });
    }
    res.json(boxScore);
  } catch (error) {
    logger.error('Failed to fetch box score:', error);
    res.status(500).json({ 
      error: 'Failed to fetch box score',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.get('/games/:id', async (req, res) => {
  try {
    const game = await getGameById(req.params.id);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    res.json(game);
  } catch (error) {
    logger.error('Failed to fetch game:', error);
    res.status(500).json({ 
      error: 'Failed to fetch game',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router; 