'use client';

import { useEffect, useState } from 'react';
import { GameList } from '@/components/GameList';
import { Game } from '@/types/Game';
import { fetchNBAGames } from '@/services/nbaService';

const REFRESH_INTERVAL = 10000; // 10 seconds

export default function Home() {
  const [games, setGames] = useState<Game[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchGames = async () => {
      try {
        setIsLoading(true);
        const response = await fetch('http://localhost:3001/api/games');
        const data = await response.json();
        console.log('Games data:', data); // Let's see what we're getting
        setGames(data);
      } catch (error) {
        console.error('Error fetching games:', error);
        setError('Failed to load games');
      } finally {
        setIsLoading(false);
      }
    };

    fetchGames();
    const interval = setInterval(fetchGames, REFRESH_INTERVAL);

    return () => clearInterval(interval);
  }, []);

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        <header className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900">NBA Live Scores</h1>
          <p className="text-gray-600 mt-2">Real-time basketball scores and updates</p>
        </header>

        <div className="max-w-6xl mx-auto">
          {error ? (
            <div className="bg-red-50 text-red-600 p-4 rounded-lg">
              {error}
            </div>
          ) : (
            <GameList games={games} isLoading={isLoading} />
          )}
        </div>
      </div>
    </main>
  );
}
