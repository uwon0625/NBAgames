import React from 'react';
import { render, screen } from '@testing-library/react';
import { BoxScore } from '../BoxScore';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as api from '@/services/api';
import { Game, GameBoxScore } from '@/types/Game';
import { GameStatus } from '@/types/enums';

// Mock the API module
jest.mock('@/services/api');
const mockedApi = api as jest.Mocked<typeof api>;

describe('BoxScore', () => {
  const mockGame: Game = {
    gameId: '1234567',
    status: GameStatus.LIVE,
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
      score: 110,
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
    status: GameStatus.LIVE,
    period: 2,
    clock: '5:30',
    startTime: '2024-01-04T19:00:00Z',
    homeTeam: {
      id: '1',
      teamId: '1610612747',
      teamTricode: 'LAL',
      score: 55,
      players: [
        {
          playerId: 'lebron-james',
          name: 'LeBron James',
          position: 'F',
          minutes: '24:30',
          points: 15,
          rebounds: 5,
          assists: 8,
          steals: 1,
          blocks: 1,
          personalFouls: 2,
          fgm: 6,
          fga: 10,
          threePm: 2,
          threePa: 4,
          ftm: 1,
          fta: 2,
          plusMinus: 5
        }
      ],
      totals: {
        points: 55,
        rebounds: 20,
        assists: 15,
        steals: 5,
        blocks: 3,
        personalFouls: 12,
        fgm: 22,
        fga: 45,
        threePm: 8,
        threePa: 20,
        ftm: 3,
        fta: 5
      },
      stats: {
        rebounds: 20,
        assists: 15,
        blocks: 3
      }
    },
    awayTeam: {
      id: '2',
      teamId: '1610612744',
      teamTricode: 'GSW',
      score: 60,
      players: [
        {
          playerId: 'stephen-curry',
          name: 'Stephen Curry',
          position: 'G',
          minutes: '22:15',
          points: 18,
          rebounds: 3,
          assists: 6,
          steals: 2,
          blocks: 0,
          personalFouls: 3,
          fgm: 7,
          fga: 12,
          threePm: 4,
          threePa: 7,
          ftm: 0,
          fta: 0,
          plusMinus: 8
        }
      ],
      totals: {
        points: 60,
        rebounds: 22,
        assists: 18,
        steals: 6,
        blocks: 2,
        personalFouls: 15,
        fgm: 25,
        fga: 50,
        threePm: 10,
        threePa: 25,
        ftm: 0,
        fta: 0
      },
      stats: {
        rebounds: 22,
        assists: 18,
        blocks: 2
      }
    },
    arena: 'Crypto.com Arena',
    attendance: 18997,
    lastUpdate: Date.now()
  };

  beforeEach(() => {
    // Setup API mocks
    mockedApi.fetchGame.mockResolvedValue(mockGame);
    mockedApi.getBoxScore.mockResolvedValue(mockBoxScore);
  });

  it('renders box score correctly', async () => {
    const queryClient = new QueryClient();
    
    render(
      <QueryClientProvider client={queryClient}>
        <BoxScore gameId="1234567" />
      </QueryClientProvider>
    );
    
    // Wait for data to load
    expect(await screen.findByText('LAL')).toBeInTheDocument();
    expect(await screen.findByText('GSW')).toBeInTheDocument();
  });

  it('renders game header with scores', async () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <BoxScore gameId="1234567" />
      </QueryClientProvider>
    );
    
    expect(await screen.findByTestId('game-header')).toHaveTextContent('LAL vs GSW');
    expect(await screen.findByTestId('home-team-score')).toHaveTextContent('55');
    expect(await screen.findByTestId('away-team-score')).toHaveTextContent('60');
  });

  it('renders player stats correctly', async () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <BoxScore gameId="1234567" />
      </QueryClientProvider>
    );
    expect(await screen.findByText('LeBron James')).toBeInTheDocument();
    expect(await screen.findByText('Stephen Curry')).toBeInTheDocument();
  });

  it('formats player minutes correctly', async () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <BoxScore gameId="1234567" />
      </QueryClientProvider>
    );
    expect(await screen.findByText('24:30')).toBeInTheDocument();
  });

  it('renders team totals', async () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <BoxScore gameId="1234567" />
      </QueryClientProvider>
    );
    expect(await screen.findAllByText('Team Totals')).toHaveLength(2);
  });

  it('renders game information', async () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <BoxScore gameId="1234567" />
      </QueryClientProvider>
    );
    expect(await screen.findByText(/Crypto\.com Arena/)).toBeInTheDocument();
    expect(await screen.findByText(/18,997/)).toBeInTheDocument();
  });

  it('displays correct shooting percentages', async () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <BoxScore gameId="1234567" />
      </QueryClientProvider>
    );
    expect(await screen.findByText('6-10')).toBeInTheDocument(); // LeBron FG
    expect(await screen.findByText('7-12')).toBeInTheDocument(); // Curry FG
  });

  it('shows game status', async () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <BoxScore gameId="1234567" status={GameStatus.LIVE} period={2} clock="5:30" />
      </QueryClientProvider>
    );
    expect(await screen.findByTestId('game-status')).toHaveTextContent('Q2 5:30');
  });
}); 