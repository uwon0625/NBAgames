'use client';

import React from 'react';
import { GameCard } from './GameCard';
import { Game } from '../types/Game';

interface GameListProps {
  games: Game[];
  isLoading?: boolean;
}

export const GameList: React.FC<GameListProps> = ({ games, isLoading = false }) => {
  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (!games || games.length === 0) {
    return <div>No games available</div>;
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">NBA Games</h1>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {games.map((game) => (
          <GameCard key={game.id} game={game} />
        ))}
      </div>
    </div>
  );
}; 