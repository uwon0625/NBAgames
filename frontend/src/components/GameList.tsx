'use client';

import React from 'react';
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
  // Sort games: live games first, then scheduled, then final
  const sortedGames = [...games].sort((a, b) => {
    return (statusOrder[a.status as GameStatus] ?? 2) - (statusOrder[b.status as GameStatus] ?? 2);
  });

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

  if (games.length === 0) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-gray-500">No games scheduled</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {sortedGames.map((game) => (
        <GameCard key={game.gameId} game={game} />
      ))}
    </div>
  );
}; 