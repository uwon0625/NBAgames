import axios from 'axios';
import { logger } from '../config/logger';
import { GameScore, GameBoxScore, NBAGame, Team, TeamBoxScore } from '../types';
import { mockScoreboard, mockBoxScore as mockBoxScoreData } from './mockData';
import { nbaApiConfig } from '../config/nbaApi';
import { GameStatus } from '../types/enums';

function transformTeam(team: any): Team {
  if (!team) {
    logger.error('Invalid team data received');
    throw new Error('Invalid team data');
  }

  // For basic game data, use statistics if available
  const score = parseInt(String(team.score || '0'));
  const stats = team.statistics || {};
  
  // Add debug logging
  logger.debug(`Team ${team.teamTricode} raw data:`, {
    teamId: team.teamId,
    score: score,
    statistics: team.statistics
  });

  const transformedTeam = {
    teamId: team.teamId.toString(),
    teamTricode: team.teamTricode,
    score: score,
    stats: {
      rebounds: parseInt(String(stats.reboundsTotal || '0')),
      assists: parseInt(String(stats.assists || '0')),
      blocks: parseInt(String(stats.blocks || '0'))
    }
  };

  // Log transformed result
  logger.debug(`Team ${team.teamTricode} transformed:`, transformedTeam);

  return transformedTeam;
}

function getGameStatus(gameStatus: number): GameStatus {
  switch (gameStatus) {
    case 2:
      return GameStatus.LIVE;
    case 3:
      return GameStatus.FINAL;
    default:
      return GameStatus.SCHEDULED;
  }
}

export function transformNBAGames(games: any[]): GameScore[] {
  if (!Array.isArray(games)) {
    logger.error('Invalid games data received:', games);
    throw new Error('Invalid games data');
  }

  logger.debug(`Transforming ${games.length} games`);
  return games.map(game => {
    const transformed = {
      gameId: game.gameId,
      status: getGameStatus(game.gameStatus),
      period: game.period || 0,
      clock: game.gameClock || '',
      homeTeam: transformTeam(game.homeTeam),
      awayTeam: transformTeam(game.awayTeam),
      lastUpdate: Date.now()
    };
    return transformed;
  });
}

export async function getTodaysGames(): Promise<GameScore[]> {
  try {
    logger.info('Fetching today\'s games from NBA API');
    const response = await axios.get(nbaApiConfig.scoreboardUrl);
    
    if (response.status !== 200) {
      throw new Error(`NBA API responded with status: ${response.status}`);
    }

    // Log raw response for game 0022400531
    const targetGame = response.data.scoreboard.games.find((g: any) => g.gameId === '0022400531');
    if (targetGame) {
      logger.debug('Raw data for game 0022400531:', {
        homeTeam: targetGame.homeTeam,
        awayTeam: targetGame.awayTeam
      });
    }

    const games = transformNBAGames(response.data.scoreboard.games);
    logger.info(`Fetched ${games.length} games from NBA API`);
    return games;
  } catch (error) {
    logger.error('Failed to fetch today\'s games:', error);
    throw error;
  }
}

export function transformNBABoxScore(game: any): GameBoxScore {
  if (!game) {
    throw new Error('Invalid game data');
  }

  return {
    gameId: game.gameId,
    status: getGameStatus(game.gameStatus),
    period: game.period,
    clock: game.gameClock || '',
    homeTeam: transformBoxScoreTeam(game.homeTeam),
    awayTeam: transformBoxScoreTeam(game.awayTeam),
    arena: game.arena?.arenaName || '',
    attendance: game.attendance || 0,
    lastUpdate: Date.now()
  };
}

export async function getGameBoxScore(gameId: string): Promise<GameBoxScore | null> {
  try {
    if (process.env.USE_MOCK_DATA === 'true') {
      return transformNBABoxScore(mockBoxScoreData.game);
    }

    logger.info(`Fetching box score for game ${gameId} -> ${nbaApiConfig.baseUrl}/boxscore/boxscore_${gameId}.json`);
    const response = await axios.get(`${nbaApiConfig.baseUrl}/boxscore/boxscore_${gameId}.json`);
    if (response.status === 200) {
      return transformNBABoxScore(response.data.game);
    }
    return null;
  } catch (error) {
    logger.error(`Error fetching box score for game ${gameId}:`, error);
    return null;
  }
}

function transformBoxScoreTeam(team: any): TeamBoxScore {
  if (!team) {
    throw new Error('Invalid team data');
  }

  const stats = team.statistics || {};
  logger.debug(`transformBoxScoreTeam > Team assists:${stats.assists}`);
  return {
    teamId: team.teamId.toString(),
    teamTricode: team.teamTricode,
    score: parseInt(String(team.score || '0')),
    players: (team.players || []).map(transformPlayerStats),
    totals: transformTeamTotals(stats),
    stats: {
      rebounds: parseInt(String(stats.reboundsTotal || '0')),
      assists: parseInt(String(stats.assists || '0')),
      blocks: parseInt(String(stats.blocks || '0'))
    }
  };
}

function transformPlayerStats(player: any) {
  const stats = player.statistics || {};
  return {
    playerId: player.personId,
    name: player.name,
    position: player.position || '',
    minutes: stats.minutesCalculated || '0:00',
    points: parseInt(String(stats.points || '0')),
    rebounds: parseInt(String(stats.reboundsTotal || '0')),
    assists: parseInt(String(stats.assists || '0')),
    steals: parseInt(String(stats.steals || '0')),
    blocks: parseInt(String(stats.blocks || '0')),
    personalFouls: parseInt(String(stats.foulsPersonal || '0')),
    fgm: parseInt(String(stats.fieldGoalsMade || '0')),
    fga: parseInt(String(stats.fieldGoalsAttempted || '0')),
    threePm: parseInt(String(stats.threePointersMade || '0')),
    threePa: parseInt(String(stats.threePointersAttempted || '0')),
    ftm: parseInt(String(stats.freeThrowsMade || '0')),
    fta: parseInt(String(stats.freeThrowsAttempted || '0')),
    plusMinus: parseInt(String(stats.plusMinusPoints || '0'))
  };
}

function transformTeamTotals(stats: any) {
  return {
    points: parseInt(String(stats.points || '0')),
    rebounds: parseInt(String(stats.reboundsTotal || '0')),
    assists: parseInt(String(stats.assists || '0')),
    steals: parseInt(String(stats.steals || '0')),
    blocks: parseInt(String(stats.blocks || '0')),
    personalFouls: parseInt(String(stats.foulsPersonal || '0')),
    fgm: parseInt(String(stats.fieldGoalsMade || '0')),
    fga: parseInt(String(stats.fieldGoalsAttempted || '0')),
    threePm: parseInt(String(stats.threePointersMade || '0')),
    threePa: parseInt(String(stats.threePointersAttempted || '0')),
    ftm: parseInt(String(stats.freeThrowsMade || '0')),
    fta: parseInt(String(stats.freeThrowsAttempted || '0'))
  };
} 