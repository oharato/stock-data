import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import type { Ticker, PriceRecord, ErrorRecord } from './domain/types.js';
import { fetchTickerRange } from './repository/yahoo.js';
import { readParquet, writeParquet } from './repository/parquet.js';
import { today, getMonthKey, monthParquetPath } from './logic/date-utils.js';
import { createLogger } from './logic/logger.js';

const DELAY_MS = 1000;
const RAW_DIR = 'data/raw';
const START_DATE = '2000-01-01';
const BATCH_SIZE = 100;

async function main() {
  const logger = createLogger('fetch-initial');
  logger.log(`Starting fetch-initial (log: ${logger.logFile})`);

  if (!existsSync('tickers.json')) {
    logger.error('tickers.json not found. Run: npm run fetch-tickers');
    process.exit(1);
  }

  const tickers: Ticker[] = JSON.parse(readFileSync('tickers.json', 'utf-8'));
  const errors: ErrorRecord[] = [];
  mkdirSync(RAW_DIR, { recursive: true });

  // Phase 1: 銘柄ごとに全期間一括取得（1リクエスト/銘柄）
  logger.log(`Phase 1: Fetching full history for ${tickers.length} tickers (1 req/sec)...`);
  let done = 0;
  let cached = 0;

  for (const ticker of tickers) {
    const rawPath = `${RAW_DIR}/${ticker.code}.json`;
    if (existsSync(rawPath)) {
      done++;
      cached++;
      logger.progress(`${done}/${tickers.length} (${cached} cached)`);
      continue;
    }

    try {
      const records = await fetchTickerRange(ticker.code, START_DATE, today());
      writeFileSync(rawPath, JSON.stringify(records));
    } catch (err) {
      errors.push({ ticker: ticker.code, period: `${START_DATE}~${today()}`, reason: String(err) });
      logger.error(`Failed: ${ticker.code} — ${err}`);
    }
    done++;
    logger.progress(`${done}/${tickers.length}`);
    if (done % 100 === 0) {
      logger.log(`Phase 1 progress: ${done}/${tickers.length} fetched, ${errors.length} errors`);
    }
    if (done < tickers.length) {
      await new Promise(res => setTimeout(res, DELAY_MS));
    }
  }
  logger.done();
  logger.log(`Phase 1 complete: ${done} tickers (${cached} cached, ${errors.length} errors)`);

  // Phase 2: raw JSONを月別Parquetに変換（バッチ処理）
  const totalBatches = Math.ceil(tickers.length / BATCH_SIZE);
  logger.log(`Phase 2: Converting raw data to monthly parquets (${totalBatches} batches of ${BATCH_SIZE})...`);

  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const batch = tickers.slice(i, i + BATCH_SIZE);
    const end = Math.min(i + BATCH_SIZE, tickers.length);
    logger.log(`Phase 2 batch ${batchNum}/${totalBatches}: tickers ${i + 1}-${end}`);

    const monthData = new Map<string, PriceRecord[]>();
    for (const ticker of batch) {
      const rawPath = `${RAW_DIR}/${ticker.code}.json`;
      if (!existsSync(rawPath)) continue;
      const records: PriceRecord[] = JSON.parse(readFileSync(rawPath, 'utf-8'));
      for (const record of records) {
        const key = getMonthKey(record.date);
        const arr = monthData.get(key);
        if (arr) { arr.push(record); } else { monthData.set(key, [record]); }
      }
    }

    let parquetsWritten = 0;
    for (const [monthKey, newRecords] of monthData) {
      const [y, m] = monthKey.split('-');
      const outputPath = monthParquetPath(Number(y), Number(m));
      const existing = await readParquet(outputPath);
      const seen = new Set(existing.map(r => `${r.date}:${r.ticker}`));
      const merged = [...existing];
      for (const r of newRecords) {
        if (!seen.has(`${r.date}:${r.ticker}`)) merged.push(r);
      }
      merged.sort((a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker));
      await writeParquet(outputPath, merged);
      parquetsWritten++;
    }
    logger.log(`  → ${parquetsWritten} parquet files updated`);
  }

  if (errors.length > 0) {
    writeFileSync('errors.json', JSON.stringify(errors, null, 2));
    logger.error(`${errors.length} errors saved to errors.json`);
  }

  logger.log('Initial fetch complete!');
}

main().catch(console.error);
