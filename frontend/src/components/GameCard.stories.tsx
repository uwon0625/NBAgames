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
      gameId: '1',
      status: 'live' as const,
      period: 2,
      clock: '5:30',
      homeTeam: {
        teamId: '1610612747',
        teamTricode: 'LAL',
        score: 58,
        stats: {
          rebounds: 20,
          assists: 15,
          blocks: 3
        }
      },
      awayTeam: {
        teamId: '1610612738',
        teamTricode: 'BOS',
        score: 62,
        stats: {
          rebounds: 22,
          assists: 18,
          blocks: 2
        }
      },
      lastUpdate: Date.now()
    }
  }
};

export const Scheduled: Story = {
  args: {
    game: {
      gameId: '2',
      status: 'scheduled',
      period: 0,
      clock: '',
      homeTeam: {
        teamId: '3',
        name: 'Golden State Warriors',
        abbreviation: 'GSW',
        score: 0,
        stats: {
          rebounds: 0,
          assists: 0,
          blocks: 0
        }
      },
      awayTeam: {
        teamId: '4',
        name: 'Phoenix Suns',
        abbreviation: 'PHX',
        score: 0,
        stats: {
          rebounds: 0,
          assists: 0,
          blocks: 0
        }
      },
      lastUpdate: Date.now()
    }
  }
};

export const Final: Story = {
  args: {
    game: {
      gameId: '3',
      status: 'final',
      period: 4,
      clock: '',
      homeTeam: {
        teamId: '5',
        name: 'Milwaukee Bucks',
        abbreviation: 'MIL',
        score: 112,
        stats: {
          rebounds: 45,
          assists: 25,
          blocks: 5
        }
      },
      awayTeam: {
        teamId: '6',
        name: 'Miami Heat',
        abbreviation: 'MIA',
        score: 108,
        stats: {
          rebounds: 40,
          assists: 22,
          blocks: 3
        }
      },
      lastUpdate: Date.now()
    }
  }
};

export const Default: Story = {
  args: {
    game: {
      gameId: '1',
      status: 'live',
      period: 2,
      clock: '5:30',
      homeTeam: {
        teamId: '1',
        name: 'Los Angeles Lakers',
        abbreviation: 'LAL',
        score: 58,
        stats: {
          rebounds: 20,
          assists: 15,
          blocks: 3
        }
      },
      awayTeam: {
        teamId: '2',
        name: 'Boston Celtics',
        abbreviation: 'BOS',
        score: 62,
        stats: {
          rebounds: 22,
          assists: 18,
          blocks: 2
        }
      },
      lastUpdate: Date.now()
    }
  }
}; 