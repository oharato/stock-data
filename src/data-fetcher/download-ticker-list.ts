import { fetchAndSaveTickers } from './logic/merge-tickers.js';
import { createLogger } from '../shared/logic/logger.js';

const logger = createLogger('download-ticker-list');
logger.log(`Starting download-ticker-list (log: ${logger.logFile})`);

fetchAndSaveTickers()
  .then(tickers => logger.log(`Done: ${tickers.length} tickers saved`))
  .catch(err => { 
    logger.error(String(err)); 
    process.exit(1); 
  });
