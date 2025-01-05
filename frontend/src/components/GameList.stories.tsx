import type { Meta, StoryObj } from '@storybook/react';
import { GameList } from './GameList';

const meta = {
  title: 'Components/GameList',
  component: GameList,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof GameList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    games: [
      {
        gameId: '1',
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
      },
      {
        gameId: '2',
        status: 'scheduled' as const,
        period: 0,
        clock: '',
        homeTeam: {
          teamId: '1610612756',
          teamTricode: 'PHX',
          score: 0,
          stats: {
            rebounds: 0,
            assists: 0,
            blocks: 0
          }
        },
        awayTeam: {
          teamId: '1610612744',
          teamTricode: 'GSW',
          score: 0,
          stats: {
            rebounds: 0,
            assists: 0,
            blocks: 0
          }
        },
        lastUpdate: Date.now()
      },
      {
        gameId: '3',
        status: 'final' as const,
        period: 4,
        clock: '',
        homeTeam: {
          teamId: '1610612749',
          teamTricode: 'MIL',
          score: 112,
          stats: {
            rebounds: 45,
            assists: 25,
            blocks: 5
          }
        },
        awayTeam: {
          teamId: '1610612748',
          teamTricode: 'MIA',
          score: 108,
          stats: {
            rebounds: 40,
            assists: 22,
            blocks: 3
          }
        },
        lastUpdate: Date.now()
      }
    ],
    isLoading: false
  }
};

export const Loading: Story = {
  args: {
    games: [],
    isLoading: true
  }
};

export const Empty: Story = {
  args: {
    games: [],
    isLoading: false
  }
};

export const WithError: Story = {
  args: {
    games: [],
    isLoading: false,
    error: 'Failed to load games'
  }
}; 