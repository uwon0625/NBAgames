"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mockBoxScore = exports.mockScoreboard = void 0;
exports.mockScoreboard = {
    scoreboard: {
        games: [
            {
                gameId: '0022300476',
                gameStatus: 2, // LIVE
                period: 3,
                gameClock: '5:30',
                homeTeam: {
                    teamId: 1610612738,
                    teamTricode: 'BOS',
                    score: 78,
                    statistics: {
                        reboundsTotal: '25',
                        assists: '15',
                        blocks: '3'
                    }
                },
                awayTeam: {
                    teamId: 1610612747,
                    teamTricode: 'LAL',
                    score: 72,
                    statistics: {
                        reboundsTotal: '22',
                        assists: '12',
                        blocks: '2'
                    }
                }
            }
        ]
    }
};
exports.mockBoxScore = {
    game: {
        gameId: '0022300476',
        gameStatus: 2,
        period: 3,
        gameClock: '5:30',
        arena: {
            arenaName: 'TD Garden'
        },
        attendance: 19156,
        homeTeam: {
            teamId: 1610612738,
            teamTricode: 'BOS',
            score: 78,
            statistics: {
                points: '78',
                reboundsTotal: '25',
                assists: '15',
                blocks: '3',
                steals: '5',
                foulsPersonal: '8',
                fieldGoalsMade: '30',
                fieldGoalsAttempted: '65',
                threePointersMade: '10',
                threePointersAttempted: '28',
                freeThrowsMade: '8',
                freeThrowsAttempted: '10'
            },
            players: [
                {
                    personId: '1629684',
                    name: 'Jayson Tatum',
                    position: 'F',
                    statistics: {
                        minutesCalculated: '28:45',
                        points: '25',
                        reboundsTotal: '8',
                        assists: '5',
                        steals: '2',
                        blocks: '1',
                        foulsPersonal: '2',
                        fieldGoalsMade: '9',
                        fieldGoalsAttempted: '18',
                        threePointersMade: '4',
                        threePointersAttempted: '9',
                        freeThrowsMade: '3',
                        freeThrowsAttempted: '4',
                        plusMinusPoints: '+12'
                    }
                }
            ]
        },
        awayTeam: {
            teamId: 1610612747,
            teamTricode: 'LAL',
            score: 72,
            statistics: {
                points: '72',
                reboundsTotal: '22',
                assists: '12',
                blocks: '2',
                steals: '4',
                foulsPersonal: '12',
                fieldGoalsMade: '28',
                fieldGoalsAttempted: '62',
                threePointersMade: '8',
                threePointersAttempted: '25',
                freeThrowsMade: '8',
                freeThrowsAttempted: '12'
            },
            players: [
                {
                    personId: '2544',
                    name: 'LeBron James',
                    position: 'F',
                    statistics: {
                        minutesCalculated: '30:15',
                        points: '28',
                        reboundsTotal: '7',
                        assists: '6',
                        steals: '1',
                        blocks: '1',
                        foulsPersonal: '1',
                        fieldGoalsMade: '11',
                        fieldGoalsAttempted: '20',
                        threePointersMade: '3',
                        threePointersAttempted: '8',
                        freeThrowsMade: '3',
                        freeThrowsAttempted: '4',
                        plusMinusPoints: '-8'
                    }
                }
            ]
        }
    }
};
//# sourceMappingURL=mockData.js.map