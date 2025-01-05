import { faker } from '@faker-js/faker';
import { GameScore, PlayerStats, TeamBoxScore, GameBoxScore } from '../types';

const NBA_TEAMS = [
  { teamId: '1', name: 'Los Angeles Lakers', abbreviation: 'LAL' },
  { teamId: '2', name: 'Boston Celtics', abbreviation: 'BOS' },
  { teamId: '3', name: 'Golden State Warriors', abbreviation: 'GSW' },
  { teamId: '4', name: 'Miami Heat', abbreviation: 'MIA' },
  { teamId: '5', name: 'Milwaukee Bucks', abbreviation: 'MIL' },
  { teamId: '6', name: 'Phoenix Suns', abbreviation: 'PHX' },
  { teamId: '7', name: 'Brooklyn Nets', abbreviation: 'BKN' },
  { teamId: '8', name: 'Denver Nuggets', abbreviation: 'DEN' },
];

const generateTeamStats = () => ({
  rebounds: faker.number.int({ min: 20, max: 60 }),
  assists: faker.number.int({ min: 15, max: 35 }),
  blocks: faker.number.int({ min: 2, max: 12 }),
});

const generateGameScore = (status: 'scheduled' | 'in_progress' | 'finished'): GameScore => {
  const teams = faker.helpers.shuffle([...NBA_TEAMS]);
  const homeTeam = teams[0];
  const awayTeam = teams[1];

  const baseGame = {
    gameId: faker.string.uuid(),
    status,
    period: status === 'scheduled' ? 0 : faker.number.int({ min: 1, max: 4 }),
    clock: status === 'scheduled' ? '' : `${faker.number.int({ min: 0, max: 11 })}:${faker.number.int({ min: 0, max: 59 }).toString().padStart(2, '0')}`,
    startTime: faker.date.soon({ days: 1 }).toISOString(),
  };

  if (status === 'scheduled') {
    return {
      ...baseGame,
      homeTeam: {
        teamId: homeTeam.teamId,
        name: homeTeam.name,
        abbreviation: homeTeam.abbreviation,
        score: 0,
        stats: { rebounds: 0, assists: 0, blocks: 0 },
      },
      awayTeam: {
        teamId: awayTeam.teamId,
        name: awayTeam.name,
        abbreviation: awayTeam.abbreviation,
        score: 0,
        stats: { rebounds: 0, assists: 0, blocks: 0 },
      },
    };
  }

  return {
    ...baseGame,
    homeTeam: {
      teamId: homeTeam.teamId,
      name: homeTeam.name,
      abbreviation: homeTeam.abbreviation,
      score: faker.number.int({ min: 80, max: 130 }),
      stats: generateTeamStats(),
    },
    awayTeam: {
      teamId: awayTeam.teamId,
      name: awayTeam.name,
      abbreviation: awayTeam.abbreviation,
      score: faker.number.int({ min: 80, max: 130 }),
      stats: generateTeamStats(),
    },
  };
};

const generatePlayerStats = (name: string): PlayerStats => ({
  playerId: faker.string.uuid(),
  name,
  position: faker.helpers.arrayElement(['G', 'F', 'C', 'G/F', 'F/C']),
  minutes: `${faker.number.int({ min: 12, max: 48 })}:${faker.number.int({ min: 0, max: 59 }).toString().padStart(2, '0')}`,
  points: faker.number.int({ min: 0, max: 40 }),
  rebounds: faker.number.int({ min: 0, max: 15 }),
  assists: faker.number.int({ min: 0, max: 12 }),
  steals: faker.number.int({ min: 0, max: 5 }),
  blocks: faker.number.int({ min: 0, max: 5 }),
  fgm: faker.number.int({ min: 0, max: 15 }),
  fga: faker.number.int({ min: 10, max: 25 }),
  threePm: faker.number.int({ min: 0, max: 8 }),
  threePa: faker.number.int({ min: 0, max: 12 }),
  ftm: faker.number.int({ min: 0, max: 10 }),
  fta: faker.number.int({ min: 0, max: 12 }),
  plusMinus: faker.number.int({ min: -20, max: 20 }),
});

const generateTeamBoxScore = (team: typeof NBA_TEAMS[0]): TeamBoxScore => {
  const players = Array.from({ length: 10 }, () => 
    generatePlayerStats(faker.person.fullName())
  );

  const totals = players.reduce((acc, player) => ({
    points: acc.points + player.points,
    rebounds: acc.rebounds + player.rebounds,
    assists: acc.assists + player.assists,
    steals: acc.steals + player.steals,
    blocks: acc.blocks + player.blocks,
    fgm: acc.fgm + player.fgm,
    fga: acc.fga + player.fga,
    threePm: acc.threePm + player.threePm,
    threePa: acc.threePa + player.threePa,
    ftm: acc.ftm + player.ftm,
    fta: acc.fta + player.fta,
  }), {
    points: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0,
    fgm: 0, fga: 0, threePm: 0, threePa: 0, ftm: 0, fta: 0,
  });

  return {
    ...team,
    players,
    totals,
    score: totals.points,
    stats: {
      rebounds: totals.rebounds,
      assists: totals.assists,
      blocks: totals.blocks,
    },
  };
};

export const generateBoxScore = (gameScore: GameScore): GameBoxScore => {
  const homeTeam = NBA_TEAMS.find(team => team.teamId === gameScore.homeTeam.teamId);
  const awayTeam = NBA_TEAMS.find(team => team.teamId === gameScore.awayTeam.teamId);

  if (!homeTeam || !awayTeam) {
    throw new Error('Team not found');
  }

  return {
    ...gameScore,
    homeTeam: generateTeamBoxScore(homeTeam),
    awayTeam: generateTeamBoxScore(awayTeam),
    arena: faker.location.streetAddress(),
    attendance: faker.number.int({ min: 15000, max: 20000 }),
  };
};

export const generateGames = (count: number = 6): GameScore[] => {
  return Array.from({ length: count }, () => {
    const status = faker.helpers.arrayElement(['scheduled', 'in_progress', 'finished'] as const);
    return generateGameScore(status);
  });
}; 