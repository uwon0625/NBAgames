'use client';

import { BoxScoreWrapper } from './BoxScoreWrapper';

interface BoxScorePageWrapperProps {
  params: { id: string };
}

export function BoxScorePageWrapper({ params }: BoxScorePageWrapperProps) {
  // Ensure we have a valid ID
  if (!params?.id) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <BoxScoreWrapper id={params.id} />
    </div>
  );
} 