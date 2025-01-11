import { GameStatus } from '@/types/enums';

export const formatClock = (clock: string | undefined): string => {
  if (!clock) return '';

  // Handle PT format (PT00M00.00S)
  if (clock.startsWith('PT')) {
    const matches = clock.match(/PT(\d+)M([\d.]+)S/);
    if (matches) {
      const minutes = parseInt(matches[1]);
      const seconds = Math.floor(parseFloat(matches[2]));
      // Return empty string for 0:00 as it will be handled by formatGameStatus
      if (minutes === 0 && seconds === 0) return '';
      return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
  }

  // Handle MM:SS format
  if (clock.includes(':')) {
    // Return empty string for 0:00 as it will be handled by formatGameStatus
    if (clock === '0:00') return '';
    return clock;
  }

  return clock;
};

export function formatGameStatus(status: GameStatus, period: number, clock: string): string {
  if (status === GameStatus.LIVE) {
    // Show "Half" for second quarter ending
    if (period === 2 && (clock === '0:00' || clock === 'PT00M00.00S')) {
      return 'Half';
    }
    // Show quarter and clock if available
    const formattedClock = formatClock(clock);
    return formattedClock ? `Q${period} ${formattedClock}` : `Q${period}`;
  }
  
  if (status === GameStatus.FINAL) {
    return 'Final';
  }
  
  return 'Scheduled';
}

export const formatPlayTime = (minutes: string | undefined): string => {
  // Handle undefined or null
  if (!minutes) return '0:00';

  // Handle PT format (PT36M00S)
  if (minutes.startsWith('PT')) {
    const matches = minutes.match(/PT(\d+)M/);
    if (matches) {
      return matches[1];
    }
  }

  // Handle MM:SS format
  if (minutes.includes(':')) {
    return minutes;
  }

  return minutes;
};

export const formatShootingStats = (made: number, attempted: number): string => {
  return `${made}-${attempted}`;
};

export const formatPercentage = (made: number, attempted: number): string => {
  if (attempted === 0) return '0.0';
  return ((made / attempted) * 100).toFixed(1);
}; 