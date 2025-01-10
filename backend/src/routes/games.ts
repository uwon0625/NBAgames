import express from 'express';
import { GameService } from '../services/gameService';
import { logger } from '../config/logger';
import { Monitoring } from '../config/monitoring';

const router = express.Router();
const gameService = new GameService();
const monitoring = Monitoring.getInstance();

// Get list of games
router.get('/games', async (req, res) => {
  const startTime = Date.now();
  try {
    const games = await gameService.getLiveGames();
    monitoring.trackLatency('get_games', Date.now() - startTime);
    res.json(games);
  } catch (error) {
    monitoring.trackError('get_games_failed');
    logger.error('Failed to fetch games:', error);
    res.status(500).json({ error: 'Failed to fetch games' });
  }
});

// Get specific game box score
router.get('/games/:gameId', async (req, res) => {
  const startTime = Date.now();
  try {
    const game = await gameService.getGame(req.params.gameId);
    if (!game) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }
    monitoring.trackLatency('get_game_detail', Date.now() - startTime);
    res.json(game);
  } catch (error) {
    monitoring.trackError('get_game_detail_failed');
    logger.error('Failed to fetch game:', error);
    res.status(500).json({ error: 'Failed to fetch game' });
  }
});

export default router; 