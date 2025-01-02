import { GameBoxScore } from '../../src/types';

export const mockBoxScore: GameBoxScore = {
  gameId: 'test-game-id',
  status: 'final',
  period: 4,
  clock: '0:00',
  homeTeam: {
    teamId: 'LAL',
    name: 'Los Angeles Lakers',
    score: 120,
    players: [],
    totals: {
      points: 120,
      rebounds: 40,
      assists: 25,
      steals: 8,
      blocks: 5,
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
    teamId: 'GSW',
    name: 'Golden State Warriors',
    score: 110,
    players: [],
    totals: {
      points: 110,
      rebounds: 38,
      assists: 28,
      steals: 7,
      blocks: 4,
      fgm: 42,
      fga: 90,
      threePm: 15,
      threePa: 35,
      ftm: 11,
      fta: 14
    },
    stats: {
      rebounds: 38,
      assists: 28,
      blocks: 4
    }
  },
  lastUpdate: Date.now()
}; 