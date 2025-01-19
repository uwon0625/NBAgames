import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SQSEvent, Context } from 'aws-lambda';
import axios from 'axios';

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);

const NBA_BASE_URL = process.env.NBA_BASE_URL || 'https://nba-prod-us-east-1-mediaops-stats.s3.amazonaws.com/NBA/liveData';

export const handler = async (event: SQSEvent, context: Context) => {
    console.log('Box Score Handler started', { 
        requestId: context.awsRequestId,
        eventRecords: event.Records.length,
        environment: {
            NBA_BASE_URL: process.env.NBA_BASE_URL,
            DYNAMODB_TABLE_NAME: process.env.DYNAMODB_TABLE_NAME,
            NODE_ENV: process.env.NODE_ENV
        }
    });

    try {
        for (const record of event.Records) {
            console.log('Processing record', { messageId: record.messageId });
            
            try {
                const game = JSON.parse(record.body);
                console.log('Game data', { 
                    gameId: game.gameId,
                    status: game.gameStatus,
                    homeTeam: game.homeTeam?.teamId,
                    awayTeam: game.awayTeam?.teamId
                });

                // Fetch box score data
                const boxScoreUrl = `${NBA_BASE_URL}/boxscore/boxscore_${game.gameId}.json`;
                console.log('Fetching box score from:', boxScoreUrl);
                
                const response = await axios.get(boxScoreUrl);
                
                if (response.status === 200) {
                    // Store in DynamoDB
                    const params = {
                        TableName: process.env.DYNAMODB_TABLE_NAME,
                        Item: {
                            gameId: game.gameId,
                            ...game,
                            boxScore: response.data,
                            updatedAt: new Date().toISOString(),
                            lastUpdate: Date.now()
                        }
                    };

                    console.log('Storing in DynamoDB', { 
                        tableName: params.TableName,
                        gameId: params.Item.gameId 
                    });

                    await ddb.send(new PutCommand(params));
                    console.log(`Successfully processed box score for game ${game.gameId}`);
                }
            } catch (error) {
                console.error('Error processing record:', { 
                    messageId: record.messageId, 
                    error: error instanceof Error ? error.message : String(error)
                });
                // Don't throw here to continue processing other messages
            }
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Box scores processed successfully' })
        };
    } catch (error) {
        console.error('Fatal error in box score handler:', error);
        throw error;
    }
}; 