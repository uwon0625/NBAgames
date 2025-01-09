import { WebSocket } from 'ws';
import { GameAlert, GameScore } from '../types';
import { logger } from '../config/logger';

export class WebSocketService {
  private clients = new Set<WebSocket>();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startHeartbeat();
  }

  private startHeartbeat() {
    const HEARTBEAT_INTERVAL = 30000; // 30 seconds

    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      this.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.ping();
          } catch (error) {
            logger.error('Error sending ping:', error);
            this.removeClient(client);
          }
        } else {
          this.removeClient(client);
        }
      });
    }, HEARTBEAT_INTERVAL);
  }

  private removeClient(client: WebSocket) {
    client.terminate();
    this.clients.delete(client);
    logger.info(`Client disconnected. Active connections: ${this.clients.size}`);
  }

  public addClient(client: WebSocket) {
    this.clients.add(client);
    logger.info(`New client connected. Active connections: ${this.clients.size}`);

    client.on('close', () => {
      this.removeClient(client);
    });

    client.on('error', (error) => {
      logger.error('WebSocket client error:', error);
      this.removeClient(client);
    });

    client.on('pong', () => {
      // Reset client's timeout on pong response
      if (client.readyState === WebSocket.OPEN) {
        client.ping();
      }
    });
  }

  public broadcastGameUpdates(games: GameScore[], changedGameIds: string[]) {
    if (this.clients.size === 0 || changedGameIds.length === 0) return;

    const message = JSON.stringify({
      type: 'GAME_UPDATES',
      data: games.filter(game => changedGameIds.includes(game.gameId)),
      timestamp: Date.now()
    });

    this.broadcast(message);
  }

  private broadcast(message: string) {
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
        } catch (error) {
          logger.error('Error broadcasting message:', error);
          this.removeClient(client);
        }
      }
    });
  }

  public cleanup() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    this.clients.forEach(client => {
      try {
        client.terminate();
      } catch (error) {
        logger.error('Error terminating client:', error);
      }
    });
    this.clients.clear();
  }
} 