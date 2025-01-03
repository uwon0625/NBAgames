import type { Meta, StoryObj } from '@storybook/react';
import { GameCard } from './GameCard';

const meta = {
  title: 'Components/GameCard',
  component: GameCard,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof GameCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const InProgress: Story = {
  args: {
    game: {
      id: '1',
      status: 'in_progress',
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
    },
  },
};

export const Scheduled: Story = {
  args: {
    game: {
      id: '2',
      status: 'scheduled',
      period: '',
      startTime: '2024-03-21T00:30:00Z',
      homeTeam: {
        id: '3',
        name: 'Golden State Warriors',
        abbreviation: 'GSW',
      },
      awayTeam: {
        id: '4',
        name: 'Phoenix Suns',
        abbreviation: 'PHX',
      },
      homeTeamScore: 0,
      awayTeamScore: 0,
      homeTeamStats: {
        rebounds: 0,
        assists: 0,
        blocks: 0,
      },
      awayTeamStats: {
        rebounds: 0,
        assists: 0,
        blocks: 0,
      },
    },
  },
};

export const Finished: Story = {
  args: {
    game: {
      id: '3',
      status: 'finished',
      period: 'Final',
      startTime: '2024-03-20T00:00:00Z',
      homeTeam: {
        id: '5',
        name: 'Milwaukee Bucks',
        abbreviation: 'MIL',
      },
      awayTeam: {
        id: '6',
        name: 'Miami Heat',
        abbreviation: 'MIA',
      },
      homeTeamScore: 112,
      awayTeamScore: 108,
      homeTeamStats: {
        rebounds: 45,
        assists: 25,
        blocks: 5,
      },
      awayTeamStats: {
        rebounds: 40,
        assists: 22,
        blocks: 3,
      },
    },
  },
}; 