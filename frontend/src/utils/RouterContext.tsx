import React from 'react';

// Define router interface
interface RouterContextType {
  push: (url: string) => Promise<boolean>;
  back: () => Promise<boolean>;
  forward: () => Promise<boolean>;
  refresh: () => Promise<boolean>;
  prefetch: (url: string) => Promise<boolean>;
  replace: (url: string) => Promise<boolean>;
}

// Create router context with proper typing
export const RouterContext = React.createContext<RouterContextType>({
  push: async () => true,
  back: async () => true,
  forward: async () => true,
  refresh: async () => true,
  prefetch: async () => true,
  replace: async () => true
}); 