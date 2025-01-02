import { GameScore } from '../types';

export const testGames: GameScore[] = [
  {
    gameId: '1',
    status: 'live',
    period: 2,
    clock: '5:30',
    homeTeam: {
      teamId: '1',
      name: 'Lakers',
      score: 58,
      stats: {
        rebounds: 24,
        assists: 15,
        blocks: 3
      }
    },
    awayTeam: {
      teamId: '2',
      name: 'Warriors',
      score: 62,
      stats: {
        rebounds: 22,
        assists: 18,
        blocks: 2
      }
    },
    lastUpdate: Date.now()
  },
  // ... other test games
]; 