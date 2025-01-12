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

// Initialize services
const gameService = new GameService();
const wsService = new WebSocketService();
const pollingService = new PollingService(gameService, wsService);

// Create Express app
const app = express();
const server = createServer(app);

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

// Add environment check at the top
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
// In AWS, updates come from Lambda functions instead
if (!isLambda && !isLocalDev) {
  logger.info('Starting polling service for production local run');
  const gameService = new GameService();
  const pollingService = new PollingService(gameService, wsService);
  pollingService.startPolling();
} else {
  logger.info(isLambda ? 
    'Running in Lambda - no polling needed' : 
    'Running in development mode - no polling started');
}

// Handle shutdown gracefully
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

export default server; 