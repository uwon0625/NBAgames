import { WebSocket } from 'ws';
import { GameAlert } from '../types';

export class WebSocketService {
  private clients = new Set<WebSocket>();

  public broadcastAlert(alert: GameAlert) {
    const message = JSON.stringify({
      type: 'GAME_ALERT',
      data: alert
    });

    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }
} 