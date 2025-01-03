'use client';

import React from 'react';
import { Game } from '@/types/Game';

interface GameCardProps {
  game: Game;
}

export const GameCard: React.FC<GameCardProps> = ({ game }) => {
  const isGameActive = game.status === 'in_progress' || game.status === 'finished';

  const formatGameTime = (startTime: string) => {
    const date = new Date(startTime);
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
  };

  const getGameStatus = () => {
    if (game.status === 'scheduled') return formatGameTime(game.startTime);
    if (game.status === 'finished') return 'Final';
    return game.period;
  };

  return (
    <div className="bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow">
      <div className="flex h-24">
        {/* Left: Game Status */}
        <div className="w-28 flex items-center justify-center border-r border-gray-100">
          <span className={`text-sm font-semibold px-3 py-1 rounded-full ${
            game.status === 'in_progress' 
              ? 'bg-green-100 text-green-800'
              : game.status === 'finished'
              ? 'bg-gray-100 text-gray-800'
              : 'bg-blue-100 text-blue-800'
          }`}>
            {getGameStatus()}
          </span>
        </div>

        {/* Center: Scores and Stats */}
        <div className="flex-1 px-6 py-3">
          <div className="flex flex-col justify-between h-full">
            {/* Away Team */}
            <div className="flex items-center">
              <div className="w-16">
                <span className="font-bold">{game.awayTeam.abbreviation}</span>
              </div>
              <div className="w-12 font-bold text-xl">{game.awayTeamScore}</div>
              <div className="flex gap-4 ml-6 text-sm text-gray-600">
                <span>{game.awayTeamStats?.rebounds || 0} REB</span>
                <span>{game.awayTeamStats?.assists || 0} AST</span>
                <span>{game.awayTeamStats?.blocks || 0} BLK</span>
              </div>
            </div>

            {/* Home Team */}
            <div className="flex items-center">
              <div className="w-16">
                <span className="font-bold">{game.homeTeam.abbreviation}</span>
              </div>
              <div className="w-12 font-bold text-xl">{game.homeTeamScore}</div>
              <div className="flex gap-4 ml-6 text-sm text-gray-600">
                <span>{game.homeTeamStats?.rebounds || 0} REB</span>
                <span>{game.homeTeamStats?.assists || 0} AST</span>
                <span>{game.homeTeamStats?.blocks || 0} BLK</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Box Score Button */}
        <div className="w-28 flex items-center justify-center border-l border-gray-100">
          <button
            className={`px-4 py-2 rounded ${
              isGameActive
                ? 'bg-blue-500 text-white hover:bg-blue-600'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
            disabled={!isGameActive}
            onClick={() => {/* Handle box score navigation */}}
          >
            Box Score
          </button>
        </div>
      </div>
    </div>
  );
}; 