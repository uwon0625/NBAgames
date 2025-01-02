import { jest } from '@jest/globals';
import { mockRedis } from '../mocks/redis';
import { mockDynamoDB } from '../mocks/dynamodb';

jest.mock('redis', () => mockRedis);
jest.mock('@aws-sdk/lib-dynamodb', () => mockDynamoDB); 