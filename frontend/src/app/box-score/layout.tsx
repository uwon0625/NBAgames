import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'NBA Box Score',
  description: 'NBA game box score and detailed statistics',
  openGraph: {
    title: 'NBA Box Score',
    description: 'NBA game box score and detailed statistics',
  },
};

export default function BoxScoreLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
} 