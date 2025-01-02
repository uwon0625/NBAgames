import express, { Request, Response, Router } from 'express';
import { 
  getGames, 
  getGameBoxScore, 
  fetchLiveGames,
  getCacheStatus 
} from '../services/nbaService';
import { logger } from '../config/logger';
import { GetCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../config/dynamoDB';
import { DescribeTableCommand } from '@aws-sdk/client-dynamodb';

const router = Router();

// Get all games
router.get('/games', async (req: Request, res: Response) => {
  try {
    const games = await getGames();
    logger.info(`Sending ${games.length} games to client`);
    res.json(games);
  } catch (error) {
    logger.error('Failed to fetch games:', error);
    res.status(500).json({ error: 'Failed to fetch games' });
  }
});

// Get box score for a specific game
router.get('/games/:gameId/boxscore', async (req: Request, res: Response) => {
  try {
    const boxScore = await getGameBoxScore(req.params.gameId);
    if (!boxScore) {
      return res.status(404).json({ error: 'Box score not found' });
    }
    res.json(boxScore);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch box score' });
  }
});

// Get live games
router.get('/games/live', async (req: Request, res: Response) => {
  try {
    const games = await fetchLiveGames();
    res.json(games);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch live games' });
  }
});

// Get cache status
router.get('/cache/status', async (req: Request, res: Response) => {
  try {
    const status = await getCacheStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get cache status' });
  }
});

// Add route to check DynamoDB data
router.get('/db/games', async (req: Request, res: Response) => {
  try {
    const result = await docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        date: new Date().toISOString().split('T')[0],
        type: 'scoreboard'
      }
    }));

    if (!result.Item) {
      return res.status(404).json({ message: 'No data found in DynamoDB' });
    }

    res.json({
      date: result.Item.date,
      timestamp: result.Item.timestamp,
      ttl: result.Item.ttl,
      gamesCount: result.Item.games.length,
      games: result.Item.games
    });
  } catch (error) {
    logger.error('Failed to fetch DynamoDB data:', error);
    res.status(500).json({ error: 'Failed to fetch DynamoDB data' });
  }
});

// Add route to check DynamoDB status
router.get('/db/status', async (req: Request, res: Response) => {
  try {
    const command = new DescribeTableCommand({
      TableName: TABLE_NAME
    });
    
    const response = await docClient.send(command);
    res.json({
      status: 'success',
      table: {
        name: response.Table?.TableName,
        status: response.Table?.TableStatus,
        itemCount: response.Table?.ItemCount,
        region: process.env.AWS_REGION
      }
    });
  } catch (error) {
    logger.error('Failed to check DynamoDB status:', error);
    res.status(500).json({
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
      region: process.env.AWS_REGION,
      tableName: TABLE_NAME
    });
  }
});

export default router; 