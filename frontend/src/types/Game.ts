import { GameStatus } from './enums';

export interface TeamStats {
  rebounds: number;
  assists: number;
  blocks: number;
}

export interface Team {
  teamId: string;
  teamTricode: string;
  score: number;
  stats: TeamStats;
}

export interface Game {
  gameId: string;
  status: GameStatus;
  period: number;
  clock: string;
  homeTeam: Team;
  awayTeam: Team;
  lastUpdate: number;
}

export interface PlayerStats {
  playerId: string;
  name: string;
  position: string;
  minutes: string;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  personalFouls: number;
  fgm: number;
  fga: number;
  threePm: number;
  threePa: number;
  ftm: number;
  fta: number;
  plusMinus: number;
}

export interface TeamBoxScore {
  id: string;
  teamId: string;
  teamTricode: string;
  score: number;
  players: PlayerStats[];
  totals: TeamTotals;
  stats: TeamStats;
}

export interface TeamTotals {
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  personalFouls: number;
  fgm: number;
  fga: number;
  threePm: number;
  threePa: number;
  ftm: number;
  fta: number;
}

export interface GameBoxScore {
  gameId: string;
  status: GameStatus;
  period: number;
  clock: string;
  startTime: string;
  homeTeam: TeamBoxScore;
  awayTeam: TeamBoxScore;
  arena?: string;
  attendance?: number;
  lastUpdate: number;
} 