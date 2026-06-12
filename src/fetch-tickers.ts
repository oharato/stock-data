import { fetchAndSaveTickers } from './repository/jpx.js';
import { createLogger } from './logic/logger.js';

const logger = createLogger('fetch-tickers');
logger.log(`Starting fetch-tickers (log: ${logger.logFile})`);
fetchAndSaveTickers()
  .then(tickers => logger.log(`Done: ${tickers.length} tickers saved`))
  .catch(err => { logger.error(String(err)); process.exit(1); });