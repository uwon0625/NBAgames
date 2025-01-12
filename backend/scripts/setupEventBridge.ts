import { 
  EventBridgeClient, 
  PutRuleCommand,
  PutTargetsCommand,
  Rule,
  Target
} from '@aws-sdk/client-eventbridge';
import { logger } from '../src/config/logger';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Validate required environment variables
const requiredEnvVars = {
  AWS_ACCOUNT_ID: process.env.AWS_ACCOUNT_ID,
  AWS_REGION: process.env.AWS_REGION || 'us-east-1'
};

function validateEnvironment() {
  const missing = Object.entries(requiredEnvVars)
    .filter(([_, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      'Please set them in .env file or export them in your shell'
    );
  }

  return requiredEnvVars as { [K in keyof typeof requiredEnvVars]: string };
}

const eventbridge = new EventBridgeClient({ region: requiredEnvVars.AWS_REGION });

const RULES = [
  {
    name: 'nba-score-updates',
    description: 'Trigger game score updates every minute',
    schedule: 'rate(1 minute)',
    targetFunction: 'gameUpdateHandler'
  },
  {
    name: 'nba-boxscore-updates',
    description: 'Trigger box score updates every 2 minutes',
    schedule: 'rate(2 minutes)',
    targetFunction: 'boxScoreHandler'
  }
];

async function createRule(rule: typeof RULES[0]) {
  try {
    const env = validateEnvironment();

    // Create the rule
    await eventbridge.send(new PutRuleCommand({
      Name: rule.name,
      Description: rule.description,
      ScheduleExpression: rule.schedule,
      State: 'ENABLED'
    }));

    logger.info(`Created rule: ${rule.name}`);

    // Create the target
    const target: Target = {
      Id: `${rule.name}-target`,
      Arn: `arn:aws:lambda:${env.AWS_REGION}:${env.AWS_ACCOUNT_ID}:function:${rule.targetFunction}`,
      Input: JSON.stringify({
        source: 'aws.events',
        'detail-type': 'Scheduled Event'
      })
    };

    await eventbridge.send(new PutTargetsCommand({
      Rule: rule.name,
      Targets: [target]
    }));

    logger.info(`Added target to rule: ${rule.name} -> ${rule.targetFunction}`);

  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('AccessDenied')) {
        logger.error('Access denied. Required permissions:');
        logger.error('- events:PutRule');
        logger.error('- events:PutTargets');
        logger.error('- lambda:InvokeFunction');
      } else {
        logger.error(`Error creating rule ${rule.name}:`, error);
      }
    }
    throw error;
  }
}

async function setupEventBridge() {
  try {
    logger.info('Setting up EventBridge rules...');

    for (const rule of RULES) {
      await createRule(rule);
    }

    logger.info('EventBridge setup completed successfully');
    
    // Import and use the named function
    const { verifyEventBridgeSetup } = await import('./verifyEventBridge');
    await verifyEventBridgeSetup();

  } catch (error) {
    logger.error('EventBridge setup failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  setupEventBridge();
}

export default setupEventBridge; 