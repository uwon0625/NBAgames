'use client';

import './globals.css'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const queryClient = new QueryClient();

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="bg-gray-100">
        <QueryClientProvider client={queryClient}>
          <main className="container mx-auto px-4 py-8">
            {children}
          </main>
        </QueryClientProvider>
      </body>
    </html>
  )
}
