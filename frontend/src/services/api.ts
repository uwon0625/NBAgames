import { Game, GameBoxScore } from '@/types/Game';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

export async function fetchGames(): Promise<Game[]> {
  const response = await fetch(`${API_BASE_URL}/games`);
  if (!response.ok) {
    throw new Error(`API responded with status: ${response.status}`);
  }
  return response.json();
}

export async function fetchBoxScore(gameId: string, status: string = 'scheduled') {
  const url = `${API_BASE_URL}/games/${gameId}/boxscore?status=${status}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`API responded with status: ${response.status}`);
  }
  return response.json();
}

export async function getBoxScore(gameId: string, parentGame: Game): Promise<GameBoxScore> {
  const response = await fetch(`${API_BASE_URL}/games/${gameId}/boxscore`, {
    headers: {
      'Content-Type': 'application/json',
      'x-parent-game-status': parentGame.status,
      'x-parent-game-clock': parentGame.clock
    }
  });
  if (!response.ok) {
    throw new Error(`API responded with status: ${response.status}`);
  }
  return response.json();
}

export async function fetchGame(gameId: string | null): Promise<Game | undefined> {
  if (!gameId) return undefined;
  
  const games = await fetchGames();
  return games.find(game => game.gameId === gameId);
} 