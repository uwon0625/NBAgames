import express, { Request, Response, Router, RequestHandler } from 'express';
import { getGames, getGameBoxScore, getCacheStatus, fetchGameById } from '../services/nbaService';
import { logger } from '../config/logger';
import { GameScore } from '../types';

const router: Router = express.Router();

// Define parameter types
type BoxScoreParams = {
  gameId: string;
};

// GET /api/games
const getAllGames: RequestHandler = async (_req, res) => {
  try {
    const games = await getGames();
    res.json(games);
  } catch (error) {
    logger.error('Failed to get games:', error);
    res.status(500).json({ error: 'Failed to get games' });
  }
};

// GET /api/games/cache
const getCacheHandler: RequestHandler = async (_req, res) => {
  try {
    const status = await getCacheStatus();
    res.json(status);
  } catch (error) {
    logger.error('Failed to get cache status:', error);
    res.status(500).json({ error: 'Failed to get cache status' });
  }
};

// GET /api/games/:gameId/boxscore
const getBoxScore: RequestHandler<BoxScoreParams> = async (req, res) => {
  try {
    const { gameId } = req.params;
    const parentStatus = req.headers['x-parent-game-status'] as string;
    const parentClock = req.headers['x-parent-game-clock'] as string;
    
    const parentGame = {
      status: parentStatus,
      clock: parentClock
    } as GameScore;
    
    const boxScore = await getGameBoxScore(gameId, parentGame);
    
    if (!boxScore) {
      res.status(404).json({ error: 'Box score not found' });
      return;
    }
    
    res.json(boxScore);
  } catch (error) {
    logger.error(`Failed to get box score for game ${req.params.gameId}:`, error);
    res.status(500).json({ error: 'Failed to get box score' });
  }
};

// Register routes
router.get('/', getAllGames);
router.get('/cache', getCacheHandler);
router.get('/:gameId/boxscore', getBoxScore);

export default router; 