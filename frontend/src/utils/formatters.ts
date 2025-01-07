import { GameStatus } from '@/types/enums';

export const formatClock = (clock: string | undefined): string => {
  if (!clock) return '';

  // Handle PT format (PT00M23.70S)
  if (clock.startsWith('PT')) {
    const matches = clock.match(/PT(\d+)M([\d.]+)S/);
    if (matches) {
      const minutes = parseInt(matches[1]);
      const seconds = Math.floor(parseFloat(matches[2]));
      return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
  }

  // Handle MM:SS format
  if (clock.includes(':')) {
    return clock;
  }

  // Handle simple minute format
  if (!isNaN(Number(clock))) {
    return `${clock}:00`;
  }

  return clock;
};

export const formatGameStatus = (status: GameStatus, period?: number, clock?: string): string => {
  if (status === GameStatus.LIVE && period) {
    if (period > 4) {
      return `OT ${formatClock(clock)}`;
    }
    return `Q${period} ${formatClock(clock)}`;
  }

  if (status === GameStatus.FINAL) {
    return 'Final';
  }

  return 'Scheduled';
};

export const formatPlayTime = (minutes: string): string => {
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