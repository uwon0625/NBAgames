'use client';

import React, { useState, useEffect } from 'react';
import { GameCard } from './GameCard';
import { Game } from '../types/Game';

interface GameListProps {
  games: Game[];
  isLoading?: boolean;
  error?: string;
}

type GameStatus = 'live' | 'scheduled' | 'final';

const statusOrder: Record<GameStatus, number> = {
  live: 0,
  scheduled: 1,
  final: 2
};

export const GameList: React.FC<GameListProps> = ({ games, isLoading = false, error }) => {
  const [gamesState, setGames] = useState<Map<string, Game>>(() => 
    new Map(games.map(game => [game.gameId, game]))
  );
  
  useEffect(() => {
    setGames(new Map(games.map(game => [game.gameId, game])));
  }, [games]);

  useEffect(() => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL;
    if (!wsUrl) {
      console.error('WebSocket URL not configured');
      return;
    }

    const ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
      console.log('WebSocket connected');
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'game-updates') {
        setGames(prevGames => {
          const newGames = new Map(prevGames);
          data.games.forEach((game: Game) => {
            newGames.set(game.gameId, game);
          });
          return newGames;
        });
      }
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, []);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-gray-500">Loading games...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-red-500">{error}</div>
      </div>
    );
  }

  if (gamesState.size === 0) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-gray-500">No games scheduled</div>
      </div>
    );
  }

  const sortedGames = Array.from(gamesState.values()).sort((a, b) => {
    return statusOrder[a.status as GameStatus] - statusOrder[b.status as GameStatus];
  });

  return (
    <div className="space-y-4">
      {sortedGames.map(game => (
        <GameCard key={game.gameId} game={game} />
      ))}
    </div>
  );
}; 