import { readFileSync, writeFileSync, existsSync } from 'fs';
import pLimit from 'p-limit';
import type { Ticker, PriceRecord, ErrorRecord } from './domain/types.js';
import { fetchTickerYear } from './repository/yahoo.js';
import { writeParquet } from './repository/parquet.js';
import { getMonthKey, monthParquetPath } from './logic/date-utils.js';

const CONCURRENCY = 5;
const START_YEAR = 2000;

async function main() {
  if (!existsSync('tickers.json')) {
    console.error('tickers.json not found. Run: npm run fetch-tickers');
    process.exit(1);
  }

  const tickers: Ticker[] = JSON.parse(readFileSync('tickers.json', 'utf-8'));
  const errors: ErrorRecord[] = [];
  const currentYear = new Date().getFullYear();
  const limit = pLimit(CONCURRENCY);

  for (let year = START_YEAR; year <= currentYear; year++) {
    if (year < currentYear) {
      const allExist = Array.from({ length: 12 }, (_, i) => i + 1)
        .every(m => existsSync(monthParquetPath(year, m)));
      if (allExist) {
        console.log(`[${year}] All 12 months exist, skipping.`);
        continue;
      }
    }

    console.log(`\n[${year}] Fetching ${tickers.length} tickers (concurrency=${CONCURRENCY})...`);

    const monthData = new Map<string, PriceRecord[]>();
    let done = 0;

    await Promise.all(
      tickers.map(ticker =>
        limit(async () => {
          try {
            const records = await fetchTickerYear(ticker.code, year);
            for (const record of records) {
              const key = getMonthKey(record.date);
              const arr = monthData.get(key);
              if (arr) {
                arr.push(record);
              } else {
                monthData.set(key, [record]);
              }
            }
          } catch (err) {
            errors.push({ ticker: ticker.code, period: String(year), reason: String(err) });
          }
          done++;
          if (done % 500 === 0 || done === tickers.length) {
            process.stdout.write(`\r  ${done}/${tickers.length}`);
          }
        })
      )
    );

    console.log('');

    for (const [monthKey, records] of monthData) {
      const [y, m] = monthKey.split('-');
      const outputPath = monthParquetPath(Number(y), Number(m));
      records.sort((a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker));
      await writeParquet(outputPath, records);
      console.log(`  Written: ${outputPath} (${records.length} rows)`);
    }
  }

  if (errors.length > 0) {
    writeFileSync('errors.json', JSON.stringify(errors, null, 2));
    console.log(`\n${errors.length} errors saved to errors.json`);
  }

  console.log('\nInitial fetch complete!');
}

main().catch(console.error);
