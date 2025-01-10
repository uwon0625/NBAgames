import { 
  getGames, 
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
          teamId: '1610612738',
          teamTricode: 'BOS',
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

  // ... other tests remain the same ...
}); 