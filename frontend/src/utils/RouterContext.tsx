import React from 'react';

interface RouterContextType {
  push: (url: string) => void;
  back: () => void;
  forward: () => void;
  refresh: () => void;
  prefetch: (url: string) => void;
  replace: (url: string) => void;
}

export const RouterContext = React.createContext<RouterContextType | null>(null); 