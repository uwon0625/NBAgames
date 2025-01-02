import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const nextJest = require('next/jest');

const createJestConfig = nextJest({
  dir: './',
});

const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'jest-environment-jsdom',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  moduleDirectories: ['node_modules', '<rootDir>/src'],
};

export default createJestConfig(customJestConfig); 