import WebSocket from 'ws';
import { Server } from 'http';
import { logger } from '../config/logger';
import { GameScore } from '../types';

export class WebSocketService {
  private wss: WebSocket.Server | null = null;
  private clients: Set<WebSocket> = new Set();

  initialize(server: Server) {
    if (this.wss) {
      logger.warn('WebSocket server already initialized');
      return;
    }

    this.wss = new WebSocket.Server({ server });

    this.wss.on('connection', (ws: WebSocket) => {
      logger.info('Client connected');
      this.clients.add(ws);

      ws.on('close', () => {
        logger.info('Client disconnected');
        this.clients.delete(ws);
      });

      ws.on('error', (error) => {
        logger.error('WebSocket error:', error);
        this.clients.delete(ws);
      });
    });

    logger.info('WebSocket server initialized');
  }

  broadcastGameUpdate(game: GameScore) {
    if (!this.wss) {
      logger.warn('Attempting to broadcast before WebSocket server initialization');
      return;
    }

    const message = JSON.stringify({
      type: 'gameUpdate',
      data: game
    });

    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
        } catch (error) {
          logger.error('Error sending message to client:', error);
          this.clients.delete(client);
        }
      }
    });
  }

  cleanup() {
    if (this.wss) {
      this.wss.close();
      this.wss = null;
      this.clients.clear();
      logger.info('WebSocket server closed');
    }
  }
} 