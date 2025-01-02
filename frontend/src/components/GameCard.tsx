'use client';

import { GameScore } from '@/types';
import Link from 'next/link';

interface GameCardProps {
  game: GameScore;
}

// NBA team name to abbreviation mapping
const TEAM_ABBREVIATIONS: { [key: string]: string } = {
  'Atlanta Hawks': 'ATL',
  'Boston Celtics': 'BOS',
  'Brooklyn Nets': 'BKN',
  'Charlotte Hornets': 'CHA',
  'Chicago Bulls': 'CHI',
  'Cleveland Cavaliers': 'CLE',
  'Dallas Mavericks': 'DAL',
  'Denver Nuggets': 'DEN',
  'Detroit Pistons': 'DET',
  'Golden State Warriors': 'GSW',
  'Houston Rockets': 'HOU',
  'Indiana Pacers': 'IND',
  'Los Angeles Clippers': 'LAC',
  'Los Angeles Lakers': 'LAL',
  'Memphis Grizzlies': 'MEM',
  'Miami Heat': 'MIA',
  'Milwaukee Bucks': 'MIL',
  'Minnesota Timberwolves': 'MIN',
  'New Orleans Pelicans': 'NOP',
  'New York Knicks': 'NYK',
  'Oklahoma City Thunder': 'OKC',
  'Orlando Magic': 'ORL',
  'Philadelphia 76ers': 'PHI',
  'Phoenix Suns': 'PHX',
  'Portland Trail Blazers': 'POR',
  'Sacramento Kings': 'SAC',
  'San Antonio Spurs': 'SAS',
  'Toronto Raptors': 'TOR',
  'Utah Jazz': 'UTA',
  'Washington Wizards': 'WAS'
};

export const GameCard: React.FC<GameCardProps> = ({ game }) => {
  const isLive = game.status === 'live';
  const isFinal = game.status === 'final';
  const isHomeWinning = game.homeTeam.score > game.awayTeam.score;
  const isAwayWinning = game.awayTeam.score > game.homeTeam.score;

  const getTeamAbbreviation = (fullName: string | undefined) => {
    if (!fullName) return '';
    return TEAM_ABBREVIATIONS[fullName] || fullName.substring(0, 3).toUpperCase();
  };

  const formatGameClock = (clock: string | undefined) => {
    if (!clock) return '0:00';

    // Handle "PT12M34.00S" format
    if (clock.startsWith('PT')) {
      const minutes = clock.match(/PT(\d+)M/)?.[1] || '0';
      const seconds = clock.match(/M([\d.]+)S/)?.[1]?.split('.')[0] || '00';
      return `${parseInt(minutes)}:${seconds.padStart(2, '0')}`;
    }

    // Handle "12:34" format
    if (clock.includes(':')) {
      return clock;
    }

    // Handle "04M02" format
    const mIndex = clock.indexOf('M');
    if (mIndex !== -1) {
      const minutes = clock.substring(0, mIndex);
      const seconds = clock.substring(mIndex + 1);
      return `${parseInt(minutes)}:${seconds.padStart(2, '0')}`;
    }

    // Default case
    return clock;
  };

  const getGameStatusDisplay = () => {
    if (isFinal) return 'Final';
    if (isLive) return `Q${game.period} ${formatGameClock(game.clock)}`;
    return '';
  };

  return (
    <div className="bg-white rounded-xl shadow-lg overflow-hidden transition-all duration-300 hover:shadow-xl border border-gray-100 w-[400px]">
      <div className="flex items-stretch">
        {/* Game Status Column */}
        <div className="w-16 bg-gray-50 p-2 flex flex-col justify-center items-center border-r border-gray-100">
          <div className={`text-xs font-medium ${isLive ? 'text-red-600' : 'text-gray-600'}`}>
            {isLive && (
              <div className="flex items-center space-x-1">
                <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse"/>
                <span>Live</span>
              </div>
            )}
          </div>
          <div className="text-xs text-gray-500 mt-1 font-medium">
            {getGameStatusDisplay()}
          </div>
        </div>

        {/* Teams and Scores Column */}
        <div className="flex-1 px-4 py-2">
          <div className="flex items-center justify-between">
            {/* Teams */}
            <div className="space-y-2 min-w-[100px]">
              {/* Home Team */}
              <div className="flex items-center">
                <div className={`px-3 py-1 rounded-full font-medium text-sm w-16 text-center
                  ${isHomeWinning ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                  {getTeamAbbreviation(game.homeTeam?.name)}
                </div>
              </div>

              {/* Away Team */}
              <div className="flex items-center">
                <div className={`px-3 py-1 rounded-full font-medium text-sm w-16 text-center
                  ${isAwayWinning ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                  {getTeamAbbreviation(game.awayTeam?.name)}
                </div>
              </div>
            </div>

            {/* Scores */}
            <div className="space-y-2 w-12 text-right">
              <div className={`text-lg font-bold tabular-nums ${isHomeWinning ? 'text-green-600' : 'text-gray-900'}`}>
                {game.homeTeam.score}
              </div>
              <div className={`text-lg font-bold tabular-nums ${isAwayWinning ? 'text-green-600' : 'text-gray-900'}`}>
                {game.awayTeam.score}
              </div>
            </div>

            {/* Additional Stats */}
            <div className="flex gap-4 text-xs text-gray-500 ml-4">
              {/* Rebounds */}
              <div className="space-y-2 text-center w-8">
                <div className="font-semibold">REB</div>
                <div>{game.homeTeam.stats?.rebounds ?? '-'}</div>
                <div>{game.awayTeam.stats?.rebounds ?? '-'}</div>
              </div>

              {/* Assists */}
              <div className="space-y-2 text-center w-8">
                <div className="font-semibold">AST</div>
                <div>{game.homeTeam.stats?.assists ?? '-'}</div>
                <div>{game.awayTeam.stats?.assists ?? '-'}</div>
              </div>

              {/* Blocks */}
              <div className="space-y-2 text-center w-8">
                <div className="font-semibold">BLK</div>
                <div>{game.homeTeam.stats?.blocks ?? '-'}</div>
                <div>{game.awayTeam.stats?.blocks ?? '-'}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Game Info Column */}
        <div className="w-16 bg-gray-50 p-1.5 flex flex-col justify-center items-center border-l border-gray-100">
          <Link
            href={`/box-score/${game.gameId}`}
            className={`px-2 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-colors
              ${game.status === 'scheduled' 
                ? 'bg-gray-300 text-gray-500 pointer-events-none'
                : 'bg-blue-600 text-white hover:bg-blue-700'}`}
          >
            Box Score
          </Link>
        </div>
      </div>
    </div>
  );
}; 