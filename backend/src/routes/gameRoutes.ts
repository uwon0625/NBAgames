import express from 'express';
import { fetchNBAScoreboard, fetchGameById, fetchNBABoxScore } from '../services/nbaService';
import { logger } from '../config/logger';

const router = express.Router();

// GET /api/games
router.get('/', async (req, res) => {
  try {
    const scoreboard = await fetchNBAScoreboard();
    res.json(scoreboard.games);
  } catch (error) {
    logger.error('Failed to get games:', error);
    res.status(500).json({ error: 'Failed to get games' });
  }
});

// GET /api/games/:gameId/boxscore
router.get('/:gameId/boxscore', async (req, res) => {
  try {
    const { gameId } = req.params;
    const boxScore = await fetchNBABoxScore(gameId);
    
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

// GET /api/games/:gameId
router.get('/:gameId', async (req, res) => {
  try {
    const { gameId } = req.params;
    const game = await fetchGameById(gameId);
    
    if (!game) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }
    
    res.json(game);
  } catch (error) {
    logger.error(`Failed to get game ${req.params.gameId}:`, error);
    res.status(500).json({ error: 'Failed to get game' });
  }
});

export default router; 