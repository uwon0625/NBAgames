import { Request, Response } from 'express';
import { logger } from '../config/logger';
import { fetchLiveGames } from '../services/nbaService';
import { testGames } from '../utils/testData';

const USE_TEST_DATA = process.env.USE_TEST_DATA === 'true';

export const getGames = async (req: Request, res: Response) => {
  try {
    let games;
    if (USE_TEST_DATA) {
      games = testGames;
    } else {
      games = await fetchLiveGames();
    }
    res.json(games);
  } catch (error) {
    logger.error('Error fetching games:', error);
    res.status(500).json({ error: 'Failed to fetch games' });
  }
}; 