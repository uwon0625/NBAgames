export interface Team {
  id: string;
  name: string;
  abbreviation: string;
}

export interface TeamStats {
  rebounds: number;
  assists: number;
  blocks: number;
}

export interface Game {
  id: string;
  status: 'scheduled' | 'in_progress' | 'finished';
  startTime: string;
  period: string;
  homeTeam: Team;
  awayTeam: Team;
  homeTeamScore: number;
  awayTeamScore: number;
  homeTeamStats?: TeamStats;
  awayTeamStats?: TeamStats;
} 