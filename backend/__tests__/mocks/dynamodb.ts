import { jest } from '@jest/globals';

const mockFn = jest.fn;

export const mockDynamoDB = {
  DynamoDBDocumentClient: {
    from: mockFn().mockReturnValue({
      send: mockFn().mockImplementation(() => Promise.resolve({
        Item: {
          date: '2024-03-14',
          type: 'scoreboard',
          games: []
        }
      }))
    })
  }
}; 