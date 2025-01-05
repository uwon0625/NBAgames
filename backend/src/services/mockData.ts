export const mockScoreboard = {
  scoreboard: {
    games: [
      {
        gameId: '0022400476',
        gameStatus: 2,
        period: 3,
        gameClock: 'PT05M30.00S',
        homeTeam: {
          teamId: 1610612758,
          teamTricode: 'SAC',
          score: 100,
          teamStats: {
            totals: {
              points: 100,
              rebounds: 40,
              assists: 25,
              blocks: 5
            }
          }
        },
        awayTeam: {
          teamId: 1610612763,
          teamTricode: 'MEM',
          score: 100,
          teamStats: {
            totals: {
              points: 100,
              rebounds: 40,
              assists: 22,
              blocks: 4
            }
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
    gameClock: "PT05M30.00S",
    homeTeam: {
      teamId: 1610612747,
      teamCity: "Los Angeles",
      teamName: "Lakers",
      teamTricode: "LAL",
      score: 85,
      statistics: {
        reboundsDefensive: "25",
        reboundsOffensive: "10",
        assists: "20",
        blocks: "5",
        fieldGoalsMade: "32",
        fieldGoalsAttempted: "65",
        threePointersMade: "10",
        threePointersAttempted: "25",
        freeThrowsMade: "11",
        freeThrowsAttempted: "15"
      },
      players: [
        {
          personId: "2544",
          firstName: "LeBron",
          familyName: "James",
          position: "F",
          statistics: {
            minutesCalculated: "PT00M00S",
            points: "0",
            reboundsDefensive: "0",
            reboundsOffensive: "0",
            assists: "0",
            steals: "0",
            blocks: "0",
            fieldGoalsMade: "0",
            fieldGoalsAttempted: "0",
            threePointersMade: "0",
            threePointersAttempted: "0",
            freeThrowsMade: "0",
            freeThrowsAttempted: "0",
            plusMinusPoints: "0"
          }
        }
        // Add more players
      ]
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
      players: [
        {
          personId: "2544",
          firstName: "LeBron",
          familyName: "James",
          position: "F",
          statistics: {
            minutesCalculated: "PT00M00S",
            points: "0",
            reboundsDefensive: "0",
            reboundsOffensive: "0",
            assists: "0",
            steals: "0",
            blocks: "0",
            fieldGoalsMade: "0",
            fieldGoalsAttempted: "0",
            threePointersMade: "0",
            threePointersAttempted: "0",
            freeThrowsMade: "0",
            freeThrowsAttempted: "0",
            plusMinusPoints: "0"
          }
        }
        // Add more players
      ]
    },
    arena: {
      arenaName: "Crypto.com Arena"
    },
    attendance: 18997
  }
}; 