import { Game } from '@/types/Game';
import { GameBoxScore } from '@/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

// Get all games
export const fetchNBAGames = async (): Promise<Game[]> => {
  try {
    const response = await fetch(`${API_URL}/games`);
    if (!response.ok) {
      throw new Error(`API responded with status: ${response.status}`);
    }
    const data = await response.json();
    console.log('API response data:', data);
    return data;
  } catch (error) {
    console.error('Failed to fetch games:', error);
    throw error;
  }
};

// Get box score for a specific game
export const fetchGameBoxScore = async (gameId: string): Promise<GameBoxScore> => {
  const response = await fetch(`${API_URL}/games/${gameId}/boxscore`);
  if (!response.ok) {
    throw new Error(`API responded with status: ${response.status}`);
  }
  const data = await response.json();
  return data;
};

// Get live games
export const fetchLiveGames = async (): Promise<Game[]> => {
  const response = await fetch(`${API_URL}/games/live`);
  if (!response.ok) {
    throw new Error(`API responded with status: ${response.status}`);
  }
  const data = await response.json();
  return data;
}; 