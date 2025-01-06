'use client';

import './globals.css'
import LayoutProvider from '@/providers/LayoutProvider';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="bg-gray-100">
        <LayoutProvider>
          <main className="container mx-auto px-4 py-8">
            {children}
          </main>
        </LayoutProvider>
      </body>
    </html>
  )
}
