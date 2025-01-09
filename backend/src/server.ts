import app from './app';
import { logger } from './config/logger';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { PollingService } from './services/pollingService';
import { WebSocketService } from './services/websocketService';
import { cleanup as cleanupKafka } from './lambdas/gameUpdateHandler';

const server = createServer(app);
const wss = new WebSocketServer({ 
  server,
  path: '/ws'
});

// Initialize services
const wsService = new WebSocketService();
const pollingService = new PollingService();

// Handle WebSocket connections
wss.on('connection', (ws) => {
  wsService.addClient(ws);
});

// Start server and polling
server.listen(process.env.PORT || 3001, () => {
  logger.info(`Server running on port ${process.env.PORT || 3001}`);
  
  // Start polling after server is ready
  pollingService.startPolling().catch(error => {
    logger.error('Failed to start polling:', error);
  });
});

// Handle server shutdown
const shutdown = async () => {
  logger.info('Shutting down server...');
  
  // Stop polling
  pollingService.stopPolling();
  
  // Cleanup WebSocket connections
  wsService.cleanup();
  
  // Cleanup Kafka
  await cleanupKafka();
  
  // Close WebSocket server
  wss.close(() => {
    logger.info('WebSocket server closed');
  });
  
  // Close HTTP server
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
};

// Handle graceful shutdown
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  shutdown().catch(() => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection:', reason);
  shutdown().catch(() => process.exit(1));
}); 