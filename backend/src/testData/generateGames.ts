import { faker } from '@faker-js/faker';
import { GameScore, PlayerStats, TeamBoxScore, GameBoxScore } from '../types';
import { GameStatus } from '../types/enums';

const MOCK_GAME_ID_PREFIX = '0022400';

// Create a persistent store for players
interface TeamPlayers {
  [teamId: string]: {
    id: string;
    name: string;
    position: string;
  }[];
}

// Initialize persistent player data
const TEAM_PLAYERS: TeamPlayers = {};

// Define NBA teams
const NBA_TEAMS = [
  { teamId: '1', teamTricode: 'LAL', score: 0, stats: { rebounds: 0, assists: 0, blocks: 0 } },
  { teamId: '2', teamTricode: 'BOS', score: 0, stats: { rebounds: 0, assists: 0, blocks: 0 } },
  { teamId: '3', teamTricode: 'GSW', score: 0, stats: { rebounds: 0, assists: 0, blocks: 0 } },
  { teamId: '4', teamTricode: 'MIA', score: 0, stats: { rebounds: 0, assists: 0, blocks: 0 } },
  { teamId: '5', teamTricode: 'MIL', score: 0, stats: { rebounds: 0, assists: 0, blocks: 0 } },
  { teamId: '6', teamTricode: 'PHX', score: 0, stats: { rebounds: 0, assists: 0, blocks: 0 } },
  { teamId: '7', teamTricode: 'BKN', score: 0, stats: { rebounds: 0, assists: 0, blocks: 0 } },
  { teamId: '8', teamTricode: 'DEN', score: 0, stats: { rebounds: 0, assists: 0, blocks: 0 } },
];

// Initialize players for each team
NBA_TEAMS.forEach(team => {
  TEAM_PLAYERS[team.teamId] = Array.from({ length: 8 }, (_, i) => ({
    id: `${team.teamTricode}_${i + 1}`,
    name: faker.person.fullName(),
    position: faker.helpers.arrayElement(['G', 'F', 'C', 'F-C', 'G-F'])
  }));
});

const generateTeamStats = () => ({
  rebounds: faker.number.int({ min: 20, max: 60 }),
  assists: faker.number.int({ min: 15, max: 35 }),
  blocks: faker.number.int({ min: 2, max: 12 }),
});

const generateGameScore = (gameId: string, status: GameStatus): GameScore => {
  const teams = faker.helpers.shuffle([...NBA_TEAMS]);
  const homeTeam = teams[0];
  const awayTeam = teams[1];

  const baseGame = {
    gameId,
    status,
    period: status === GameStatus.SCHEDULED ? 0 : faker.number.int({ min: 1, max: 4 }),
    clock: status === GameStatus.SCHEDULED ? '' : `${faker.number.int({ min: 0, max: 11 })}:${faker.number.int({ min: 0, max: 59 }).toString().padStart(2, '0')}`,
  };

  if (status === GameStatus.SCHEDULED) {
    return {
      ...baseGame,
      homeTeam: {
        ...homeTeam,
        score: 0,
        stats: { rebounds: 0, assists: 0, blocks: 0 },
      },
      awayTeam: {
        ...awayTeam,
        score: 0,
        stats: { rebounds: 0, assists: 0, blocks: 0 },
      },
      lastUpdate: Date.now()
    };
  }

  return {
    ...baseGame,
    homeTeam: {
      ...homeTeam,
      score: faker.number.int({ min: 80, max: 130 }),
      stats: generateTeamStats(),
    },
    awayTeam: {
      ...awayTeam,
      score: faker.number.int({ min: 80, max: 130 }),
      stats: generateTeamStats(),
    },
    lastUpdate: Date.now()
  };
};

const generatePlayers = (teamId: string): PlayerStats[] => {
  const teamPlayers = TEAM_PLAYERS[teamId];
  if (!teamPlayers) {
    throw new Error(`No players found for team ${teamId}`);
  }

  return teamPlayers.map(player => ({
    playerId: player.id,
    name: player.name,
    position: player.position,
    minutes: faker.number.int({ min: 12, max: 40 }).toString(),
    points: faker.number.int({ min: 0, max: 30 }),
    rebounds: faker.number.int({ min: 0, max: 15 }),
    assists: faker.number.int({ min: 0, max: 12 }),
    steals: faker.number.int({ min: 0, max: 5 }),
    blocks: faker.number.int({ min: 0, max: 5 }),
    personalFouls: faker.number.int({ min: 0, max: 6 }),
    fgm: faker.number.int({ min: 0, max: 12 }),
    fga: faker.number.int({ min: 5, max: 20 }),
    threePm: faker.number.int({ min: 0, max: 8 }),
    threePa: faker.number.int({ min: 0, max: 12 }),
    ftm: faker.number.int({ min: 0, max: 10 }),
    fta: faker.number.int({ min: 0, max: 12 }),
    plusMinus: faker.number.int({ min: -20, max: 20 }),
  }));
};

export const generateBoxScore = (gameScore: GameScore): GameBoxScore => {
  return {
    ...gameScore,
    homeTeam: {
      ...gameScore.homeTeam,
      players: generatePlayers(gameScore.homeTeam.teamId),
      totals: {
        points: gameScore.homeTeam.score,
        ...generateTeamStats(),
        steals: faker.number.int({ min: 3, max: 12 }),
        personalFouls: faker.number.int({ min: 10, max: 25 }),
        fgm: faker.number.int({ min: 30, max: 45 }),
        fga: faker.number.int({ min: 70, max: 90 }),
        threePm: faker.number.int({ min: 8, max: 20 }),
        threePa: faker.number.int({ min: 25, max: 45 }),
        ftm: faker.number.int({ min: 10, max: 25 }),
        fta: faker.number.int({ min: 15, max: 30 }),
      }
    },
    awayTeam: {
      ...gameScore.awayTeam,
      players: generatePlayers(gameScore.awayTeam.teamId),
      totals: {
        points: gameScore.awayTeam.score,
        ...generateTeamStats(),
        steals: faker.number.int({ min: 3, max: 12 }),
        personalFouls: faker.number.int({ min: 10, max: 25 }),
        fgm: faker.number.int({ min: 30, max: 45 }),
        fga: faker.number.int({ min: 70, max: 90 }),
        threePm: faker.number.int({ min: 8, max: 20 }),
        threePa: faker.number.int({ min: 25, max: 45 }),
        ftm: faker.number.int({ min: 10, max: 25 }),
        fta: faker.number.int({ min: 15, max: 30 }),
      }
    },
    arena: faker.location.streetAddress(),
    attendance: faker.number.int({ min: 15000, max: 20000 }),
  };
};

export const generateGames = (count: number = 6): GameScore[] => {
  return Array.from({ length: count }, (_, index) => {
    const gameId = `${MOCK_GAME_ID_PREFIX}${(index + 1).toString().padStart(3, '0')}`;
    const status = faker.helpers.arrayElement([
      GameStatus.SCHEDULED,
      GameStatus.LIVE,
      GameStatus.FINAL
    ]);
    return generateGameScore(gameId, status);
  });
}; 