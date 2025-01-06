import express from 'express';
import cors from 'cors';
import gameRoutes from './routes/gameRoutes';
import { logger } from './config/logger';
import adminRouter from './routes/admin';

const app = express();

// Add request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url}`);
  next();
});

app.use(cors());
app.use(express.json());

// Add root route for testing
app.get('/', (req, res) => {
  res.json({ message: 'NBA Games API' });
});

// Mount routes with /api prefix
app.use('/api/games', gameRoutes);
app.use('/api/admin', adminRouter);

// Add 404 handler
app.use((req, res) => {
  logger.warn(`Route not found: ${req.method} ${req.url}`);
  res.status(404).json({ error: 'Route not found' });
});

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

export default app; 