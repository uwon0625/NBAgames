import express, { Request, Response, Router } from 'express';
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { 
  DynamoDBDocumentClient, 
  ScanCommand, 
  DeleteCommand 
} from "@aws-sdk/lib-dynamodb";
import { redisClient } from '../config/redis';
import { logger } from '../config/logger';

// Add interface for DynamoDB items
interface DynamoDBItem {
  date: string;
  type: string;
  games?: any[];
  timestamp?: number;
  ttl?: number;
}

const router: Router = express.Router();

// Create DynamoDB client
const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  } : undefined
});

const docClient = DynamoDBDocumentClient.from(client);

// POST /api/admin/flush-cache
router.post('/flush-cache', async (req: Request, res: Response): Promise<void> => {
  try {
    logger.info('Starting cache flush...');
    
    // Clear Redis
    await redisClient.flushdb();
    logger.info('Redis cleared');

    // Clear DynamoDB
    const tableName = process.env.DYNAMODB_TABLE_NAME || 'nba_games';
    
    try {
      // First, scan the table to get all items
      const scanCommand = new ScanCommand({
        TableName: tableName,
        ConsistentRead: true
      });

      const scanResult = await docClient.send(scanCommand);

      if (!scanResult.Items || scanResult.Items.length === 0) {
        logger.info('No items found in DynamoDB');
        res.json({ message: 'Cache flushed successfully' });
        return;
      }

      logger.info(`Found ${scanResult.Items.length} items to delete`);

      // Delete items in batches to avoid throttling
      const batchSize = 25;
      for (let i = 0; i < scanResult.Items.length; i += batchSize) {
        const batch = scanResult.Items.slice(i, i + batchSize) as DynamoDBItem[];
        await Promise.all(
          batch.map((item) => 
            docClient.send(new DeleteCommand({
              TableName: tableName,
              Key: {
                date: item.date,
                type: item.type
              }
            }))
          )
        );
        logger.info(`Deleted batch of ${batch.length} items`);
      }

      logger.info(`Successfully deleted ${scanResult.Items.length} items from DynamoDB`);

    } catch (dbError: any) {
      if (dbError.name === 'ResourceNotFoundException') {
        logger.warn('DynamoDB table not found - skipping');
      } else {
        logger.error('Failed to clear DynamoDB:', dbError);
        throw dbError;
      }
    }

    res.json({ message: 'Cache flushed successfully' });
  } catch (error) {
    logger.error('Failed to flush cache:', error);
    res.status(500).json({ error: 'Failed to flush cache' });
  }
});

export default router; 