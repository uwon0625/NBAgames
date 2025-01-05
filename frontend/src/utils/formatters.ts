export const formatGameTime = (status: string, period: number | string, clock?: string): string => {
  // Handle final status
  if (status === 'final' || status === 'finished') {
    return 'Final';
  }

  // Handle scheduled games
  if (status === 'scheduled') {
    return 'Scheduled';
  }

  // Handle live games
  if (status === 'live' || status === 'in_progress') {
    // If no clock, just show the period
    if (!clock) {
      return `Q${period}`;
    }

    // Handle "PT00M23.70S" format
    if (clock.startsWith('PT')) {
      const minutes = clock.match(/(\d+)M/)?.[1] || '0';
      const seconds = clock.match(/(\d+\.\d+)S|(\d+)S/)?.[1] || '0';
      
      // If time is 0:00, show just the quarter
      if (minutes === '0' && parseFloat(seconds) === 0) {
        return `Q${period}`;
      }
      
      // Format as MM:SS
      return `Q${period} ${minutes}:${Math.floor(parseFloat(seconds)).toString().padStart(2, '0')}`;
    }

    // Handle simple minute format (e.g., "36")
    if (!isNaN(Number(clock))) {
      return `${clock}:00`;
    }

    // Handle "MM:SS" format
    if (clock.includes(':')) {
      return `Q${period} ${clock}`;
    }

    return clock;
  }

  return '';
};

export const formatPlayTime = (minutes: string): string => {
  // Handle "PT36M" format
  if (minutes.startsWith('PT')) {
    const mins = minutes.match(/(\d+)M/)?.[1];
    if (mins) {
      return mins;
    }
  }

  // Handle "MM:SS" format
  if (minutes.includes(':')) {
    return minutes;
  }

  // Return as-is if no special formatting needed
  return minutes;
}; 