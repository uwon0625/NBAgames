'use client';

import React, { useContext } from 'react';
import { Game } from '@/types/Game';
import { RouterContext } from '@/utils/RouterContext';
import { formatClock, formatGameStatus } from '@/utils/formatters';
import { GameStatus } from '@/types/enums';

interface GameCardProps {
  game: Game;
}

export const GameCard: React.FC<GameCardProps> = ({ game }) => {
  const router = useContext(RouterContext);

  const handleBoxScoreClick = async (e: React.MouseEvent) => {
    if (game.status !== GameStatus.SCHEDULED) {
      const boxScoreUrl = `/games/${game.gameId}/boxscore?status=${game.status}&period=${game.period}&clock=${encodeURIComponent(game.clock)}`;
      try {
        if (router) {
          router.push(boxScoreUrl);
        } else {
          window.location.href = boxScoreUrl;
        }
      } catch (error) {
        console.error('Navigation to box score failed:', error);
        window.location.href = boxScoreUrl;
      }
    }
  };

  const getGameStatusStyle = () => {
    switch (game.status) {
      case GameStatus.LIVE:
        return 'bg-red-100 text-red-600';
      case GameStatus.FINAL:
        return 'bg-gray-100 text-gray-600';
      default:
        return 'bg-blue-50 text-blue-600';
    }
  };

  const getGameStatusText = (): { top: string, bottom: string } => {
    if (game.status === GameStatus.LIVE && game.period) {
      const statusText = formatGameStatus(game.status, game.period, game.clock);
      if (statusText === 'Half') {
        return {
          top: statusText,
          bottom: ''
        };
      }
      const [quarter, time] = statusText.split(' ');
      return {
        top: quarter,
        bottom: time || ''
      };
    }

    if (game.status === GameStatus.FINAL) {
      return {
        top: 'Final',
        bottom: ''
      };
    }

    return {
      top: 'Today',
      bottom: ''
    };
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div 
        className="bg-gradient-to-br from-white to-gray-50 rounded-lg shadow-md px-6 py-4"
        data-testid={`game-card-${game.gameId}`}
      >
        {/* Stats Header */}
        <div data-testid="stats-container" className="grid grid-cols-8 text-xs text-gray-500 mb-2">
          <div className="col-span-2"></div>
          <div className="col-span-3 grid grid-cols-2 gap-1 pl-8">
            <div>TEAM</div>
            <div className="text-center">PTS</div>
          </div>
          <div className="col-span-3 grid grid-cols-3 gap-1 pl-8">
            <div className="text-center">REB</div>
            <div className="text-center">AST</div>
            <div className="text-center">BLK</div>
          </div>
        </div>

        <div className="space-y-4">
          {/* Away Team - First */}
          <div className="grid grid-cols-8 items-center">
            {/* Status Container */}
            <div className="col-span-2">
              <div 
                className={`text-xs rounded-full px-3 py-1 w-[80px] text-center ${getGameStatusStyle()}`}
                data-testid="game-status"
              >
                <div className="font-bold">{getGameStatusText().top}</div>
                {getGameStatusText().bottom && (
                  <div className="text-xs">{getGameStatusText().bottom}</div>
                )}
              </div>
            </div>
            
            {/* Team and Score Container */}
            <div className="col-span-3 grid grid-cols-2 gap-1 pl-8">
              <div className="text-lg font-bold" data-testid="away-team-tricode">
                {game.awayTeam.teamTricode}
              </div>
              <div className="text-lg font-bold text-center" data-testid="away-team-score">
                {game.awayTeam.score}
              </div>
            </div>

            {/* Stats Container */}
            <div className="col-span-3 grid grid-cols-3 gap-1 pl-8">
              <div className="text-center" data-testid="away-team-rebounds">{game.awayTeam.stats.rebounds}</div>
              <div className="text-center" data-testid="away-team-assists">{game.awayTeam.stats.assists}</div>
              <div className="text-center" data-testid="away-team-blocks">{game.awayTeam.stats.blocks}</div>
            </div>
          </div>

          {/* Home Team - Second */}
          <div className="grid grid-cols-8 items-center">
            {/* Box Score Container */}
            <div className="col-span-2">
              <button 
                className={`text-xs font-bold ${
                  game.status !== GameStatus.SCHEDULED 
                    ? 'text-blue-600 bg-blue-50 hover:bg-blue-100 cursor-pointer' 
                    : 'text-gray-400 bg-gray-100 cursor-not-allowed opacity-50'
                } rounded-full px-3 py-1 w-[80px] text-center`}
                onClick={handleBoxScoreClick}
                disabled={game.status === GameStatus.SCHEDULED}
                data-testid="box-score-button"
              >
                <div>Box</div>
                <div>Score</div>
              </button>
            </div>

            {/* Team and Score Container */}
            <div className="col-span-3 grid grid-cols-2 gap-1 pl-8">
              <div className="text-lg font-bold" data-testid="home-team-tricode">
                {game.homeTeam.teamTricode}
              </div>
              <div className="text-lg font-bold text-center" data-testid="home-team-score">
                {game.homeTeam.score}
              </div>
            </div>

            {/* Stats Container */}
            <div className="col-span-3 grid grid-cols-3 gap-1 pl-8">
              <div className="text-center" data-testid="home-team-rebounds">{game.homeTeam.stats.rebounds}</div>
              <div className="text-center" data-testid="home-team-assists">{game.homeTeam.stats.assists}</div>
              <div className="text-center" data-testid="home-team-blocks">{game.homeTeam.stats.blocks}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}; 