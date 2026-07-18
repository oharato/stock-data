import { promises as fs, mkdirSync, existsSync, copyFileSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';
import os from 'os';
import { DuckDBInstance } from '@duckdb/node-api';
import pLimit from 'p-limit';
import sharp from 'sharp';
import {
  fetchDailyPrices,
  fetchWeeklyPrices,
  fetchMonthlyPrices,
  closeCachedDbConnections,
} from '../shared/repository/duckdb.js';
import { generateChartWebp } from './generator.js';
import { createLogger } from '../shared/logic/logger.js';

// Optimize sharp image generation concurrency to avoid thread contention
sharp.concurrency(1);

// Determine dynamic concurrency limit based on the execution server's CPU threads (min 4, max 32)
const cpuCores = os.cpus().length;
const CONCURRENCY_LIMIT = Math.max(4, Math.min(cpuCores * 3, 32));

interface TickerRow {
  code: string;
  name: string;
}

async function getTickersFromDb(dbPath: string): Promise<TickerRow[]> {
  const absDb = resolve(dbPath);
  const inst = await DuckDBInstance.create(absDb, { access_mode: 'READ_ONLY' });
  const conn = await inst.connect();
  try {
    const result = await conn.runAndReadAll('SELECT code::VARCHAR as code, name::VARCHAR as name FROM tickers ORDER BY code ASC');
    const rows = result.getRowObjects() as any[];
    return rows.map(r => ({
      code: r.code,
      name: r.name,
    }));
  } finally {
    conn.disconnectSync();
    inst.closeSync();
  }
}

// Fetch the latest stock price date for all tickers to perform incremental skips
async function getLatestDatesFromDb(dbPath: string): Promise<Map<string, string>> {
  const absDb = resolve(dbPath);
  const inst = await DuckDBInstance.create(absDb, { access_mode: 'READ_ONLY' });
  const conn = await inst.connect();
  try {
    const result = await conn.runAndReadAll('SELECT ticker::VARCHAR as ticker, max(date)::VARCHAR as max_date FROM prices GROUP BY ticker');
    const rows = result.getRowObjects() as any[];
    const map = new Map<string, string>();
    for (const r of rows) {
      map.set(r.ticker, r.max_date);
    }
    return map;
  } finally {
    conn.disconnectSync();
    inst.closeSync();
  }
}

async function main() {
  const logger = createLogger('generate-charts-batch');
  logger.log(`Starting optimized batch chart generation (log: ${logger.logFile})`);
  logger.log(`Detected ${cpuCores} CPU cores. Dynamic concurrency limit set to: ${CONCURRENCY_LIMIT}`);

  // Ensure output directories exist
  const baseDir = './data/charts';
  const dirs = {
    daily: join(baseDir, 'daily'),
    weekly: join(baseDir, 'weekly'),
    monthly: join(baseDir, 'monthly'),
  };

  for (const dir of Object.values(dirs)) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  // Copy database file to avoid lock conflict with Hono server or fetch tasks
  const originalDb = resolve('stock.duckdb');
  const tempDb = resolve('stock.duckdb.tmp-batch');
  
  if (!existsSync(originalDb)) {
    logger.error(`Database file not found: ${originalDb}`);
    process.exit(1);
  }

  logger.log('Copying database file to avoid lock conflicts...');
  copyFileSync(originalDb, tempDb);

  try {
    // Fetch all stock tickers and their latest data dates
    logger.log('Fetching ticker list and latest price dates from DB...');
    const [tickers, latestDatesMap] = await Promise.all([
      getTickersFromDb(tempDb),
      getLatestDatesFromDb(tempDb)
    ]);
    logger.log(`Found ${tickers.length} tickers to process.`);

    const limit = pLimit(CONCURRENCY_LIMIT);
    let completed = 0;
    let failed = 0;
    let skipped = 0;

    const startTime = Date.now();

    const tasks = tickers.map(t => {
      return limit(async () => {
        const { code, name } = t;
        try {
          // Incremental generation skip logic:
          // Skip if daily, weekly, and monthly charts exist and are newer than the latest DB price date
          const maxDate = latestDatesMap.get(code);
          let shouldSkip = false;
          
          if (maxDate) {
            const paths = [
              join(dirs.daily, `${code}.webp`),
              join(dirs.weekly, `${code}.webp`),
              join(dirs.monthly, `${code}.webp`)
            ];
            
            if (paths.every(p => existsSync(p))) {
              const stats = await Promise.all(paths.map(p => fs.stat(p)));
              const minMtime = Math.min(...stats.map(s => s.mtimeMs));
              const maxDateTs = new Date(`${maxDate}T23:59:59Z`).getTime();
              
              if (minMtime >= maxDateTs) {
                shouldSkip = true;
              }
            }
          }

          if (shouldSkip) {
            skipped++;
            completed++;
            return;
          }

          // Fetch all 3 price datasets in parallel to minimize query latency
          const [dailyData, weeklyData, monthlyData] = await Promise.all([
            fetchDailyPrices(code, 120, tempDb),
            fetchWeeklyPrices(code, 100, tempDb),
            fetchMonthlyPrices(code, 120, tempDb)
          ]);

          const writePromises: Promise<void>[] = [];

          // Generate and queue file writes asynchronously
          if (dailyData.length > 0) {
            writePromises.push(
              generateChartWebp(dailyData, { title: name, ticker: code, type: 'daily' })
                .then(buf => fs.writeFile(join(dirs.daily, `${code}.webp`), buf))
            );
          }
          if (weeklyData.length > 0) {
            writePromises.push(
              generateChartWebp(weeklyData, { title: name, ticker: code, type: 'weekly' })
                .then(buf => fs.writeFile(join(dirs.weekly, `${code}.webp`), buf))
            );
          }
          if (monthlyData.length > 0) {
            writePromises.push(
              generateChartWebp(monthlyData, { title: name, ticker: code, type: 'monthly' })
                .then(buf => fs.writeFile(join(dirs.monthly, `${code}.webp`), buf))
            );
          }

          await Promise.all(writePromises);
          completed++;
        } catch (err) {
          failed++;
          logger.error(`Failed to generate charts for ${name} (${code}): ${err}`);
        } finally {
          const totalProcessed = completed + failed;
          const elapsedMs = Date.now() - startTime;
          const elapsedSec = elapsedMs / 1000;
          
          const speed = (totalProcessed / (elapsedSec || 1)).toFixed(1);
          const pct = ((totalProcessed / tickers.length) * 100).toFixed(1);
          
          const remainingTickers = tickers.length - totalProcessed;
          const avgTimePerTicker = elapsedMs / totalProcessed;
          const etaMs = remainingTickers * avgTimePerTicker;
          
          let etaStr = '--:--';
          if (isFinite(etaMs) && etaMs > 0) {
            const etaTotalSec = Math.ceil(etaMs / 1000);
            const etaMin = Math.floor(etaTotalSec / 60);
            const etaSec = etaTotalSec % 60;
            etaStr = `${String(etaMin).padStart(2, '0')}:${String(etaSec).padStart(2, '0')}`;
          }

          // Real-time console progress update
          logger.progress(`Progress: ${totalProcessed}/${tickers.length} (${pct}%) | Skipped: ${skipped} | Failed: ${failed} | Speed: ${speed} t/s | ETA: ${etaStr}`);

          // Log checkpoint to log file every 500 tickers
          if (totalProcessed % 500 === 0 || totalProcessed === tickers.length) {
            const elapsedMin = (elapsedSec / 60).toFixed(1);
            logger.log(`Checkpoint: ${totalProcessed}/${tickers.length} (${pct}%) | Skipped: ${skipped} | Failed: ${failed} | Speed: ${speed} t/s | Elapsed: ${elapsedMin} min`);
          }
        }
      });
    });

    await Promise.all(tasks);
    logger.done();

    const totalTimeSec = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.log(`Batch execution complete!`);
    logger.log(`Total processed: ${completed + failed} tickers`);
    logger.log(`Successfully completed: ${completed - skipped} (newly generated)`);
    logger.log(`Skipped (already up-to-date): ${skipped}`);
    logger.log(`Failed: ${failed}`);
    logger.log(`Total time: ${totalTimeSec} seconds`);

  } finally {
    await closeCachedDbConnections();
    if (existsSync(tempDb)) {
      logger.log('Cleaning up temporary DB copy...');
      unlinkSync(tempDb);
    }
  }
}

main().catch(err => {
  console.error('Fatal error during batch execution:', err);
  process.exit(1);
});
