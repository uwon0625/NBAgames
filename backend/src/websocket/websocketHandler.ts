import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBDocumentClient, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoDb } from '../config/aws';
import { logger } from '../config/logger';

const docClient = DynamoDBDocumentClient.from(dynamoDb);

export const onConnect: APIGatewayProxyHandler = async (event) => {
  try {
    const connectionId = event.requestContext.connectionId;
    
    await docClient.send(new PutCommand({
      TableName: process.env.CONNECTIONS_TABLE,
      Item: {
        connectionId,
        timestamp: Date.now()
      }
    }));

    return { statusCode: 200, body: 'Connected' };
  } catch (error) {
    logger.error('WebSocket connect error:', error);
    return { statusCode: 500, body: 'Failed to connect' };
  }
};

export const onDisconnect: APIGatewayProxyHandler = async (event) => {
  try {
    const connectionId = event.requestContext.connectionId;
    
    await docClient.send(new DeleteCommand({
      TableName: process.env.CONNECTIONS_TABLE,
      Key: { connectionId }
    }));

    return { statusCode: 200, body: 'Disconnected' };
  } catch (error) {
    logger.error('WebSocket disconnect error:', error);
    return { statusCode: 500, body: 'Failed to disconnect' };
  }
}; 