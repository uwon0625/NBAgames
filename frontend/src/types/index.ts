export interface TeamStats {
  rebounds: number;
  assists: number;
  blocks: number;
}

export interface Team {
  teamId: string;
  name: string;
  score: number;
  stats: TeamStats;
}

export interface GameScore {
  gameId: string;
  status: string;
  period: number;
  clock: string;
  homeTeam: Team;
  awayTeam: Team;
  lastUpdate: number;
}

export interface GameAlert {
  gameId: string;
  type: 'SCORE_UPDATE' | 'GAME_START' | 'GAME_END' | 'QUARTER_END';
  message: string;
  timestamp: number;
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
  fgm: number;
  fga: number;
  threePm: number;
  threePa: number;
  ftm: number;
  fta: number;
  plusMinus: number;
}

export interface TeamBoxScore extends Team {
  players: PlayerStats[];
  totals: {
    points: number;
    rebounds: number;
    assists: number;
    steals: number;
    blocks: number;
    fgm: number;
    fga: number;
    threePm: number;
    threePa: number;
    ftm: number;
    fta: number;
  };
}

export interface GameBoxScore extends GameScore {
  homeTeam: TeamBoxScore;
  awayTeam: TeamBoxScore;
  arena?: string;
  attendance?: number;
} 