import { WebSocket, WebSocketServer } from 'ws';

export interface ExtendedWebSocket extends WebSocket {
  isAlive: boolean;
}

export interface ExtendedWebSocketServer extends WebSocketServer {
  clients: Set<ExtendedWebSocket>;
} 