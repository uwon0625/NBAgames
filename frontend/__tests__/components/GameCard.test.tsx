import { render } from '@testing-library/react';
import { GameCard } from '../../src/components/GameCard';
import { GameScore } from '../../src/types';

const mockGame: GameScore = {
  gameId: 'test-123',
  status: 'live',
  period: 2,
  clock: '5:30',
  homeTeam: {
    teamId: 'LAL',
    name: 'Los Angeles Lakers',
    score: 58,
    stats: {
      rebounds: 24,
      assists: 15,
      blocks: 3
    }
  },
  awayTeam: {
    teamId: 'GSW',
    name: 'Golden State Warriors',
    score: 62,
    stats: {
      rebounds: 22,
      assists: 18,
      blocks: 2
    }
  },
  lastUpdate: Date.now()
};

describe('GameCard', () => {
  const renderGameCard = () => render(<GameCard game={mockGame} />);

  it('renders game information correctly', () => {
    const { getByTestId } = renderGameCard();
    
    expect(getByTestId('home-team-name')).toHaveTextContent('Los Angeles Lakers');
    expect(getByTestId('away-team-name')).toHaveTextContent('Golden State Warriors');
    expect(getByTestId('home-team-score')).toHaveTextContent('58');
    expect(getByTestId('away-team-score')).toHaveTextContent('62');
  });

  it('shows live status indicator', () => {
    const { getByTestId } = renderGameCard();
    expect(getByTestId('game-status')).toHaveTextContent('Q2 5:30');
  });

  it('displays team stats', () => {
    const { getByTestId } = renderGameCard();
    
    expect(getByTestId('home-team-rebounds')).toHaveTextContent('REB: 24');
    expect(getByTestId('home-team-assists')).toHaveTextContent('AST: 15');
    expect(getByTestId('away-team-rebounds')).toHaveTextContent('REB: 22');
    expect(getByTestId('away-team-assists')).toHaveTextContent('AST: 18');
  });
}); 