import { Game, GameBoxScore } from '@/types/Game';
import { GameStatus } from '@/types/enums';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export async function fetchGame(gameId: string | null): Promise<Game> {
  if (!gameId) {
    throw new Error('Game ID is required');
  }
  
  try {
    // First try to get the specific game
    const response = await fetch(`${API_BASE_URL}/api/games/${gameId}`);
    
    if (!response.ok) {
      if (response.status === 404) {
        // Return a placeholder game object for not found games
        return {
          gameId,
          status: GameStatus.SCHEDULED,
          period: 0,
          clock: '',
          homeTeam: {
            teamId: '',
            teamTricode: 'TBD',
            score: 0,
            stats: { rebounds: 0, assists: 0, blocks: 0 }
          },
          awayTeam: {
            teamId: '',
            teamTricode: 'TBD',
            score: 0,
            stats: { rebounds: 0, assists: 0, blocks: 0 }
          },
          lastUpdate: Date.now()
        };
      }
      throw new Error(`API responded with status: ${response.status}`);
    }

    const game = await response.json();
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