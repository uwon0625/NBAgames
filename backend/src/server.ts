import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketService } from './services/websocketService';
import { GameService } from './services/gameService';
import { PollingService } from './services/pollingService';
import { logger } from './config/logger';
import apiRouter from './routes/api';
import adminRouter from './routes/admin';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Create Express app
const app = express();
const server = createServer(app);

// Initialize services
try {
  // Initialize GameService singleton
  GameService.getInstance();
  logger.info('GameService initialized successfully');
  
  // Initialize WebSocket service
  const wsService = new WebSocketService();
  const pollingService = new PollingService();

  // Initialize WebSocket server
  wsService.initialize(server);

  // Add request logging middleware
  app.use((req, res, next) => {
    logger.info(`${req.method} ${req.url}`);
    next();
  });

  // Configure middleware
  app.use(cors());
  app.use(express.json());

  // Mount routes
  app.use('/api', apiRouter);
  app.use('/api/admin', adminRouter);

  // Add 404 handler
  app.use((req, res) => {
    logger.warn(`Route not found: ${req.method} ${req.url}`);
    res.status(404).json({ error: 'Route not found' });
  });

  // Add error handling middleware
  app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  });

  // Add environment check
  const isLambda = process.env.AWS_LAMBDA_FUNCTION_NAME !== undefined;
  const isLocalDev = process.env.NODE_ENV === 'development';

  if (isLocalDev) {
    logger.info('Running in development mode');
  }

  // Start the server
  const PORT = process.env.PORT || 3001;
  server.listen(PORT, async () => {
    logger.info(`Server running on port ${PORT}`);
  });

  // Start polling service if running locally but not in development mode
  if (!isLambda && !isLocalDev) {
    logger.info('Starting polling service for production local run');
    pollingService.startPolling();
  } else {
    // For development, start polling anyway to get data
    logger.info('Starting polling service in development mode');
    pollingService.startPolling();
  }

  // Handle shutdown gracefully
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received. Shutting down gracefully...');
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
  });

} catch (error) {
  logger.error('Error initializing services:', error);
  process.exit(1);
}

export default server; 