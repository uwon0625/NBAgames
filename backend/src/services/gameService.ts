import axios from 'axios';
import { GameScore, TeamBoxScore, GameBoxScore, PlayerStats } from '../types';
import { generateGames } from '../testData/generateGames';
import { logger } from '../config/logger';

export class GameService {
  private readonly NBA_API_URL = process.env.NBA_API_URL || '';
  private readonly NBA_BASE_URL = process.env.NBA_BASE_URL || '';
  private lastGameData: Map<string, GameScore> = new Map();

  private logApiRequest(endpoint: string, url: string) {
    console.log(`=== NBA API REQUEST [${endpoint}] ===`);
    console.log('URL:', url);
    console.log('BASE_URL:', this.NBA_BASE_URL);
    console.log('API_URL:', this.NBA_API_URL);
    console.log('========================');
  }

  private transformNBAData(nbaData: any): GameScore[] {
    try {
      return nbaData.scoreboard.games.map((game: any) => {
        const homeTeam: TeamBoxScore = {
          teamId: game.homeTeam.teamId,
          teamTricode: game.homeTeam.teamTricode,
          score: parseInt(game.homeTeam.score || '0'),
          stats: {
            rebounds: 0,
            assists: 0,
            blocks: 0
          },
          players: [],
          totals: {
            points: parseInt(game.homeTeam.score || '0'),
            rebounds: 0,
            assists: 0,
            steals: 0,
            blocks: 0,
            personalFouls: 0,
            fgm: 0,
            fga: 0,
            threePm: 0,
            threePa: 0,
            ftm: 0,
            fta: 0
          }
        };

        const awayTeam: TeamBoxScore = {
          teamId: game.awayTeam.teamId,
          teamTricode: game.awayTeam.teamTricode,
          score: parseInt(game.awayTeam.score || '0'),
          stats: {
            rebounds: 0,
            assists: 0,
            blocks: 0
          },
          players: [],
          totals: {
            points: parseInt(game.awayTeam.score || '0'),
            rebounds: 0,
            assists: 0,
            steals: 0,
            blocks: 0,
            personalFouls: 0,
            fgm: 0,
            fga: 0,
            threePm: 0,
            threePa: 0,
            ftm: 0,
            fta: 0
          }
        };

        return {
          gameId: game.gameId,
          status: game.gameStatus || 1,
          period: game.period || 1,
          clock: '',
          homeTeam,
          awayTeam,
          arena: '',
          attendance: 0
        };
      });
    } catch (error) {
      logger.error('Error transforming NBA data:', error);
      throw error;
    }
  }

  async getGames(): Promise<{ games: GameScore[], changedGameIds: string[] }> {
    try {
      let games: GameScore[];
      
      if (process.env.USE_MOCK_DATA === 'true') {
        games = generateGames();
      } else {
        this.logApiRequest('SCOREBOARD', this.NBA_API_URL);
        const response = await axios.get(this.NBA_API_URL);
        
        console.log('Games count:', response.data.scoreboard.games.length);
        console.log('First game ID:', response.data.scoreboard.games[0]?.gameId);
        
        games = this.transformNBAData(response.data);
      }

      // Detect changes
      const changedGameIds = games.filter(game => {
        const lastGame = this.lastGameData.get(game.gameId);
        if (!lastGame) return true;

        return JSON.stringify(game) !== JSON.stringify(lastGame);
      }).map(game => game.gameId);

      // Update cache
      games.forEach(game => {
        this.lastGameData.set(game.gameId, game);
      });

      return { games, changedGameIds };
    } catch (error) {
      logger.error('Error fetching games:', error);
      throw error;
    }
  }

  async getBoxScore(gameId: string): Promise<GameBoxScore | null> {
    try {
      if (process.env.USE_MOCK_DATA === 'true') {
        return null;
      }

      const boxScoreUrl = `${this.NBA_BASE_URL}/boxscore_${gameId}.json`;
      
      console.log('\n=== BOX SCORE REQUEST DETAILS ===');
      console.log('Game ID:', gameId);
      console.log('Full URL:', boxScoreUrl);
      console.log('BASE_URL:', this.NBA_BASE_URL);
      console.log('================================\n');

      try {
        const response = await axios.get(boxScoreUrl);
        console.log('Box Score Response:', {
          status: response.status,
          hasGame: !!response.data.game,
          gameId: response.data.game?.gameId,
          url: boxScoreUrl
        });

        const game = response.data.game;
        if (!game) {
          logger.error('No game data found in response');
          return null;
        }

        return this.transformBoxScoreData(response.data);
      } catch (axiosError: any) {
        // Log detailed error information
        console.error('\n=== BOX SCORE REQUEST ERROR ===');
        console.error('Request URL:', boxScoreUrl);
        console.error('Error Status:', axiosError.response?.status);
        console.error('Error Message:', axiosError.message);
        console.error('Error Response:', axiosError.response?.data);
        console.error('==============================\n');
        throw axiosError;
      }
    } catch (error) {
      logger.error(`Error fetching box score for game ${gameId}:`, {
        error,
        requestedUrl: `${this.NBA_BASE_URL}/boxscore/boxscore_${gameId}.json`
      });
      return null;
    }
  }

