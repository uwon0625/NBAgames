import express from 'express';
import cors from 'cors';
import apiRouter from './routes/api';
import adminRouter from './routes/admin';
import { logger } from './config/logger';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Validate required environment variables
const requiredEnvVars = [
  'AWS_REGION',
  'DYNAMODB_TABLE_NAME',
  'S3_BUCKET_NAME',
  'NBA_BASE_URL'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    logger.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

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
  res.json({ 
    message: 'NBA Games API',
    version: '1.0.0',
    env: process.env.NODE_ENV
  });
});

// Mount routes
app.use('/api', apiRouter);
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