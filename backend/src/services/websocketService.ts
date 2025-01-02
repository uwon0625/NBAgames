import { WebSocket } from 'ws';
import { logger } from '../config/logger';
import { GameScore, GameAlert } from '../types';
import { ExtendedWebSocket } from '../types/websocket';

const clients = new Set<ExtendedWebSocket>();

export function broadcastGameUpdate(game: GameScore) {
  const message = JSON.stringify({
    type: 'game-update',
    game,
    timestamp: Date.now()
  });

  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
      } catch (error) {
        logger.error('Failed to send game update:', error);
      }
    }
  });
}

export function broadcastAlert(alert: GameAlert) {
  const message = JSON.stringify({
    type: 'alert',
    alert,
    timestamp: Date.now()
  });

  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
      } catch (error) {
        logger.error('Failed to send alert:', error);
      }
    }
  });
}

export { clients }; 