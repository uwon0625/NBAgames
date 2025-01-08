export interface Team {
  teamId: string;
  teamTricode: string;
  score: number;
  stats: {
    rebounds: number;
    assists: number;
    blocks: number;
  };
}

export interface GameScore {
  gameId: string;
  status: 'scheduled' | 'live' | 'final';
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

// Additional backend-specific types
export interface WebSocketMessage {
  type: string;
  data: GameScore | GameAlert;
}

export interface WebSocketConnection {
  connectionId: string;
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
  personalFouls: number;
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
    personalFouls: number;
  };
}

export interface GameBoxScore extends GameScore {
  homeTeam: TeamBoxScore;
  awayTeam: TeamBoxScore;
  arena?: string;
  attendance?: number;
}

export interface NBATeamStatistics {
  reboundsDefensive: string;
  reboundsOffensive: string;
  assists: string;
  blocks: string;
  fieldGoalsMade?: string;
  fieldGoalsAttempted?: string;
  threePointersMade?: string;
  threePointersAttempted?: string;
  freeThrowsMade?: string;
  freeThrowsAttempted?: string;
}

export interface NBATeamStats {
  totals: {
    points: number;
    rebounds: number;
    assists: number;
    blocks: number;
  };
}

export interface NBAPeriod {
  period: number;
  periodType: string;
  score: number;
}

export interface NBATeam {
  teamId: number;
  teamTricode: string;
  score: number;
  statistics?: NBATeamStatistics;
  teamStats?: NBATeamStats;
  periods: NBAPeriod[];
}

export interface NBAGameLeaders {
  personId: number;
  name: string;
  teamTricode: string;
  points: number;
  rebounds: number;
  assists: number;
}

export interface NBAGame {
  gameId: string;
  gameStatus: number;
  gameStatusText: string;
  period: number;
  gameClock: string;
  homeTeam: {
    teamId: number;
    teamTricode: string;
    score: number;
    statistics: {
      reboundsDefensive: string;
      reboundsOffensive: string;
      assists: string;
      blocks: string;
    };
  };
  awayTeam: {
    teamId: number;
    teamTricode: string;
    score: number;
    statistics: {
      reboundsDefensive: string;
      reboundsOffensive: string;
      assists: string;
      blocks: string;
    };
  };
  gameLeaders?: {
    homeLeaders: NBAGameLeaders;
    awayLeaders: NBAGameLeaders;
  };
} 