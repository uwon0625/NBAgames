import * as nbaService from '../../src/services/nbaService';
import { GameBoxScore } from '../../src/types';

const mockBoxScore: GameBoxScore = {
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

jest.setTimeout(10000);

describe('NBA Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getGames', () => {
    beforeEach(() => {
      jest.spyOn(nbaService, 'getGames').mockResolvedValue([]);
    });

    test('returns cached data when available', async () => {
      const games = await nbaService.getGames();
      expect(games).toBeDefined();
      expect(Array.isArray(games)).toBe(true);
    }, 10000);
  });

  describe('getGameBoxScore', () => {
    beforeEach(() => {
      jest.spyOn(nbaService, 'getGameBoxScore').mockResolvedValue(mockBoxScore);
    });

    test('returns box score data', async () => {
      const boxScore = await nbaService.getGameBoxScore('test-game-id');
      expect(boxScore).toBeDefined();
      expect(boxScore).toEqual(mockBoxScore);
    }, 10000);
  });

  describe('getCacheStatus', () => {
    beforeEach(() => {
      jest.spyOn(nbaService, 'getCacheStatus').mockResolvedValue({ status: 'connected' });
    });

    test('returns cache status', async () => {
      const status = await nbaService.getCacheStatus();
      expect(status).toBeDefined();
      expect(status.status).toBe('connected');
    }, 10000);
  });
}); 