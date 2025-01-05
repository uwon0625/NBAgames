'use client';

import { useEffect, useState } from 'react';
import { GameBoxScore } from '@/types';
import { BoxScore } from '@/components/BoxScore';

export default function BoxScorePage({ params }: { params: { gameId: string } }) {
  const [boxScore, setBoxScore] = useState<GameBoxScore | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchBoxScore = async () => {
      try {
        setIsLoading(true);
        const response = await fetch(`http://localhost:3001/api/games/${params.gameId}/boxscore`);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        setBoxScore(data);
      } catch (error) {
        console.error('Error fetching box score:', error);
        setError('Failed to load box score');
      } finally {
        setIsLoading(false);
      }
    };

    fetchBoxScore();
  }, [params.gameId]);

  if (isLoading) return <div className="p-8 text-center">Loading...</div>;
  if (error) return <div className="p-8 text-center text-red-600">Error: {error}</div>;
  if (!boxScore) return <div className="p-8 text-center">No data available</div>;

  return (
    <div className="container mx-auto px-4 py-8">
      <BoxScore boxScore={boxScore} />
    </div>
  );
} 