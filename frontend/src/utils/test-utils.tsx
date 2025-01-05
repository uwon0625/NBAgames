import React from 'react';
import { render } from '@testing-library/react';

// Define router interface
interface RouterContextType {
  push: (url: string) => Promise<boolean>;
  back: () => Promise<boolean>;
  forward: () => Promise<boolean>;
  refresh: () => Promise<boolean>;
  prefetch: (url: string) => Promise<boolean>;
  replace: (url: string) => Promise<boolean>;
}

// Create mock router context
const createMockRouter = (): RouterContextType => ({
  push: jest.fn().mockResolvedValue(true),
  back: jest.fn().mockResolvedValue(true),
  forward: jest.fn().mockResolvedValue(true),
  refresh: jest.fn().mockResolvedValue(true),
  prefetch: jest.fn().mockResolvedValue(true),
  replace: jest.fn().mockResolvedValue(true)
});

// Create router context with proper typing
export const RouterContext = React.createContext<RouterContextType>({
  push: async () => true,
  back: async () => true,
  forward: async () => true,
  refresh: async () => true,
  prefetch: async () => true,
  replace: async () => true
});

// Create custom render function
export function renderWithRouter(ui: React.ReactElement) {
  const mockRouter = createMockRouter();
  
  return {
    ...render(
      <RouterContext.Provider value={mockRouter}>
        {ui}
      </RouterContext.Provider>
    ),
    mockRouter
  };
} 