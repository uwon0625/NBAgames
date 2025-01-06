'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterContext } from '@/utils/RouterContext';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';

export default function LayoutProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5000,
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <RouterContext.Provider value={router}>
        {children}
      </RouterContext.Provider>
    </QueryClientProvider>
  );
} 