import { getGames } from './gameService';
import { broadcastGameUpdate } from '../services/websocketService';
import { logger } from '../config/logger';

const POLL_INTERVAL = 60000; // 60 seconds to avoid rate limits

let pollInterval: NodeJS.Timeout;
let lastUpdate = 0;

export const startGamePolling = () => {
  if (pollInterval) {
    clearInterval(pollInterval);
  }

  // Initial fetch
  fetchAndBroadcast();

  pollInterval = setInterval(fetchAndBroadcast, POLL_INTERVAL);
  logger.info('Game polling started');
};

const fetchAndBroadcast = async () => {
  try {
    // Add rate limiting
    const now = Date.now();
    if (now - lastUpdate < 30000) { // Minimum 30 seconds between requests
      return;
    }

    const games = await getGames();
    const liveGames = games.filter(game => game.status === 'live');
    
    if (liveGames.length > 0) {
      liveGames.forEach(game => {
        broadcastGameUpdate(game);
      });
      lastUpdate = now;
      logger.debug(`Broadcasted updates for ${liveGames.length} live games`);
    }
  } catch (error) {
    logger.error('Error polling game updates:', error);
  }
};

export const stopGamePolling = () => {
  if (pollInterval) {
    clearInterval(pollInterval);
    logger.info('Game polling stopped');
  }
}; 