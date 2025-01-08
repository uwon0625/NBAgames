'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchGame, getBoxScore } from '@/services/api';
import { PlayerStatsTable } from './PlayerStatsTable';
import { Game, GameBoxScore } from '@/types/Game';
import { GameStatus } from '@/types/enums';
import { formatGameStatus } from '@/utils/formatters';

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

  if (!boxScore) {
    return <div className="text-center p-4">No box score available</div>;
  }

  const gameStatus = formatGameStatus(
    status as GameStatus || boxScore.status,
    period || boxScore.period,
    clock || boxScore.clock
  );

  const hasGameInfo = boxScore.arena || (typeof boxScore.attendance === 'number' && boxScore.attendance > 0);

  return (
    <div className="space-y-8">
      {/* Game Status */}
      <div className="text-center">
        <div className="text-gray-600" data-testid="game-status">
          {gameStatus}
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
      {hasGameInfo && (
        <div className="mt-8 text-center text-gray-600">
          {boxScore.arena && <p>{boxScore.arena}</p>}
          {typeof boxScore.attendance === 'number' && boxScore.attendance > 0 && (
            <p>Attendance: {boxScore.attendance.toLocaleString()}</p>
          )}
        </div>
      )}
    </div>
  );
} 