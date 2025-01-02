import { BoxScorePageWrapper } from '@/components/BoxScore/BoxScorePageWrapper';
import { Metadata } from 'next';

interface Props {
  params: { id: string };
}

// Helper function to validate params
async function validateParams(params: Props['params']) {
  'use server';
  return params;
}

export default async function Page(props: Props) {
  // Await params validation
  const params = await validateParams(props.params);

  return <BoxScorePageWrapper params={params} />;
}

// Static metadata
export const metadata: Metadata = {
  title: 'NBA Box Score',
  description: 'NBA game box score and detailed statistics',
  openGraph: {
    title: 'NBA Box Score',
    description: 'NBA game box score and detailed statistics',
  },
}; 