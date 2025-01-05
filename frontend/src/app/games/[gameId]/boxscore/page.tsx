'use client';

import { useEffect, useState } from 'react';
import { GameBoxScore, Game } from '@/types/Game';
import { BoxScore } from '@/components/BoxScore';
import { fetchGame } from '@/services/api';

export default function BoxScorePage({ params }: { params: { gameId: string } }) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Get the gameId from the URL params
  const gameId = params.gameId;

  if (!gameId) {
    return <div className="p-8 text-center">Invalid game ID</div>;
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <BoxScore gameId={gameId} />
    </div>
  );
} 