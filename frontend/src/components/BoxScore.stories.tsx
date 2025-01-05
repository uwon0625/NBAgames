import React from 'react';
import type { Meta, StoryFn } from '@storybook/react';
import { BoxScore } from './BoxScore';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Game, GameBoxScore } from '../types/Game';
import './BoxScore.stories.css';

// Create a decorator that sets up React Query with mocked data
const withReactQuery = (Story: StoryFn, context: any) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        staleTime: Infinity,
      },
    },
  });

  // Set up the mocked data
  if (context.parameters?.reactQuery?.queries) {
    context.parameters.reactQuery.queries.forEach((query: any) => {
      if (query.loading) {
        // For loading state, use setQueriesData
        queryClient.setQueriesData(query.queryKey, () => ({
          status: 'loading',
          data: undefined,
          dataUpdatedAt: Date.now(),
        }));
      } else if (query.error) {
        // For error state, use setQueriesData
        queryClient.setQueriesData(query.queryKey, () => ({
          status: 'error',
          error: { message: query.error },
          data: undefined,
          dataUpdatedAt: Date.now(),
        }));
      } else if (query.data) {
        // For success state, use setQueryData
        queryClient.setQueryData(query.queryKey, query.data);
      }
    });
  }

  return (
    <QueryClientProvider client={queryClient}>
      <div className="storybook-boxscore-wrapper">
        <Story />
      </div>
    </QueryClientProvider>
  );
};

// Mock data
const mockGame: Game = {
  gameId: '1234567',
  status: 'final' as const,
  period: 4,
  clock: '0:00',
  homeTeam: {
    teamId: 'LAL',
    teamTricode: 'LAL',
    score: 120,
    stats: {
      rebounds: 40,
      assists: 25,
      blocks: 5
    }
  },
  awayTeam: {
    teamId: 'GSW',
    teamTricode: 'GSW',
    score: 115,
    stats: {
      rebounds: 38,
      assists: 28,
      blocks: 4
    }
  },
  lastUpdate: Date.now()
};

const mockBoxScore: GameBoxScore = {
  gameId: '1234567',
  status: 'finished',
  period: 4,
  clock: '0:00',
  startTime: '2024-03-20T19:00:00Z',
  homeTeam: {
    id: '1',
    teamId: 'LAL',
    teamTricode: 'LAL',
    score: 120,
    players: [],
    totals: {
      points: 120,
      rebounds: 40,
      assists: 25,
      steals: 8,
      blocks: 5,
      personalFouls: 12,
      fgm: 45,
      fga: 88,
      threePm: 12,
      threePa: 30,
      ftm: 18,
      fta: 22
    },
    stats: {
      rebounds: 40,
      assists: 25,
      blocks: 5
    }
  },
  awayTeam: {
    id: '2',
    teamId: 'GSW',
    teamTricode: 'GSW',
    score: 115,
    players: [],
    totals: {
      points: 115,
      rebounds: 38,
      assists: 28,
      steals: 7,
      blocks: 4,
      personalFouls: 15,
      fgm: 42,
      fga: 85,
      threePm: 11,
      threePa: 28,
      ftm: 20,
      fta: 24
    },
    stats: {
      rebounds: 38,
      assists: 28,
      blocks: 4
    }
  },
  arena: 'Chase Center',
  attendance: 18064,
  lastUpdate: Date.now()
};

const meta = {
  title: 'Components/BoxScore',
  component: BoxScore,
  decorators: [withReactQuery],
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof BoxScore>;

export default meta;

// Define the story type
type BoxScoreStory = StoryFn<typeof BoxScore>;

// Stories
export const Default: BoxScoreStory = () => (
  <BoxScore gameId="1234567" />
);
Default.parameters = {
  reactQuery: {
    queries: [
      {
        queryKey: ['game', '1234567'],
        data: mockGame
      },
      {
        queryKey: ['boxScore', '1234567'],
        data: mockBoxScore
      }
    ]
  }
};

export const Loading: BoxScoreStory = () => (
  <BoxScore gameId="loading-id" />
);
Loading.parameters = {
  reactQuery: {
    queries: [
      {
        queryKey: ['game', 'loading-id'],
        data: undefined,
        loading: true
      }
    ]
  }
};

export const Error: BoxScoreStory = () => (
  <BoxScore gameId="error-id" />
);
Error.parameters = {
  reactQuery: {
    queries: [
      {
        queryKey: ['game', 'error-id'],
        data: undefined,
        error: 'Failed to fetch game'
      }
    ]
  }
}; 