import { jest } from '@jest/globals';

const mockFn = jest.fn;

export const mockRedis = {
  createClient: mockFn().mockReturnValue({
    connect: mockFn().mockImplementation(() => Promise.resolve()),
    get: mockFn().mockImplementation(() => Promise.resolve(null)),
    set: mockFn().mockImplementation(() => Promise.resolve('OK')),
    keys: mockFn().mockImplementation(() => Promise.resolve([])),
    on: mockFn(),
    quit: mockFn().mockImplementation(() => Promise.resolve())
  })
}; 