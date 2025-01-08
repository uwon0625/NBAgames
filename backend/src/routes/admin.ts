import express from 'express';
import { redisClient } from '../config/redis';
import { logger } from '../config/logger';

const router = express.Router();

// POST /api/admin/flush-cache
router.post('/flush-cache', async (req, res) => {
  try {
    logger.info('Starting cache flush...');
    
    // Clear Redis
    await redisClient.flushdb();
    logger.info('Redis cache cleared');

    res.json({ message: 'Cache flushed successfully' });
  } catch (error) {
    logger.error('Failed to flush cache:', error);
    res.status(500).json({ error: 'Failed to flush cache' });
  }
});

export default router; 