import { GameBoxScore, PlayerStats, TeamBoxScore } from '../types';

const TEAMS = {
  LAL: {
    teamId: '1610612747',
    teamTricode: 'LAL',
    players: [
      { name: 'LeBron James', position: 'F' },
      { name: 'Anthony Davis', position: 'F-C' },
      { name: 'Austin Reaves', position: 'G' },
      { name: 'D\'Angelo Russell', position: 'G' },
      { name: 'Rui Hachimura', position: 'F' },
      { name: 'Taurean Prince', position: 'F' },
      { name: 'Christian Wood', position: 'C' },
      { name: 'Gabe Vincent', position: 'G' },
    ]
  },
  GSW: {
    teamId: '1610612744',
    teamTricode: 'GSW',
    players: [
      { name: 'Stephen Curry', position: 'G' },
      { name: 'Klay Thompson', position: 'G' },
      { name: 'Draymond Green', position: 'F' },
      { name: 'Andrew Wiggins', position: 'F' },
      { name: 'Chris Paul', position: 'G' },
      { name: 'Jonathan Kuminga', position: 'F' },
      { name: 'Kevon Looney', position: 'C' },
      { name: 'Gary Payton II', position: 'G' },
    ]
  }
};

function generatePlayerStats(playerInfo: { name: string, position: string }): PlayerStats {
  const minutes = Math.floor(Math.random() * 35) + 10;
  const fga = Math.floor(Math.random() * 15) + 5;
  const fgm = Math.floor(Math.random() * fga);
  const threePa = Math.floor(Math.random() * 8);
  const threePm = Math.floor(Math.random() * threePa);
  const fta = Math.floor(Math.random() * 8);
  const ftm = Math.floor(Math.random() * fta);
  
  return {
    playerId: playerInfo.name.toLowerCase().replace(/\s/g, '-'),
    name: playerInfo.name,
    position: playerInfo.position,
    minutes: `${Math.floor(minutes)}:${String(Math.floor(Math.random() * 60)).padStart(2, '0')}`,
    points: (fgm - threePm) * 2 + threePm * 3 + ftm,
    rebounds: Math.floor(Math.random() * 10),
    assists: Math.floor(Math.random() * 8),
    steals: Math.floor(Math.random() * 3),
    blocks: Math.floor(Math.random() * 2),
    personalFouls: Math.floor(Math.random() * 6),
    fgm,
    fga,
    threePm,
    threePa,
    ftm,
    fta,
    plusMinus: Math.floor(Math.random() * 30) - 15,
  };
}

function generateTeamStats(players: PlayerStats[]) {
  return {
    points: players.reduce((sum, p) => sum + p.points, 0),
    rebounds: players.reduce((sum, p) => sum + p.rebounds, 0),
    assists: players.reduce((sum, p) => sum + p.assists, 0),
    steals: players.reduce((sum, p) => sum + p.steals, 0),
    blocks: players.reduce((sum, p) => sum + p.blocks, 0),
    fgm: players.reduce((sum, p) => sum + p.fgm, 0),
    fga: players.reduce((sum, p) => sum + p.fga, 0),
    threePm: players.reduce((sum, p) => sum + p.threePm, 0),
    threePa: players.reduce((sum, p) => sum + p.threePa, 0),
    ftm: players.reduce((sum, p) => sum + p.ftm, 0),
    fta: players.reduce((sum, p) => sum + p.fta, 0),
    personalFouls: players.reduce((sum, p) => sum + p.personalFouls, 0)
  };
}

export function generateMockBoxScore(gameId: string): GameBoxScore {
  const homePlayers = TEAMS.LAL.players.map(generatePlayerStats);
  const awayPlayers = TEAMS.GSW.players.map(generatePlayerStats);

  const homeTotals = generateTeamStats(homePlayers);
  const awayTotals = generateTeamStats(awayPlayers);

  return {
    gameId,
    status: 'final',
    period: 4,
    clock: '0:00',
    arena: 'Crypto.com Arena',
    attendance: 18997,
    homeTeam: {
      teamId: TEAMS.LAL.teamId,
      teamTricode: TEAMS.LAL.teamTricode,
      score: homeTotals.points,
      players: homePlayers,
      totals: homeTotals,
      stats: {
        rebounds: homeTotals.rebounds,
        assists: homeTotals.assists,
        blocks: homeTotals.blocks,
      }
    },
    awayTeam: {
      teamId: TEAMS.GSW.teamId,
      teamTricode: TEAMS.GSW.teamTricode,
      score: awayTotals.points,
      players: awayPlayers,
      totals: awayTotals,
      stats: {
        rebounds: awayTotals.rebounds,
        assists: awayTotals.assists,
        blocks: awayTotals.blocks,
      }
    },
    lastUpdate: Date.now(),
  };
}

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
      }
    ]
  }
}; 