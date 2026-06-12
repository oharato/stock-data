import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import type { Ticker, PriceRecord, ErrorRecord } from './domain/types.js';
import { fetchTickerRange } from './repository/yahoo.js';
import { writeParquet, readParquet, readParquetMaxDate } from './repository/parquet.js';
import { buildDuckDb, readDbMaxDate } from './repository/duckdb.js';
import { fetchAndSaveTickers } from './repository/jpx.js';
import { today, getCurrentYearMonth, monthParquetPath } from './logic/date-utils.js';
import { calcFetchRange } from './logic/update-logic.js';
import { mergeRecords } from './logic/update-logic.js';
import { createLogger } from './logic/logger.js';

const DELAY_MS = 1000;
const UPDATE_CACHE_BASE = 'data/update-cache';

/** 当日以外のキャッシュディレクトリを削除する */
function pruneOldCaches(currentKey: string, logger: ReturnType<typeof createLogger>): void {
  if (!existsSync(UPDATE_CACHE_BASE)) return;
  for (const entry of readdirSync(UPDATE_CACHE_BASE)) {
    if (entry !== currentKey) {
      const stale = join(UPDATE_CACHE_BASE, entry);
      rmSync(stale, { recursive: true, force: true });
      logger.log(`Removed stale cache: ${stale}`);
    }
  }
}

async function main() {
  const logger = createLogger('fetch-update');
  logger.log(`Starting fetch-update (log: ${logger.logFile})`);

  // Step 1: tickers.jsonを最新のJPXリストで更新（新規上場・上場廃止を反映）
  logger.log('Step 1: Updating tickers.json from JPX...');
  const tickers: Ticker[] = await fetchAndSaveTickers();
  logger.log(`Loaded ${tickers.length} tickers`);

  // Step 2: 最終取得日を確認（stock.duckdb > 当月Parquet > null の優先順）
  const { year, month } = getCurrentYearMonth();
  const parquetPath = monthParquetPath(year, month);
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const todayStr = today();

  // stock.duckdb があれば全月をまたいだ正確な最終日を取得、なければ当月Parquetで代替
  const dbLastDate = await readDbMaxDate();
  const parquetLastDate = await readParquetMaxDate(parquetPath);
  const lastDate = dbLastDate ?? parquetLastDate;
  logger.log(`Last date: ${lastDate ?? 'none'} (source: ${dbLastDate ? 'stock.duckdb' : parquetLastDate ? 'current month parquet' : 'none'})`);

  const range = calcFetchRange(lastDate, todayStr, monthStart);
  if (!range) {
    logger.log(`Already up to date (last date: ${lastDate ?? 'none'}).`);
    return;
  }

  // キャッシュキー = "period1_period2"（当日ユニーク）
  const cacheKey = `${range.period1}_${range.period2}`;
  const cacheDir = join(UPDATE_CACHE_BASE, cacheKey);

  // 前日以前のキャッシュを削除
  pruneOldCaches(cacheKey, logger);
  mkdirSync(cacheDir, { recursive: true });

  const cachedFiles = existsSync(cacheDir)
    ? readdirSync(cacheDir).filter(f => f.endsWith('.json')).length
    : 0;
  logger.log(`Step 2: Fetching ${range.period1} ~ ${range.period2} for ${tickers.length} tickers (cache: ${cacheDir}, ${cachedFiles} cached)...`);

  // Step 3: 差分を取得（逐次、キャッシュあり）
  const errors: ErrorRecord[] = [];
  const newRecords: PriceRecord[] = [];
  let done = 0;
  let cached = 0;

  for (const ticker of tickers) {
    const cachePath = join(cacheDir, `${ticker.code}.json`);

    if (existsSync(cachePath)) {
      // キャッシュから読み込み（再実行時のスキップ）
      const records: PriceRecord[] = JSON.parse(readFileSync(cachePath, 'utf-8'));
      newRecords.push(...records);
      done++;
      cached++;
      logger.progress(`${done}/${tickers.length} (${cached} cached)`);
      continue;
    }

    try {
      const records = await fetchTickerRange(ticker.code, range.period1, range.period2);
      writeFileSync(cachePath, JSON.stringify(records));
      newRecords.push(...records);
    } catch (err) {
      errors.push({
        ticker: ticker.code,
        period: `${range.period1}~${range.period2}`,
        reason: String(err),
      });
      logger.error(`Failed: ${ticker.code} — ${err}`);
    }
    done++;
    logger.progress(`${done}/${tickers.length}`);
    if (done % 100 === 0) {
      logger.log(`Progress: ${done}/${tickers.length} fetched, ${newRecords.length} records, ${errors.length} errors`);
    }
    if (done < tickers.length) {
      await new Promise(res => setTimeout(res, DELAY_MS));
    }
  }
  logger.done();
  logger.log(`Fetch complete: ${newRecords.length} new records, ${cached} cached, ${errors.length} errors`);

  // Step 4: 当月Parquetを既存データとマージして上書き
  logger.log(`Step 3: Merging into ${parquetPath}...`);
  const existing = await readParquet(parquetPath);
  const merged = mergeRecords(existing, newRecords);
  await writeParquet(parquetPath, merged);
  logger.log(`Updated ${parquetPath}: ${existing.length} → ${merged.length} rows`);

  if (errors.length > 0) {
    writeFileSync('errors.json', JSON.stringify(errors, null, 2));
    logger.error(`${errors.length} errors saved to errors.json`);
  }

  // Step 5: DuckDB再構築
  logger.log('Step 4: Rebuilding stock.duckdb...');
  await buildDuckDb();
  logger.log('Done!');
}

main().catch(console.error);
