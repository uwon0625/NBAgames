import { Game, GameBoxScore } from '@/types/Game';
import { GameStatus } from '@/types/enums';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export async function fetchGame(gameId: string | null): Promise<Game | undefined> {
  if (!gameId) return undefined;
  
  try {
    const response = await fetch(`${API_BASE_URL}/api/games`);
    if (!response.ok) {
      throw new Error(`API responded with status: ${response.status}`);
    }
    const games = await response.json();
    const game = games.find((game: Game) => game.gameId === gameId);
    if (!game) {
      throw new Error(`Game ${gameId} not found`);
    }
    return game;
  } catch (error) {
    console.error('Failed to fetch game:', error);
    throw error;
  }
}

export async function getBoxScore(gameId: string, parentGame: Game): Promise<GameBoxScore> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/games/${gameId}/boxscore`, {
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
  } catch (error) {
    console.error('Failed to fetch box score:', error);
    throw error;
  }
} 