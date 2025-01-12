import { GameScore, Team } from '../types';
import { GameStatus } from '../types/enums';

export const mockGames: GameScore[] = [
  {
    gameId: '0022300476',
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
  }
];

export const mockTeams: Team[] = [
  {
    teamId: '1610612747',
    teamTricode: 'LAL',
    score: 55,
    stats: {
      rebounds: 20,
      assists: 15,
      blocks: 3
    }
  },
  {
    teamId: '1610612744',
    teamTricode: 'GSW',
    score: 60,
    stats: {
      rebounds: 22,
      assists: 18,
      blocks: 2
    }
  }
]; 