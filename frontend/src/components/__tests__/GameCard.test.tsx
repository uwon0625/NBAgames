import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { GameCard } from '../GameCard';
import { Game } from '@/types/Game';
import { GameStatus } from '@/types/enums';
import { renderWithRouter } from '@/utils/test-utils';

describe('GameCard', () => {
  const mockGame: Game = {
    gameId: '1234567',
    status: GameStatus.LIVE,
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

  it('handles scheduled game status', () => {
    const scheduledGame: Game = {
      ...mockGame,
      status: GameStatus.SCHEDULED,
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
      status: GameStatus.FINAL,
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
    expect(mockRouter.push).toHaveBeenCalledWith(
      `/games/${mockGame.gameId}/boxscore?status=${mockGame.status}&period=${mockGame.period}&clock=${encodeURIComponent(mockGame.clock)}`
    );
  });

  it('displays correct team scores', () => {
    renderWithRouter(<GameCard game={mockGame} />);
    expect(screen.getByTestId('home-team-score')).toHaveTextContent('55');
    expect(screen.getByTestId('away-team-score')).toHaveTextContent('60');
  });

  it('displays correct team stats', () => {
    renderWithRouter(<GameCard game={mockGame} />);
    expect(screen.getByTestId('home-team-rebounds')).toHaveTextContent('20');
    expect(screen.getByTestId('home-team-assists')).toHaveTextContent('15');
    expect(screen.getByTestId('home-team-blocks')).toHaveTextContent('3');
    expect(screen.getByTestId('away-team-rebounds')).toHaveTextContent('22');
    expect(screen.getByTestId('away-team-assists')).toHaveTextContent('18');
    expect(screen.getByTestId('away-team-blocks')).toHaveTextContent('2');
  });
}); 