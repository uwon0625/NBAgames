import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as apigatewayv2 from '@aws-cdk/aws-apigatewayv2-alpha';
import * as apigatewayv2_integrations from '@aws-cdk/aws-apigatewayv2-integrations-alpha';
import { Construct } from 'constructs';

export class NbaLiveStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // DynamoDB Tables
    const gamesTable = new dynamodb.Table(this, 'GamesTable', {
      partitionKey: { name: 'gameId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
    });

    const alertsTable = new dynamodb.Table(this, 'AlertsTable', {
      partitionKey: { name: 'gameId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
    });

    // SQS Queues
    const gameUpdatesQueue = new sqs.Queue(this, 'GameUpdatesQueue', {
      visibilityTimeout: cdk.Duration.seconds(30),
      retentionPeriod: cdk.Duration.days(1),
    });

    // EventBridge Bus
    const eventBus = new events.EventBus(this, 'NbaLiveEventBus', {
      eventBusName: 'nba-live-events',
    });

    // Lambda Functions
    const gameProcessorFunction = new lambda.Function(this, 'GameProcessor', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/gameProcessor'),
      environment: {
        GAMES_TABLE: gamesTable.tableName,
        ALERTS_TABLE: alertsTable.tableName,
        UPDATES_QUEUE_URL: gameUpdatesQueue.queueUrl,
      },
    });

    // Grant permissions
    gamesTable.grantReadWriteData(gameProcessorFunction);
    alertsTable.grantReadWriteData(gameProcessorFunction);
    gameUpdatesQueue.grantSendMessages(gameProcessorFunction);

    // EventBridge Rule
    new events.Rule(this, 'GameUpdateRule', {
      eventBus,
      eventPattern: {
        source: ['nba-live.games'],
        detailType: ['game-update'],
      },
      targets: [new targets.LambdaFunction(gameProcessorFunction)],
    });

    // WebSocket Connections Table
    const connectionsTable = new dynamodb.Table(this, 'ConnectionsTable', {
      partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: 'ttl',
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    // WebSocket Handler Lambda
    const websocketHandler = new lambda.Function(this, 'WebSocketHandler', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/websocket'),
      environment: {
        CONNECTIONS_TABLE: connectionsTable.tableName,
      },
    });

    // WebSocket API
    const webSocketApi = new apigatewayv2.WebSocketApi(this, 'GameUpdatesWebSocketApi', {
      connectRouteOptions: { integration: new apigatewayv2_integrations.WebSocketLambdaIntegration('ConnectIntegration', websocketHandler) },
      disconnectRouteOptions: { integration: new apigatewayv2_integrations.WebSocketLambdaIntegration('DisconnectIntegration', websocketHandler) },
    });

    // Grant permissions
    connectionsTable.grantReadWriteData(websocketHandler);
  }
} 