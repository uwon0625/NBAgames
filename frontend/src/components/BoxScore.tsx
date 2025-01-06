'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchGame, getBoxScore } from '@/services/api';
import { PlayerStatsTable } from './PlayerStatsTable';
import { Game, GameBoxScore } from '@/types/Game';

interface BoxScoreProps {
  gameId: string | null;
  status?: string | null;
  period?: number;
  clock?: string;
}

export function BoxScore({ gameId, status, period, clock }: BoxScoreProps) {
  const { data: game, isLoading: gameLoading, error: gameError } = 
    useQuery<Game | undefined>({
      queryKey: ['game', gameId],
      queryFn: () => fetchGame(gameId),
      enabled: !!gameId,
      retry: 1,
      staleTime: 30000 // Cache for 30 seconds
    });

  const { data: boxScore, isLoading: boxScoreLoading, error: boxScoreError } = 
    useQuery<GameBoxScore>({
      queryKey: ['boxScore', gameId],
      queryFn: () => getBoxScore(gameId!, game!),
      enabled: !!gameId && !!game,
      retry: 1,
      staleTime: 30000 // Cache for 30 seconds
    });

  if (!gameId) {
    return <div className="text-center p-4">No game ID provided</div>;
  }

  if (gameLoading || boxScoreLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-gray-500">Loading box score...</div>
      </div>
    );
  }

  if (gameError || boxScoreError) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-red-500">
          {gameError ? 'Error loading game data' : 'Error loading box score'}
        </div>
      </div>
    );
  }

  if (!game || !boxScore) {
    return <div className="text-center p-4">No box score available</div>;
  }

  const formatClock = (clock: string | undefined) => {
    if (!clock) return '';

    // If clock is in PT format (PT00M23.70S)
    if (clock.startsWith('PT')) {
      const matches = clock.match(/PT(\d+)M([\d.]+)S/);
      if (matches) {
        const minutes = parseInt(matches[1]);
        const seconds = Math.floor(parseFloat(matches[2]));
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
      }
    }

    return clock;
  };

  const formatGameStatus = () => {
    if (status === 'live' && period && clock) {
      return period > 4 
        ? `OT ${formatClock(clock)}`
        : `Q${period} ${formatClock(clock)}`;
    }
    if (status === 'final') {
      return 'Final';
    }
    // For any other status (should only be 'live' without period/clock)
    return 'In Progress';
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Game Header */}
      <div className="text-center mb-8">
        <div className="text-2xl font-bold mb-2" data-testid="game-header">
          {boxScore.homeTeam.teamTricode} vs {boxScore.awayTeam.teamTricode}
        </div>
        <div className="text-xl">
          <span data-testid="home-team-score">{boxScore.homeTeam.score}</span>
          {' - '}
          <span data-testid="away-team-score">{boxScore.awayTeam.score}</span>
        </div>
        <div className="text-gray-600" data-testid="game-status">
          {formatGameStatus()}
        </div>
      </div>

      {/* Team Stats */}
      <div className="grid md:grid-cols-2 gap-8">
        {/* Home Team */}
        <div>
          <h2 className="text-xl font-bold mb-4 text-center">
            {boxScore.homeTeam.teamTricode}
          </h2>
          <PlayerStatsTable 
            key={`home-${boxScore.homeTeam.teamTricode}`}
            players={boxScore.homeTeam.players} 
            totals={boxScore.homeTeam.totals} 
          />
        </div>

        {/* Away Team */}
        <div>
          <h2 className="text-xl font-bold mb-4 text-center">
            {boxScore.awayTeam.teamTricode}
          </h2>
          <PlayerStatsTable 
            key={`away-${boxScore.awayTeam.teamTricode}`}
            players={boxScore.awayTeam.players} 
            totals={boxScore.awayTeam.totals} 
          />
        </div>
      </div>

      {/* Game Info */}
      {boxScore.arena && (
        <div className="mt-8 text-center text-gray-600">
          <p>{boxScore.arena}</p>
          <p>Attendance: {boxScore.attendance?.toLocaleString()}</p>
        </div>
      )}
    </div>
  );
} 