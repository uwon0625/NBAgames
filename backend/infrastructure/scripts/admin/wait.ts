import { logger } from '../../../src/config/logger';

function wait(seconds: number) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

async function main() {
  const seconds = parseInt(process.argv[2] || '10');
  logger.info(`Waiting ${seconds} seconds for services to start...`);
  await wait(seconds);
}

main().catch(console.error); 