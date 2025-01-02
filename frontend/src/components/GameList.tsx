'use client';

import { GameScore } from '@/types';
import { GameCard } from './GameCard';

interface GameListProps {
  games: GameScore[];
  isLoading: boolean;
}

export const GameList: React.FC<GameListProps> = ({ games, isLoading }) => {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[1, 2, 3, 4].map((placeholder) => (
          <div 
            key={placeholder}
            className="bg-white rounded-xl shadow-lg h-32 animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (games.length === 0) {
    return (
      <div className="text-center text-gray-500 py-8">
        No games scheduled
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {games.map(game => (
        <GameCard key={game.gameId} game={game} />
      ))}
    </div>
  );
}; 