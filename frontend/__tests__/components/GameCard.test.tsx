import { render, screen } from '@testing-library/react';
import { GameCard } from '@/components/GameCard';
import { GameScore } from '@/types';

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
  it('renders game information correctly', () => {
    render(<GameCard game={mockGame} />);
    
    expect(screen.getByText('Los Angeles Lakers')).toBeInTheDocument();
    expect(screen.getByText('Golden State Warriors')).toBeInTheDocument();
    expect(screen.getByText('58')).toBeInTheDocument();
    expect(screen.getByText('62')).toBeInTheDocument();
  });

  it('shows live status indicator', () => {
    render(<GameCard game={mockGame} />);
    expect(screen.getByText('Q2 5:30')).toBeInTheDocument();
  });

  it('displays team stats', () => {
    render(<GameCard game={mockGame} />);
    
    expect(screen.getByText('24')).toBeInTheDocument(); // Lakers rebounds
    expect(screen.getByText('15')).toBeInTheDocument(); // Lakers assists
    expect(screen.getByText('22')).toBeInTheDocument(); // Warriors rebounds
    expect(screen.getByText('18')).toBeInTheDocument(); // Warriors assists
  });
}); 