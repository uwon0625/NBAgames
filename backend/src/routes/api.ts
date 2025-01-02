import express, { Request, Response, Router } from 'express';
import { getCacheStatus } from '../services/nbaService';

const router = Router();

// Add cache status route
router.get('/cache/status', async (req: Request, res: Response) => {
  try {
    const status = await getCacheStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get cache status' });
  }
});

// Export the router
export default router; 