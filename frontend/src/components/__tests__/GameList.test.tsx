import React from 'react';
import { render, screen } from '@testing-library/react';
import { GameList } from '../GameList';
import { Game } from '@/types/Game';

// Mock the GameCard component
jest.mock('../GameCard', () => ({
  GameCard: ({ game }: { game: Game }) => (
    <div data-testid={`game-card-${game.gameId}`}>
      {game.homeTeam.teamTricode} vs {game.awayTeam.teamTricode}
    </div>
  )
}));

describe('GameList', () => {
  const mockGames: Game[] = [
    {
      gameId: '1',
      status: 'live' as const,
      period: 2,
      clock: '5:30',
      homeTeam: {
        teamId: '1610612747',
        teamTricode: 'LAL',
        score: 55,
        stats: { rebounds: 20, assists: 15, blocks: 3 }
      },
      awayTeam: {
        teamId: '1610612744',
        teamTricode: 'GSW',
        score: 60,
        stats: { rebounds: 22, assists: 18, blocks: 2 }
      },
      lastUpdate: Date.now()
    },
    {
      gameId: '2',
      status: 'scheduled' as const,
      period: 0,
      clock: '',
      homeTeam: {
        teamId: '1610612738',
        teamTricode: 'BOS',
        score: 0,
        stats: { rebounds: 0, assists: 0, blocks: 0 }
      },
      awayTeam: {
        teamId: '1610612751',
        teamTricode: 'BKN',
        score: 0,
        stats: { rebounds: 0, assists: 0, blocks: 0 }
      },
      lastUpdate: Date.now()
    }
  ];

  it('renders all games', () => {
    render(<GameList games={mockGames} />);
    expect(screen.getByTestId('game-card-1')).toBeInTheDocument();
    expect(screen.getByTestId('game-card-2')).toBeInTheDocument();
  });

  it('renders loading state', () => {
    render(<GameList games={[]} isLoading={true} />);
    expect(screen.getByText('Loading games...')).toBeInTheDocument();
  });

  it('renders error state', () => {
    const errorMessage = 'Failed to load games';
    render(<GameList games={[]} error={errorMessage} />);
    expect(screen.getByText(errorMessage)).toBeInTheDocument();
  });

  it('renders empty state when no games', () => {
    render(<GameList games={[]} />);
    expect(screen.getByText('No games scheduled')).toBeInTheDocument();
  });

  it('sorts games by status (live games first)', () => {
    render(<GameList games={mockGames} />);
    const gameCards = screen.getAllByTestId(/game-card/);
    expect(gameCards[0]).toHaveTextContent('LAL vs GSW');
    expect(gameCards[1]).toHaveTextContent('BOS vs BKN');
  });
}); 