"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.transformNBAGames = transformNBAGames;
exports.getTodaysGames = getTodaysGames;
exports.transformNBABoxScore = transformNBABoxScore;
exports.getGameBoxScore = getGameBoxScore;
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("../config/logger");
const mockData_1 = require("./mockData");
const nbaApi_1 = require("../config/nbaApi");
const enums_1 = require("../types/enums");
function transformTeam(team) {
    if (!team) {
        logger_1.logger.error('Invalid team data received');
        throw new Error('Invalid team data');
    }
    // For basic game data, use statistics if available
    const score = parseInt(String(team.score || '0'));
    const stats = team.statistics || {};
    // Add debug logging
    logger_1.logger.debug(`Team ${team.teamTricode} raw data:`, {
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
    logger_1.logger.debug(`Team ${team.teamTricode} transformed:`, transformedTeam);
    return transformedTeam;
}
function getGameStatus(gameStatus) {
    switch (gameStatus) {
        case 2:
            return enums_1.GameStatus.LIVE;
        case 3:
            return enums_1.GameStatus.FINAL;
        default:
            return enums_1.GameStatus.SCHEDULED;
    }
}
function transformNBAGames(games) {
    if (!Array.isArray(games)) {
        logger_1.logger.error('Invalid games data received:', games);
        throw new Error('Invalid games data');
    }
    logger_1.logger.debug(`Transforming ${games.length} games`);
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
async function getTodaysGames() {
    try {
        logger_1.logger.info('Fetching today\'s games from NBA API');
        const response = await axios_1.default.get(nbaApi_1.nbaApiConfig.scoreboardUrl);
        if (response.status !== 200) {
            throw new Error(`NBA API responded with status: ${response.status}`);
        }
        // Log raw response for game 0022400531
        const targetGame = response.data.scoreboard.games.find((g) => g.gameId === '0022400531');
        if (targetGame) {
            logger_1.logger.debug('Raw data for game 0022400531:', {
                homeTeam: targetGame.homeTeam,
                awayTeam: targetGame.awayTeam
            });
        }
        const games = transformNBAGames(response.data.scoreboard.games);
        logger_1.logger.info(`Fetched ${games.length} games from NBA API`);
        return games;
    }
    catch (error) {
        logger_1.logger.error('Failed to fetch today\'s games:', error);
        throw error;
    }
}
function transformNBABoxScore(game) {
    var _a;
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
        arena: ((_a = game.arena) === null || _a === void 0 ? void 0 : _a.arenaName) || '',
        attendance: game.attendance || 0,
        lastUpdate: Date.now()
    };
}
async function getGameBoxScore(gameId) {
    try {
        if (process.env.USE_MOCK_DATA === 'true') {
            return transformNBABoxScore(mockData_1.mockBoxScore.game);
        }
        logger_1.logger.info(`Fetching box score for game ${gameId} -> ${nbaApi_1.nbaApiConfig.baseUrl}/boxscore/boxscore_${gameId}.json`);
        const response = await axios_1.default.get(`${nbaApi_1.nbaApiConfig.baseUrl}/boxscore/boxscore_${gameId}.json`);
        if (response.status === 200) {
            return transformNBABoxScore(response.data.game);
        }
        return null;
    }
    catch (error) {
        logger_1.logger.error(`Error fetching box score for game ${gameId}:`, error);
        return null;
    }
}
function transformBoxScoreTeam(team) {
    if (!team) {
        throw new Error('Invalid team data');
    }
    const stats = team.statistics || {};
    logger_1.logger.debug(`transformBoxScoreTeam > Team assists:${stats.assists}`);
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
function transformPlayerStats(player) {
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
function transformTeamTotals(stats) {
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
//# sourceMappingURL=nbaService.js.map