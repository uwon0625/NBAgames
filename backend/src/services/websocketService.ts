import { WebSocket } from 'ws';
import { GameAlert, GameScore } from '../types';

export class WebSocketService {
  private clients = new Set<WebSocket>();

  public broadcastGameUpdates(games: GameScore[], changedGameIds: string[]) {
    if (changedGameIds.length === 0) return;

    const changedGames = games.filter(game => 
      changedGameIds.includes(game.gameId)
    );

    const message = JSON.stringify({
      type: 'game-updates',
      games: changedGames,
      timestamp: Date.now()
    });

    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }
} 