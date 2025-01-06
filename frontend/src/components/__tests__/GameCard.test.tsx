import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { GameCard } from '../GameCard';
import { Game } from '@/types/Game';
import { renderWithRouter } from '@/utils/test-utils';

// Mock console.log to reduce noise in tests
jest.spyOn(console, 'log').mockImplementation(() => {});

// Mock window.location
const mockLocation = new URL('http://localhost:3000');
Object.defineProperty(window, 'location', {
  value: {
    ...mockLocation,
    href: mockLocation.href,
    pathname: mockLocation.pathname,
  },
  writable: true
});

describe('GameCard', () => {
  const mockGame: Game = {
    gameId: '1234567',
    status: 'live' as const,
    period: 2,
    clock: '5:30',
    homeTeam: {
      teamId: '1610612747',
      teamTricode: 'LAL',
      score: 55,
      stats: {
        rebounds: 20,
        assists: 15,
        blocks: 3
      }
    },
    awayTeam: {
      teamId: '1610612744',
      teamTricode: 'GSW',
      score: 60,
      stats: {
        rebounds: 22,
        assists: 18,
        blocks: 2
      }
    },
    lastUpdate: Date.now()
  };

  it('renders game card correctly', () => {
    renderWithRouter(<GameCard game={mockGame} />);
    const gameCard = screen.getByTestId(`game-card-${mockGame.gameId}`);
    expect(gameCard).toHaveClass(
      'bg-gradient-to-br',
      'from-white',
      'to-gray-50',
      'rounded-lg',
      'shadow-md'
    );
  });

  it('renders team tricodes and scores', () => {
    renderWithRouter(<GameCard game={mockGame} />);
    expect(screen.getByTestId('home-team-tricode')).toHaveTextContent('LAL');
    expect(screen.getByTestId('away-team-tricode')).toHaveTextContent('GSW');
    expect(screen.getByTestId('home-team-score')).toHaveTextContent('55');
    expect(screen.getByTestId('away-team-score')).toHaveTextContent('60');
  });

  it('displays game status for live game', () => {
    renderWithRouter(<GameCard game={mockGame} />);
    expect(screen.getByTestId('game-status')).toHaveTextContent('Q2 5:30');
  });

  it('shows team stats', () => {
    renderWithRouter(<GameCard game={mockGame} />);
    
    // Check stats in the grid layout
    const statsContainer = screen.getByTestId('stats-container');
    expect(statsContainer).toBeInTheDocument();
    
    // Home team stats
    expect(screen.getByTestId('home-team-rebounds')).toHaveTextContent('20');
    expect(screen.getByTestId('home-team-assists')).toHaveTextContent('15');
    expect(screen.getByTestId('home-team-blocks')).toHaveTextContent('3');
    
    // Away team stats
    expect(screen.getByTestId('away-team-rebounds')).toHaveTextContent('22');
    expect(screen.getByTestId('away-team-assists')).toHaveTextContent('18');
    expect(screen.getByTestId('away-team-blocks')).toHaveTextContent('2');
  });

  it('handles scheduled game status', () => {
    const scheduledGame: Game = {
      ...mockGame,
      status: 'scheduled' as const,
      period: 0,
      clock: '',
      homeTeam: { ...mockGame.homeTeam, score: 0 },
      awayTeam: { ...mockGame.awayTeam, score: 0 }
    };
    renderWithRouter(<GameCard game={scheduledGame} />);
    expect(screen.getByTestId('game-status')).toHaveTextContent('Scheduled');
  });

  it('handles final game status', () => {
    const finalGame: Game = {
      ...mockGame,
      status: 'final' as const,
      clock: ''
    };
    renderWithRouter(<GameCard game={finalGame} />);
    expect(screen.getByTestId('game-status')).toHaveTextContent('Final');
  });

  it('shows box score button and handles click', () => {
    const { mockRouter } = renderWithRouter(<GameCard game={mockGame} />);
    const boxScoreButton = screen.getByTestId('box-score-button');
    expect(boxScoreButton).toBeInTheDocument();
    
    fireEvent.click(boxScoreButton);
    // Stop event propagation is handled in the component
    expect(mockRouter.push).toHaveBeenCalledWith(
      `/games/${mockGame.gameId}/boxscore?status=${mockGame.status}&period=${mockGame.period}&clock=${encodeURIComponent(mockGame.clock)}`
    );
  });

  it('navigates to game details on card click', () => {
    const { mockRouter } = renderWithRouter(<GameCard game={mockGame} />);
    const card = screen.getByTestId(`game-card-${mockGame.gameId}`);
    fireEvent.click(card);
    expect(mockRouter.push).toHaveBeenCalledWith(`/games/${mockGame.gameId}`);
  });
}); 