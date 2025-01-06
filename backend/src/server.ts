import app from './app';
import { logger } from './config/logger';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';

const server = createServer(app);
const wss = new WebSocketServer({ 
  server,
  path: '/ws'  // Match this with frontend WS_URL path
});

server.listen(process.env.PORT || 3001, () => {
  console.log(`Server running on port ${process.env.PORT || 3001}`);
}); 