'use client';

import React, { useContext } from 'react';
import { Game } from '@/types/Game';
import { RouterContext } from '@/utils/RouterContext';
import { formatGameStatus } from '@/utils/formatters';
import { GameStatus } from '@/types/enums';

interface GameCardProps {
  game: Game;
}

export const GameCard: React.FC<GameCardProps> = ({ game }) => {
  const router = useContext(RouterContext);

  const handleClick = () => {
    try {
      if (router) {
        router.push(`/games/${game.gameId}`);
      } else {
        window.location.href = `/games/${game.gameId}`;
      }
    } catch (error) {
      console.error('Navigation failed:', error);
      window.location.href = `/games/${game.gameId}`;
    }
  };

  const handleBoxScoreClick = async (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering the card click
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

  const getGameStatusText = (): string => {
    return formatGameStatus(game.status, game.period, game.clock);
  };

  const getBoxScoreButtonStyle = () => {
    const isGameStarted = game.status !== GameStatus.SCHEDULED;
    return `text-xs font-bold ${
      isGameStarted 
        ? 'text-blue-600 bg-blue-50 hover:bg-blue-100 cursor-pointer' 
        : 'text-gray-400 bg-gray-100 cursor-not-allowed opacity-50'
    } rounded-full px-3 py-1 w-[80px] text-center`;
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div 
        className="bg-gradient-to-br from-white to-gray-50 rounded-lg shadow-md px-6 py-4 cursor-pointer hover:shadow-lg transition-all hover:from-gray-50 hover:to-white"
        onClick={handleClick}
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
                className="text-xs text-gray-600 bg-gray-100 rounded-full px-3 py-1 w-[80px] text-center" 
                data-testid="game-status"
              >
                {getGameStatusText()}
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
                className={getBoxScoreButtonStyle()}
                onClick={handleBoxScoreClick}
                disabled={game.status === GameStatus.SCHEDULED}
                data-testid="box-score-button"
              >
                Box Score
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