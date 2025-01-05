import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { GameCard } from '../GameCard';
import { Game } from '@/types/Game';
import { renderWithRouter } from '@/__tests__/utils/test-utils';

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
    const { container } = renderWithRouter(<GameCard game={mockGame} />);
    expect(container.firstChild).toHaveAttribute('data-testid', `game-card-${mockGame.gameId}`);
    expect(container.firstChild).toHaveClass('bg-white', 'rounded-lg', 'shadow-md', 'p-4');
  });

  it('renders team scores', () => {
    renderWithRouter(<GameCard game={mockGame} />);
    expect(screen.getByTestId('home-team-score')).toHaveTextContent('55');
    expect(screen.getByTestId('away-team-score')).toHaveTextContent('60');
  });

  it('displays game status for live game', () => {
    renderWithRouter(<GameCard game={mockGame} />);
    expect(screen.getByTestId('game-status')).toHaveTextContent('Q2 5:30');
  });

  it('shows team stats', () => {
    renderWithRouter(<GameCard game={mockGame} />);
    
    // Check home team stats
    expect(screen.getByTestId('home-team-rebounds')).toHaveTextContent('REB: 20');
    expect(screen.getByTestId('home-team-assists')).toHaveTextContent('AST: 15');
    expect(screen.getByTestId('home-team-blocks')).toHaveTextContent('BLK: 3');
    
    // Check away team stats
    expect(screen.getByTestId('away-team-rebounds')).toHaveTextContent('REB: 22');
    expect(screen.getByTestId('away-team-assists')).toHaveTextContent('AST: 18');
    expect(screen.getByTestId('away-team-blocks')).toHaveTextContent('BLK: 2');
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

  it('displays team tricodes', () => {
    renderWithRouter(<GameCard game={mockGame} />);
    expect(screen.getByTestId('home-team-tricode')).toHaveTextContent('LAL');
    expect(screen.getByTestId('away-team-tricode')).toHaveTextContent('GSW');
  });

  it('shows correct game period format', () => {
    const { rerender } = renderWithRouter(<GameCard game={mockGame} />);
    expect(screen.getByTestId('game-status')).toHaveTextContent('Q2 5:30');

    const overtimeGame = {
      ...mockGame,
      period: 5,
      clock: '2:00'
    };
    rerender(<GameCard game={overtimeGame} />);
    expect(screen.getByTestId('game-status')).toHaveTextContent('OT 2:00');
  });

  it('navigates to game details on click', () => {
    const { mockRouter, container } = renderWithRouter(<GameCard game={mockGame} />);
    const card = container.firstChild as HTMLElement;
    fireEvent.click(card);
    expect(mockRouter.push).toHaveBeenCalledWith(`/games/${mockGame.gameId}`);
  });
}); 