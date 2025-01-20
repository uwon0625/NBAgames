import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GameService } from '../services/gameService';
import { logger } from '../config/logger';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const gameService = GameService.getInstance();  // Use getInstance instead of new
    const gameId = event.pathParameters?.gameId;

    if (!gameId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Game ID is required' })
      };
    }

    const game = await gameService.getGame(gameId);
    if (!game) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Game not found' })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify(game)
    };
  } catch (error) {
    logger.error('Error in box score handler:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}; 