import { readFileSync, writeFileSync } from 'fs';
import type { Ticker, PriceRecord, ErrorRecord } from './domain/types.js';
import { fetchTickerRange } from './repository/yahoo.js';
import { writeParquet, readParquet, readParquetMaxDate } from './repository/parquet.js';
import { buildDuckDb } from './repository/duckdb.js';
import { fetchAndSaveTickers } from './repository/jpx.js';
import { today, getCurrentYearMonth, monthParquetPath } from './logic/date-utils.js';
import { calcFetchRange, mergeRecords } from './logic/update-logic.js';

const DELAY_MS = 1000;

async function main() {
  // Step 1: tickers.jsonを最新のJPXリストで更新（新規上場・上場廃止を反映）
  const tickers: Ticker[] = await fetchAndSaveTickers();

  // Step 2: 当月Parquetの最終取得日を確認
  const { year, month } = getCurrentYearMonth();
  const parquetPath = monthParquetPath(year, month);
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDate = await readParquetMaxDate(parquetPath);
  const todayStr = today();

  const range = calcFetchRange(lastDate, todayStr, monthStart);
  if (!range) {
    console.log(`Already up to date (last date: ${lastDate ?? 'none'}).`);
    return;
  }

  console.log(`Fetching ${range.period1} ~ ${range.period2} for ${tickers.length} tickers (1 req/sec)...`);

  // Step 3: 差分を取得（逐次）
  const errors: ErrorRecord[] = [];
  const newRecords: PriceRecord[] = [];
  let done = 0;

  for (const ticker of tickers) {
    try {
      const records = await fetchTickerRange(ticker.code, range.period1, range.period2);
      newRecords.push(...records);
    } catch (err) {
      errors.push({
        ticker: ticker.code,
        period: `${range.period1}~${range.period2}`,
        reason: String(err),
      });
    }
    done++;
    if (done % 100 === 0 || done === tickers.length) {
      process.stdout.write(`\r  ${done}/${tickers.length}`);
    }
    if (done < tickers.length) {
      await new Promise(res => setTimeout(res, DELAY_MS));
    }
  }
  console.log('');

  // Step 4: 当月Parquetを既存データとマージして上書き
  const existing = await readParquet(parquetPath);
  const merged = mergeRecords(existing, newRecords);
  await writeParquet(parquetPath, merged);
  console.log(`Updated ${parquetPath} (${merged.length} rows total)`);

  if (errors.length > 0) {
    writeFileSync('errors.json', JSON.stringify(errors, null, 2));
    console.log(`${errors.length} errors saved to errors.json`);
  }

  // Step 5: DuckDB再構築
  await buildDuckDb();
  console.log('Done!');
}

main().catch(console.error);
