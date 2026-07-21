import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'fs';
import type { Ticker, ErrorRecord } from '../shared/domain/types.js';
import { fetchTickerRange } from '../shared/repository/yahoo.js';
import { createLogger } from '../shared/logic/logger.js';

const DELAY_MS = 1000;
const RAW_DIR = 'data/raw';
const START_DATE = '2000-01-01';

function getLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function main() {
  const logger = createLogger('download-price-history');
  logger.log(`Starting download-price-history (log: ${logger.logFile})`);

  // Read ticker list from JSON cache
  let tickers: Ticker[] = [];
  const tickersJsonPath = 'data/tickers.json';

  if (existsSync(tickersJsonPath)) {
    try {
      tickers = JSON.parse(readFileSync(tickersJsonPath, 'utf-8'));
      logger.log(`Loaded ${tickers.length} tickers from ${tickersJsonPath}`);
    } catch (err) {
      logger.error(`Failed to parse ${tickersJsonPath}: ${err}`);
      process.exit(1);
    }
  } else {
    logger.error(`No tickers list found at ${tickersJsonPath}. Run 'npm run download:tickers' first.`);
    process.exit(1);
  }

  mkdirSync(RAW_DIR, { recursive: true });

  const errors: ErrorRecord[] = [];
  const todayStr = getLocalDateString(new Date());
  logger.log(`Fetching history (${START_DATE} ~ ${todayStr}) for ${tickers.length} tickers...`);

  let done = 0;
  let skipped = 0;

  for (const ticker of tickers) {
    const rawPath = `${RAW_DIR}/${ticker.code}.json`;
    let isToday = false;

    if (existsSync(rawPath)) {
      try {
        const stat = statSync(rawPath);
        const fileDateStr = getLocalDateString(stat.mtime);
        if (fileDateStr === todayStr) {
          isToday = true;
        }
      } catch (e) {
        logger.error(`Failed to stat ${rawPath}: ${e}`);
      }
    }

    if (isToday) {
      done++;
      skipped++;
      logger.progress(`${done}/${tickers.length} (${skipped} skipped)`);
      continue;
    }

    try {
      const records = await fetchTickerRange(ticker.code, START_DATE, todayStr);
      writeFileSync(rawPath, JSON.stringify(records));
    } catch (err) {
      errors.push({
        ticker: ticker.code,
        period: `${START_DATE}~${todayStr}`,
        reason: String(err),
      });
      logger.error(`Failed: ${ticker.code} — ${err}`);
    }

    done++;
    logger.progress(`${done}/${tickers.length}`);
    if (done % 100 === 0) {
      logger.log(`Progress: ${done}/${tickers.length} processed, ${errors.length} errors`);
    }
    if (done < tickers.length) {
      await new Promise(res => setTimeout(res, DELAY_MS));
    }
  }

  logger.done();
  logger.log(`Download phase complete: ${done} tickers processed (${skipped} skipped, ${errors.length} errors)`);

  if (errors.length > 0) {
    writeFileSync('errors.json', JSON.stringify(errors, null, 2));
    logger.error(`${errors.length} errors saved to errors.json`);
  } else if (existsSync('errors.json')) {
    writeFileSync('errors.json', '[]');
  }

  logger.log('All done!');
}

main().catch(console.error);