  private transformBoxScoreData(data: any): GameBoxScore {
    try {
      const game = data.game;

      // Log team totals
      logger.debug('Team Totals:', {
        homeTeam: game.homeTeam.statistics,
        awayTeam: game.awayTeam.statistics
      });

      // Log first player from each team
      if (game.homeTeam.players?.length > 0) {
        logger.debug('Sample Home Player:', {
          player: game.homeTeam.players[0],
          statistics: game.homeTeam.players[0].statistics
        });
      }

      if (game.awayTeam.players?.length > 0) {
        logger.debug('Sample Away Player:', {
          player: game.awayTeam.players[0],
          statistics: game.awayTeam.players[0].statistics
        });
      }

      // If no valid game data, return null
      if (!game || !game.homeTeam || !game.awayTeam) {
        logger.error('Invalid game data structure:', data);
        return null as any; // TypeScript workaround
      }

      return {
        gameId: game.gameId,
        status: game.gameStatus || 1,
        period: parseInt(game.period || '0'),
        clock: game.gameClock || '',
        lastUpdate: Date.now(),
        homeTeam: {
          teamId: game.homeTeam.teamId,
          teamTricode: game.homeTeam.teamTricode,
          score: parseInt(game.homeTeam.score || '0'),
          stats: {
            rebounds: parseInt(game.homeTeam.statistics?.reboundsTotal || '0'),
            assists: parseInt(game.homeTeam.statistics?.assists || '0'),
            blocks: parseInt(game.homeTeam.statistics?.blocks || '0')
          },
          players: Array.isArray(game.homeTeam.players) 
            ? game.homeTeam.players.map(this.transformPlayerStats)
            : [],
          totals: {
            points: parseInt(game.homeTeam.score || '0'),
            rebounds: parseInt(game.homeTeam.statistics?.reboundsTotal || '0'),
            assists: parseInt(game.homeTeam.statistics?.assists || '0'),
            steals: parseInt(game.homeTeam.statistics?.steals || '0'),
            blocks: parseInt(game.homeTeam.statistics?.blocks || '0'),
            personalFouls: parseInt(game.homeTeam.statistics?.foulsPersonal || '0'),
            fgm: parseInt(game.homeTeam.statistics?.fieldGoalsMade || '0'),
            fga: parseInt(game.homeTeam.statistics?.fieldGoalsAttempted || '0'),
            threePm: parseInt(game.homeTeam.statistics?.threePointersMade || '0'),
            threePa: parseInt(game.homeTeam.statistics?.threePointersAttempted || '0'),
            ftm: parseInt(game.homeTeam.statistics?.freeThrowsMade || '0'),
            fta: parseInt(game.homeTeam.statistics?.freeThrowsAttempted || '0')
          }
        },
        awayTeam: {
          teamId: game.awayTeam.teamId,
          teamTricode: game.awayTeam.teamTricode,
          score: parseInt(game.awayTeam.score || '0'),
          stats: {
            rebounds: parseInt(game.awayTeam.statistics?.reboundsTotal || '0'),
            assists: parseInt(game.awayTeam.statistics?.assists || '0'),
            blocks: parseInt(game.awayTeam.statistics?.blocks || '0')
          },
          players: Array.isArray(game.awayTeam.players)
            ? game.awayTeam.players.map(this.transformPlayerStats)
            : [],
          totals: {
            points: parseInt(game.awayTeam.score || '0'),
            rebounds: parseInt(game.awayTeam.statistics?.reboundsTotal || '0'),
            assists: parseInt(game.awayTeam.statistics?.assists || '0'),
            steals: parseInt(game.awayTeam.statistics?.steals || '0'),
            blocks: parseInt(game.awayTeam.statistics?.blocks || '0'),
            personalFouls: parseInt(game.awayTeam.statistics?.foulsPersonal || '0'),
            fgm: parseInt(game.awayTeam.statistics?.fieldGoalsMade || '0'),
            fga: parseInt(game.awayTeam.statistics?.fieldGoalsAttempted || '0'),
            threePm: parseInt(game.awayTeam.statistics?.threePointersMade || '0'),
            threePa: parseInt(game.awayTeam.statistics?.threePointersAttempted || '0'),
            ftm: parseInt(game.awayTeam.statistics?.freeThrowsMade || '0'),
            fta: parseInt(game.awayTeam.statistics?.freeThrowsAttempted || '0')
          }
        }
      };
    } catch (error) {
      logger.error('Error transforming box score data:', error);
      throw error;
    }
  }

  private transformPlayerStats(player: any): PlayerStats {
    // Based on the sample data structure
    return {
      playerId: player.personId,
      name: player.name,
      position: player.position || '',
      minutes: player.statistics?.minutesCalculated || '0:00',
      points: parseInt(player.statistics?.points || '0'),
      rebounds: parseInt(player.statistics?.reboundsTotal || '0'),
      assists: parseInt(player.statistics?.assists || '0'),
      steals: parseInt(player.statistics?.steals || '0'),
      blocks: parseInt(player.statistics?.blocks || '0'),
      personalFouls: parseInt(player.statistics?.foulsPersonal || '0'),
      fgm: parseInt(player.statistics?.fieldGoalsMade || '0'),
      fga: parseInt(player.statistics?.fieldGoalsAttempted || '0'),
      threePm: parseInt(player.statistics?.threePointersMade || '0'),
      threePa: parseInt(player.statistics?.threePointersAttempted || '0'),
      ftm: parseInt(player.statistics?.freeThrowsMade || '0'),
      fta: parseInt(player.statistics?.freeThrowsAttempted || '0'),
      plusMinus: parseInt(player.statistics?.plusMinusPoints || '0')
    };
  }
} 