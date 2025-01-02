'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';

const DynamicBoxScore = dynamic(
  () => import('@/components/BoxScore').then((mod) => mod.default),
  {
    loading: () => (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"/>
      </div>
    ),
    ssr: false
  }
);

interface BoxScoreWrapperProps {
  id: string;
}

export function BoxScoreWrapper({ id }: BoxScoreWrapperProps) {
  const router = useRouter();

  // Only redirect if id is explicitly undefined or empty string
  if (id === undefined || id === '') {
    router.push('/');
    return null;
  }

  return <DynamicBoxScore id={id} />;
} 