import { render } from '@testing-library/react';
import { GameCard } from '../GameCard';
import { Game } from '@/types/Game';

describe('GameCard', () => {
  it('matches snapshot', () => {
    const mockGame: Game = {
      id: '1',
      status: 'in_progress' as const,
      period: 'Q2 5:30',
      startTime: '2024-03-20T19:00:00Z',
      homeTeam: {
        id: '1',
        name: 'Los Angeles Lakers',
        abbreviation: 'LAL',
      },
      awayTeam: {
        id: '2',
        name: 'Boston Celtics',
        abbreviation: 'BOS',
      },
      homeTeamScore: 58,
      awayTeamScore: 62,
      homeTeamStats: {
        rebounds: 20,
        assists: 15,
        blocks: 3,
      },
      awayTeamStats: {
        rebounds: 22,
        assists: 18,
        blocks: 2,
      },
    };

    const { container } = render(<GameCard game={mockGame} />);
    expect(container).toMatchSnapshot();
  });
}); 