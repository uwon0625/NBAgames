import { logger } from '../../../src/config/logger';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function setupLambda() {
  try {
    // 1. Install Lambda dependencies
    logger.info('Installing Lambda dependencies...');
    await execAsync('yarn setup:lambda');

    // 2. Build Lambda functions
    logger.info('Building Lambda functions...');
    await execAsync('yarn build:lambda');

    // 3. Deploy Lambda functions
    logger.info('Deploying Lambda functions...');
    await execAsync('yarn deploy:lambda');

    // 4. Test Lambda functions
    logger.info('Testing Lambda functions...');
    await execAsync('yarn test:lambda');

    logger.info('Lambda setup completed successfully');
  } catch (error) {
    logger.error('Failed to setup Lambda functions:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  setupLambda()
    .catch(() => process.exit(1));
} 