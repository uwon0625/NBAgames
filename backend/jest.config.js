module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  setupFilesAfterEnv: [
    '<rootDir>/__tests__/setup/jest.setup.ts'
  ],
  setupFiles: ['<rootDir>/__tests__/setup.ts'],
  testTimeout: 10000
}; 