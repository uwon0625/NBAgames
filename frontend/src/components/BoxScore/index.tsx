'use client';

import { useState, useEffect } from 'react';
import { GameBoxScore } from '@/types';
import { BoxScoreTable } from './BoxScoreTable';
import Link from 'next/link';

interface BoxScoreProps {
  id: string;
}

const BoxScore = ({ id }: BoxScoreProps) => {
  const [game, setGame] = useState<GameBoxScore | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchBoxScore = async () => {
      try {
        setError(null);
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/games/${id}/box-score`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        setGame(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load box score');
      } finally {
        setIsLoading(false);
      }
    };

    fetchBoxScore();
  }, [id]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"/>
      </div>
    );
  }

  if (error || !game) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <div className="text-center mb-4">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Error Loading Box Score</h2>
          <p className="text-gray-500">{error || 'Game not found'}</p>
        </div>
        <Link 
          href="/"
          className="text-blue-600 hover:text-blue-800 font-medium"
        >
          Return to Games
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <Link 
          href="/"
          className="inline-flex items-center text-blue-600 hover:text-blue-800 font-medium"
        >
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Games
        </Link>
        {game.status === 'live' && (
          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-800">
            <span className="w-2 h-2 mr-2 bg-red-500 rounded-full animate-pulse"/>
            Live
          </span>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-lg p-6 space-y-8">
        {/* Game Header */}
        <div className="border-b border-gray-200 pb-6">
          <div className="flex justify-between items-center mb-4">
            <h1 className="text-2xl font-bold text-gray-900">Box Score</h1>
            <div className="text-lg font-medium">
              {game.status === 'live' && (
                <span className="text-red-600 mr-2">
                  Q{game.period} {game.clock}
                </span>
              )}
              {game.status === 'final' && (
                <span className="text-gray-600 mr-2">Final</span>
              )}
            </div>
          </div>
          <div className="flex justify-between items-center text-xl">
            <div className="flex items-center space-x-4">
              <span className="font-bold text-gray-900">{game.homeTeam.name}</span>
              <span className="text-2xl font-bold text-gray-900">{game.homeTeam.score}</span>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-2xl font-bold text-gray-900">{game.awayTeam.score}</span>
              <span className="font-bold text-gray-900">{game.awayTeam.name}</span>
            </div>
          </div>
          {game.arena && (
            <div className="mt-4 text-sm text-gray-500 flex items-center justify-center space-x-2">
              <span>{game.arena}</span>
              {game.attendance && (
                <>
                  <span>•</span>
                  <span>Attendance: {game.attendance.toLocaleString()}</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Box Scores */}
        <div className="space-y-8">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">{game.homeTeam.name}</h2>
            <BoxScoreTable team={game.homeTeam} />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">{game.awayTeam.name}</h2>
            <BoxScoreTable team={game.awayTeam} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default BoxScore;