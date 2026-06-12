import { buildDuckDb } from './repository/duckdb.js';
import { createLogger } from './logic/logger.js';

const logger = createLogger('build-duckdb');
logger.log(`Starting build-duckdb (log: ${logger.logFile})`);
buildDuckDb()
  .then(() => logger.log('Done'))
  .catch(err => { logger.error(String(err)); process.exit(1); });