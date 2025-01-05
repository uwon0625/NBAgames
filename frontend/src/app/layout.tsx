'use client';

import './globals.css'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterContext } from '@/utils/RouterContext';
import { useRouter } from 'next/navigation';

const queryClient = new QueryClient();

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter();

  return (
    <html lang="en">
      <body className="bg-gray-100">
        <QueryClientProvider client={queryClient}>
          <RouterContext.Provider value={router}>
            <main className="container mx-auto px-4 py-8">
              {children}
            </main>
          </RouterContext.Provider>
        </QueryClientProvider>
      </body>
    </html>
  )
}
