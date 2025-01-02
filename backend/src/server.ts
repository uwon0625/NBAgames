import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { logger } from './config/logger';
import gameRoutes from './routes/gameRoutes';
import { ExtendedWebSocket, ExtendedWebSocketServer } from './types/websocket';
import { clients } from './services/websocketService';

const app = express();
const server = createServer(app);
const port = process.env.PORT || 3001;

// Enable CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: false
}));

app.use(express.json());

// Create WebSocket server
const wss = new WebSocketServer({ 
  noServer: true,
  perMessageDeflate: false,
  clientTracking: true
}) as ExtendedWebSocketServer;

// Handle WebSocket upgrade
server.on('upgrade', (request, socket, head) => {
  try {
    wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
      const extWs = ws as ExtendedWebSocket;
      extWs.isAlive = true;
      wss.emit('connection', extWs, request);
    });
  } catch (error) {
    logger.error('WebSocket upgrade failed:', error);
    socket.destroy();
  }
});

// WebSocket connection handling
wss.on('connection', (ws: ExtendedWebSocket, request: IncomingMessage) => {
  logger.info('Client connected');
  
  ws.isAlive = true;
  clients.add(ws);

  // Send initial connection acknowledgment
  try {
    ws.send(JSON.stringify({ 
      type: 'connection-ack',
      timestamp: Date.now()
    }));
  } catch (error) {
    logger.error('Failed to send connection acknowledgment:', error);
  }

  // Handle ping/pong for connection keep-alive
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('ping', () => {
    ws.pong();
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      if (message.type === 'ping') {
        ws.send(JSON.stringify({ 
          type: 'pong', 
          timestamp: Date.now() 
        }));
      }
    } catch (error) {
      logger.error('Failed to parse WebSocket message:', error);
    }
  });

  ws.on('close', () => {
    logger.info('Client disconnected');
    clients.delete(ws);
    ws.isAlive = false;
  });

  ws.on('error', (error) => {
    logger.error('WebSocket error:', error);
    clients.delete(ws);
    ws.isAlive = false;
  });
});

// Keep connections alive
const interval = setInterval(() => {
  wss.clients.forEach((ws: ExtendedWebSocket) => {
    if (!ws.isAlive) {
      return ws.terminate();
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch (error) {
      ws.terminate();
    }
  });
}, 10000);

// Clean up on server close
server.on('close', () => {
  clearInterval(interval);
  wss.close();
});

// Routes
app.use('/api', gameRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    connections: wss.clients.size,
    timestamp: Date.now()
  });
});

// Start server
server.listen(port, () => {
  logger.info(`Server running on port ${port}`);
});

// Export for testing
export { app, server, wss }; 