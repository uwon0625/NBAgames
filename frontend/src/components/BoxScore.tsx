'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchGame, getBoxScore } from '@/services/api';
import { PlayerStatsTable } from './PlayerStatsTable';
import { Game, GameBoxScore } from '@/types/Game';

interface BoxScoreProps {
  gameId: string | null;
}

export function BoxScore({ gameId }: BoxScoreProps) {
  const { data: game, isLoading: gameLoading, error: gameError } = 
    useQuery<Game | undefined>({
      queryKey: ['game', gameId],
      queryFn: () => fetchGame(gameId),
      enabled: !!gameId
    });

  const { data: boxScore, isLoading: boxScoreLoading, error: boxScoreError } = 
    useQuery<GameBoxScore>({
      queryKey: ['boxScore', gameId],
      queryFn: () => getBoxScore(gameId!, game!),
      enabled: !!gameId && !!game
    });

  if (!gameId) {
    return <div className="text-center p-4">No game ID provided</div>;
  }

  if (gameLoading || boxScoreLoading) {
    return <div className="text-center p-4">Loading...</div>;
  }

  if (gameError || boxScoreError) {
    return <div className="text-center text-red-600 p-4">Error loading box score</div>;
  }

  if (!game || !boxScore) {
    return <div className="text-center p-4">No box score available</div>;
  }

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
          {boxScore.status === 'finished' ? 'Final' : 
           boxScore.status === 'in_progress' ? 'In Progress' : 'Scheduled'}
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