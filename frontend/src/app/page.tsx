'use client';

import { useEffect, useState } from 'react';
import { GameList } from '@/components/GameList';
import { useWebSocket } from '@/hooks/useWebSocket';
import { GameScore } from '@/types';

export default function Home() {
  const [games, setGames] = useState<GameScore[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDisconnected, setShowDisconnected] = useState(false);

  const handleGameUpdate = (updatedGame: GameScore) => {
    setGames(prevGames => 
      prevGames.map(game => 
        game.gameId === updatedGame.gameId ? updatedGame : game
      )
    );
  };

  const handleConnectionChange = (connected: boolean) => {
    setShowDisconnected(!connected);
  };

  useWebSocket(handleGameUpdate, handleConnectionChange);

  useEffect(() => {
    const fetchGames = async () => {
      try {
        setError(null);
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/games`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        setGames(data);
      } catch (error) {
        console.error('Error fetching games:', error);
        setError('Failed to load games. Please try again later.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchGames();
  }, []);

  return (
    <main className="min-h-screen bg-gray-50">
      {showDisconnected && (
        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm text-yellow-700">
                Connection lost. Attempting to reconnect...
              </p>
            </div>
          </div>
        </div>
      )}

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
