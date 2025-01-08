export const mockScoreboard = {
  scoreboard: {
    games: [
      {
        gameId: '0022400476',
        gameStatus: 2,
        gameStatusText: 'In Progress',
        period: 3,
        gameClock: 'PT05M30.00S',
        homeTeam: {
          teamId: 1610612758,
          teamTricode: 'SAC',
          score: 100,
          statistics: {
            reboundsDefensive: '30',
            reboundsOffensive: '10',
            assists: '25',
            blocks: '5'
          }
        },
        awayTeam: {
          teamId: 1610612763,
          teamTricode: 'MEM',
          score: 100,
          statistics: {
            reboundsDefensive: '28',
            reboundsOffensive: '12',
            assists: '22',
            blocks: '4'
          }
        }
      },
      {
        gameId: '0022400477',
        gameStatus: 3,
        gameStatusText: 'Final',
        period: 4,
        gameClock: '',
        homeTeam: {
          teamId: 1610612744,
          teamTricode: 'GSW',
          score: 120,
          statistics: {
            reboundsDefensive: '32',
            reboundsOffensive: '8',
            assists: '30',
            blocks: '6'
          }
        },
        awayTeam: {
          teamId: 1610612747,
          teamTricode: 'LAL',
          score: 115,
          statistics: {
            reboundsDefensive: '30',
            reboundsOffensive: '10',
            assists: '25',
            blocks: '4'
          }
        }
      },
      {
        gameId: '0022400478',
        gameStatus: 1,
        gameStatusText: 'Scheduled',
        period: 0,
        gameClock: '',
        homeTeam: {
          teamId: 1610612738,
          teamTricode: 'BOS',
          score: 0,
          statistics: {
            reboundsDefensive: '0',
            reboundsOffensive: '0',
            assists: '0',
            blocks: '0'
          }
        },
        awayTeam: {
          teamId: 1610612751,
          teamTricode: 'BKN',
          score: 0,
          statistics: {
            reboundsDefensive: '0',
            reboundsOffensive: '0',
            assists: '0',
            blocks: '0'
          }
        }
      }
    ]
  }
};

export const mockBoxScore = {
  game: {
    gameId: "0022400476",
    gameStatus: 2,
    period: 3,
    gameClock: 'PT05M30.00S',
    homeTeam: {
      teamId: 1610612758,
      teamTricode: 'SAC',
      score: 100,
      statistics: {
        reboundsDefensive: '30',
        reboundsOffensive: '10',
        assists: '25',
        blocks: '5',
        fieldGoalsMade: '38',
        fieldGoalsAttempted: '75',
        threePointersMade: '10',
        threePointersAttempted: '28',
        freeThrowsMade: '14',
        freeThrowsAttempted: '18'
      },
      players: []
    },
    awayTeam: {
      teamId: 1610612763,
      teamTricode: 'MEM',
      score: 100,
      statistics: {
        reboundsDefensive: '28',
        reboundsOffensive: '12',
        assists: '22',
        blocks: '4',
        fieldGoalsMade: '38',
        fieldGoalsAttempted: '75',
        threePointersMade: '10',
        threePointersAttempted: '28',
        freeThrowsMade: '14',
        freeThrowsAttempted: '18'
      },
      players: []
    },
    arena: "Golden 1 Center",
    attendance: 17583
  }
}; 