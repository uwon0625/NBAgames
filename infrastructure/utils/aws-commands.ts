import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../../backend/src/config/logger';

const execAsync = promisify(exec);

export interface CommandError extends Error {
  stderr?: string;
  stdout?: string;
  cmd?: string;
}

export async function executeCommand(command: string): Promise<string> {
  try {
    logger.info(`Executing command: ${command}`);
    const { stdout, stderr } = await execAsync(command);
    if (stderr) {
      logger.warn('Command stderr:', stderr);
    }
    return stdout.trim();
  } catch (error: any) {
    logger.error('Command execution failed:', error.message);
    if (error.stderr) {
      logger.error('Command stderr:', error.stderr);
    }
    throw error;
  }
} 