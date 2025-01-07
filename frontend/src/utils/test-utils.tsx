import React from 'react';
import { render } from '@testing-library/react';
import { RouterContext } from './RouterContext';

// Create mock router context
const createMockRouter = () => ({
  push: jest.fn().mockResolvedValue(true),
  back: jest.fn().mockResolvedValue(true),
  forward: jest.fn().mockResolvedValue(true),
  refresh: jest.fn().mockResolvedValue(true),
  prefetch: jest.fn().mockResolvedValue(true),
  replace: jest.fn().mockResolvedValue(true)
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