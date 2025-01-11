import { 
  getTodaysGames, 
  getGameBoxScore, 
  transformNBAGames, 
  transformNBABoxScore 
} from '../../services/nbaService';
import { mockScoreboard, mockBoxScore } from '../../services/mockData';
import { GameStatus } from '../../types/enums';

describe('NBA Service', () => {
  describe('transformNBABoxScore', () => {
    it('should transform NBA box score data correctly', () => {
      const result = transformNBABoxScore(mockBoxScore.game);
      
      expect(result).toEqual({
        gameId: '0022300476',
        status: GameStatus.LIVE,
        period: 3,
        clock: '5:30',
        homeTeam: expect.objectContaining({
          score: 78
        }),
        awayTeam: expect.objectContaining({
          teamId: '1610612747',
          teamTricode: 'LAL',
          score: 72
        }),
        arena: 'TD Garden',
        attendance: 19156,
        lastUpdate: expect.any(Number)
      });
    });

    it('should throw error for invalid game data', () => {
      expect(() => transformNBABoxScore(null)).toThrow('Invalid game data');
    });
  });

  describe('getTodaysGames', () => {
    it('should fetch and transform games data', async () => {
      // Mock axios or use test data
      const games = await getTodaysGames();
      expect(Array.isArray(games)).toBe(true);
      if (games.length > 0) {
        expect(games[0]).toHaveProperty('gameId');
        expect(games[0]).toHaveProperty('status');
        expect(games[0]).toHaveProperty('homeTeam');
        expect(games[0]).toHaveProperty('awayTeam');
      }
    });
  });

  // ... other tests remain the same ...
}); 