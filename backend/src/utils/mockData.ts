import { GameBoxScore, PlayerStats } from '../types';

const TEAMS = {
  LAL: {
    teamId: 'LAL',
    name: 'Los Angeles Lakers',
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
    teamId: 'GSW',
    name: 'Golden State Warriors',
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
    fgm,
    fga,
    threePm,
    threePa,
    ftm,
    fta,
    plusMinus: Math.floor(Math.random() * 30) - 15,
  };
}

function calculateTeamTotals(players: PlayerStats[]) {
  return players.reduce((totals, player) => ({
    points: totals.points + player.points,
    rebounds: totals.rebounds + player.rebounds,
    assists: totals.assists + player.assists,
    steals: totals.steals + player.steals,
    blocks: totals.blocks + player.blocks,
    fgm: totals.fgm + player.fgm,
    fga: totals.fga + player.fga,
    threePm: totals.threePm + player.threePm,
    threePa: totals.threePa + player.threePa,
    ftm: totals.ftm + player.ftm,
    fta: totals.fta + player.fta,
  }), {
    points: 0,
    rebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    fgm: 0,
    fga: 0,
    threePm: 0,
    threePa: 0,
    ftm: 0,
    fta: 0,
  });
}

export function generateMockBoxScore(gameId: string): GameBoxScore {
  // Use Lakers vs Warriors as example
  const homePlayers = TEAMS.LAL.players.map(generatePlayerStats);
  const awayPlayers = TEAMS.GSW.players.map(generatePlayerStats);

  const homeTotals = calculateTeamTotals(homePlayers);
  const awayTotals = calculateTeamTotals(awayPlayers);

  return {
    gameId,
    status: 'final',
    period: 4,
    clock: '0:00',
    arena: 'Crypto.com Arena',
    attendance: 18997,
    homeTeam: {
      teamId: TEAMS.LAL.teamId,
      name: TEAMS.LAL.name,
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
      name: TEAMS.GSW.name,
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