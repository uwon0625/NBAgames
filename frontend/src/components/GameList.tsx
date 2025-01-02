'use client';

import { GameScore } from '@/types';
import { GameCard } from './GameCard';

interface GameListProps {
  games: GameScore[];
  isLoading: boolean;
}

export const GameList = ({ games, isLoading }: GameListProps) => {
  console.log('GameList render:', { games, isLoading }); // Debug log

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (!games || games.length === 0) {
    return <div>No games available</div>;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {games.map(game => (
        <GameCard key={game.gameId} game={game} />
      ))}
    </div>
  );
}; 