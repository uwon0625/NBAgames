import { transformNBABoxScore } from '../../services/nbaService';
import { GameBoxScore } from '../../types';

describe('nbaService', () => {
  describe('transformNBABoxScore', () => {
    it('transforms NBA box score data correctly', () => {
      const mockNBABoxScore = {
        gameId: '0022300476',
        gameStatus: 2,
        period: 2,
        gameClock: 'PT00M23.70S',
        homeTeam: {
          teamId: 1610612747,
          teamTricode: 'LAL',
          score: 55,
          statistics: {
            reboundsDefensive: '15',
            reboundsOffensive: '5',
            assists: '15',
            blocks: '3',
            fieldGoalsMade: '22',
            fieldGoalsAttempted: '45',
            threePointersMade: '8',
            threePointersAttempted: '20',
            freeThrowsMade: '3',
            freeThrowsAttempted: '5',
            foulsPersonal: '12'
          }
        },
        awayTeam: {
          teamId: 1610612744,
          teamTricode: 'GSW',
          score: 60,
          statistics: {
            reboundsDefensive: '17',
            reboundsOffensive: '5',
            assists: '18',
            blocks: '2',
            fieldGoalsMade: '25',
            fieldGoalsAttempted: '50',
            threePointersMade: '10',
            threePointersAttempted: '25',
            freeThrowsMade: '0',
            freeThrowsAttempted: '0',
            foulsPersonal: '15'
          }
        },
        arena: {
          arenaName: 'Crypto.com Arena'
        },
        attendance: 18997
      };

      const result = transformNBABoxScore(mockNBABoxScore);

      expect(result).toMatchObject({
        gameId: '0022300476',
        status: 'scheduled',
        period: 2,
        clock: 'PT00M23.70S',
        homeTeam: {
          teamId: '1610612747',
          teamTricode: 'LAL',
          score: 55,
          totals: {
            points: 55,
            rebounds: 20,
            assists: 15,
            blocks: 3,
            fgm: 22,
            fga: 45,
            threePm: 8,
            threePa: 20,
            ftm: 3,
            fta: 5,
            personalFouls: 12
          },
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
          totals: {
            points: 60,
            rebounds: 22,
            assists: 18,
            blocks: 2,
            fgm: 25,
            fga: 50,
            threePm: 10,
            threePa: 25,
            ftm: 0,
            fta: 0,
            personalFouls: 15
          },
          stats: {
            rebounds: 22,
            assists: 18,
            blocks: 2
          }
        },
        arena: 'Crypto.com Arena',
        attendance: 18997
      });
    });
  });
}); 