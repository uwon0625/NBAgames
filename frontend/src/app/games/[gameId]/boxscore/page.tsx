'use client';

import { BoxScore } from '@/components/BoxScore';
import { useSearchParams } from 'next/navigation';

export default function BoxScorePage({ params }: { params: { gameId: string } }) {
  const searchParams = useSearchParams();
  const status = searchParams.get('status');
  const period = searchParams.get('period');
  const clock = searchParams.get('clock');

  return (
    <div className="container mx-auto px-4 py-8">
      <BoxScore 
        gameId={params.gameId} 
        status={status}
        period={period ? parseInt(period) : undefined}
        clock={clock || undefined}
      />
    </div>
  );
} 