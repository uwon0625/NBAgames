export const mockScoreboard = {
  scoreboard: {
    games: [
      {
        // Live game
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
          score: 98,
          statistics: {
            reboundsDefensive: '28',
            reboundsOffensive: '12',
            assists: '22',
            blocks: '4'
          }
        }
      },
      {
        // Finished game
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
            reboundsDefensive: '35',
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
            reboundsDefensive: '32',
            reboundsOffensive: '9',
            assists: '25',
            blocks: '3'
          }
        }
      },
      {
        // Scheduled game
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
          playerId: "2544",
          name: "LeBron James",
          position: "F",
          minutes: "28:35",
          points: 25,
          rebounds: 8,
          assists: 8,
          steals: 2,
          blocks: 1,
          personalFouls: 2,
          fgm: 10,
          fga: 15,
          threePm: 3,
          threePa: 6,
          ftm: 2,
          fta: 3,
          plusMinus: 12
        }
      ]
    },
    awayTeam: {
      teamId: 1610612763,
      teamTricode: 'MEM',
      score: 82,
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
          playerId: "1628991",
          name: "Ja Morant",
          position: "G",
          minutes: "26:42",
          points: 22,
          rebounds: 4,
          assists: 9,
          steals: 1,
          blocks: 0,
          personalFouls: 3,
          fgm: 8,
          fga: 14,
          threePm: 2,
          threePa: 5,
          ftm: 4,
          fta: 5,
          plusMinus: -8
        }
      ]
    },
    arena: {
      arenaName: "Crypto.com Arena"
    },
    attendance: 18997
  }
}; 