import dotenv from 'dotenv';
dotenv.config();

const NBA_BASE_URL = process.env.NBA_BASE_URL || 'https://nba-prod-us-east-1-mediaops-stats.s3.amazonaws.com/NBA/liveData';
const NBA_API_URL = `${NBA_BASE_URL}/scoreboard/todaysScoreboard_00.json`;

export const nbaApiConfig = {
  baseUrl: NBA_BASE_URL,
  scoreboardUrl: NBA_API_URL
}; 