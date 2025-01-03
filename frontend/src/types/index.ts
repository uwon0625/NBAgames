export interface TeamStats {
  rebounds: number;
  assists: number;
  blocks: number;
}

export interface BaseTeam {
  id: string;
  name: string;
  score: number;
}

export interface GameTeam extends BaseTeam {
  abbreviation?: string;
  stats?: TeamStats;
}

export interface GameScore {
  gameId: string;
  status: 'scheduled' | 'in_progress' | 'finished';
  startTime: string | null;
  period: number;
  clock: string;
  homeTeam: GameTeam;
  awayTeam: GameTeam;
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

export interface TeamBoxScore extends BaseTeam {
  players: PlayerStats[];
  stats: TeamStats;
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

export interface GameBoxScore {
  gameId: string;
  status: 'scheduled' | 'in_progress' | 'finished';
  startTime: string | null;
  period: number;
  clock: string;
  homeTeam: TeamBoxScore;
  awayTeam: TeamBoxScore;
  arena?: string;
  attendance?: number;
} 