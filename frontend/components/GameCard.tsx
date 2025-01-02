import { GameScore } from '@/types';

interface GameCardProps {
  game: GameScore;
}

export const GameCard: React.FC<GameCardProps> = ({ game }) => {
  const { homeTeam, awayTeam } = game;

  return (
    <div className="p-4 border rounded-lg shadow-md" data-testid="game-card">
      <div className="flex justify-between items-center">
        <div>
          <div data-testid="home-team-name">{homeTeam.name}</div>
          <div data-testid="home-team-score">{homeTeam.score}</div>
          <div className="text-sm">
            <span data-testid="home-team-rebounds">
              REB: {homeTeam.stats?.rebounds ?? 0}
            </span>
            {' '}
            <span data-testid="home-team-assists">
              AST: {homeTeam.stats?.assists ?? 0}
            </span>
          </div>
        </div>

        <div data-testid="game-status">
          Q{game.period} {game.clock}
        </div>

        <div>
          <div data-testid="away-team-name">{awayTeam.name}</div>
          <div data-testid="away-team-score">{awayTeam.score}</div>
          <div className="text-sm">
            <span data-testid="away-team-rebounds">
              REB: {awayTeam.stats?.rebounds ?? 0}
            </span>
            {' '}
            <span data-testid="away-team-assists">
              AST: {awayTeam.stats?.assists ?? 0}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}; 