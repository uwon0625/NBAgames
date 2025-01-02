'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { GameScore } from '@/types';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001/ws';
const HEARTBEAT_INTERVAL = 10000;
const RECONNECT_DELAY = 2000;
const MAX_RECONNECT_ATTEMPTS = 5;

export const useWebSocket = (
  onGameUpdate: (game: GameScore) => void,
  onConnectionChange?: (connected: boolean) => void
) => {
  const [isConnected, setIsConnected] = useState(false);
  const ws = useRef<WebSocket | null>(null);
  const heartbeatInterval = useRef<NodeJS.Timeout | undefined>(undefined);
  const reconnectTimeout = useRef<NodeJS.Timeout | undefined>(undefined);
  const reconnectAttempts = useRef(0);
  const mounted = useRef(true);

  const cleanup = useCallback(() => {
    if (heartbeatInterval.current) {
      clearInterval(heartbeatInterval.current);
      heartbeatInterval.current = undefined;
    }
    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current);
      reconnectTimeout.current = undefined;
    }
    if (ws.current) {
      if (ws.current.readyState === WebSocket.OPEN) {
        ws.current.close();
      }
      ws.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (!mounted.current) return;
    if (ws.current?.readyState === WebSocket.OPEN) return;

    cleanup();

    try {
      const socket = new WebSocket(WS_URL);
      let heartbeatHandle: NodeJS.Timeout;

      socket.onopen = () => {
        if (!mounted.current) {
          socket.close();
          return;
        }

        console.log('WebSocket connected');
        setIsConnected(true);
        onConnectionChange?.(true);
        reconnectAttempts.current = 0;

        // Start heartbeat
        heartbeatHandle = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'ping' }));
          }
        }, HEARTBEAT_INTERVAL);
        heartbeatInterval.current = heartbeatHandle;
      };

      socket.onclose = (event) => {
        if (!mounted.current) return;

        console.log(`WebSocket disconnected: ${event.code}`);
        setIsConnected(false);
        onConnectionChange?.(false);
        cleanup();

        if (mounted.current && reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
          console.log(`Reconnecting... Attempt ${reconnectAttempts.current + 1}`);
          reconnectAttempts.current += 1;
          reconnectTimeout.current = setTimeout(connect, RECONNECT_DELAY);
        }
      };

      socket.onerror = null; // Let onclose handle everything

      socket.onmessage = (event) => {
        if (!mounted.current) return;
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'game-update' && data.game) {
            onGameUpdate(data.game);
          }
        } catch (error) {
          console.error('Failed to parse message:', error);
        }
      };

      ws.current = socket;
    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
      if (mounted.current && reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts.current += 1;
        reconnectTimeout.current = setTimeout(connect, RECONNECT_DELAY);
      }
    }
  }, [cleanup, onGameUpdate, onConnectionChange]);

  useEffect(() => {
    mounted.current = true;
    connect();

    return () => {
      mounted.current = false;
      cleanup();
    };
  }, [connect, cleanup]);

  return { isConnected };
}; 