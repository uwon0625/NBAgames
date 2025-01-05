import React from 'react';

const createAppRouterContext = () => {
  const context = {
    push: (href: string) => Promise.resolve(true),
    replace: (href: string) => Promise.resolve(true),
    refresh: () => {},
    prefetch: (href: string) => Promise.resolve(),
    back: () => {},
    forward: () => {},
    // Add other required properties
    pathname: '/',
    query: {},
    asPath: '/',
    basePath: '',
    defaultLocale: 'en',
    locale: 'en',
    locales: ['en'],
    isLocaleDomain: false,
  };

  return React.createContext(context);
};

// Create the context
const AppRouterContext = createAppRouterContext();

// Create the decorator
export const RouterDecorator = (Story: React.ComponentType) => {
  // Create a new instance of the router for each story
  const router = {
    push: (href: string) => Promise.resolve(true),
    replace: (href: string) => Promise.resolve(true),
    refresh: () => {},
    prefetch: (href: string) => Promise.resolve(),
    back: () => {},
    forward: () => {},
    // Add other required properties
    pathname: '/',
    query: {},
    asPath: '/',
    basePath: '',
    defaultLocale: 'en',
    locale: 'en',
    locales: ['en'],
    isLocaleDomain: false,
  };

  // Mock the useRouter hook
  if (typeof window !== 'undefined') {
    // @ts-ignore
    window.useRouter = () => router;
  }

  return (
    <AppRouterContext.Provider value={router}>
      <Story />
    </AppRouterContext.Provider>
  );
}; 