import { writeFileSync, mkdirSync, existsSync, copyFileSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';
import { DuckDBInstance } from '@duckdb/node-api';
import pLimit from 'p-limit';
import {
  fetchDailyPrices,
  fetchWeeklyPrices,
  fetchMonthlyPrices,
  closeCachedDbConnections,
} from '../shared/repository/duckdb.js';
import { generateChartWebp } from './generator.js';
import { createLogger } from '../shared/logic/logger.js';

// Concurrency limit for generating images in parallel
const CONCURRENCY_LIMIT = 5;

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

async function main() {
  const logger = createLogger('generate-charts-batch');
  logger.log(`Starting batch chart generation (log: ${logger.logFile})`);

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

  // Copy database file to avoid lock conflict with other running processes (MCP server etc.)
  const originalDb = resolve('stock.duckdb');
  const tempDb = resolve('stock.duckdb.tmp-batch');
  
  if (!existsSync(originalDb)) {
    logger.error(`Database file not found: ${originalDb}`);
    process.exit(1);
  }

  logger.log('Copying database file to avoid lock conflicts...');
  copyFileSync(originalDb, tempDb);

  try {
    // Fetch all stock tickers
    logger.log('Fetching ticker list from DB...');
    const tickers = await getTickersFromDb(tempDb);
    logger.log(`Found ${tickers.length} tickers to process.`);


    const limit = pLimit(CONCURRENCY_LIMIT);
    let completed = 0;
    let failed = 0;

    const startTime = Date.now();

    const tasks = tickers.map(t => {
      return limit(async () => {
        const { code, name } = t;
        try {
          // 1. Daily Chart (120 trading days)
          const dailyData = await fetchDailyPrices(code, 120, tempDb);
          if (dailyData.length > 0) {
            const dailyWebp = await generateChartWebp(dailyData, {
              title: name,
              ticker: code,
              type: 'daily',
            });
            writeFileSync(join(dirs.daily, `${code}.webp`), dailyWebp);
          }

          // 2. Weekly Chart (100 weeks)
          const weeklyData = await fetchWeeklyPrices(code, 100, tempDb);
          if (weeklyData.length > 0) {
            const weeklyWebp = await generateChartWebp(weeklyData, {
              title: name,
              ticker: code,
              type: 'weekly',
            });
            writeFileSync(join(dirs.weekly, `${code}.webp`), weeklyWebp);
          }

          // 3. Monthly Chart (120 months)
          const monthlyData = await fetchMonthlyPrices(code, 120, tempDb);
          if (monthlyData.length > 0) {
            const monthlyWebp = await generateChartWebp(monthlyData, {
              title: name,
              ticker: code,
              type: 'monthly',
            });
            writeFileSync(join(dirs.monthly, `${code}.webp`), monthlyWebp);
          }

          completed++;
        } catch (err) {
          failed++;
          logger.error(`Failed to generate charts for ${name} (${code}): ${err}`);
        } finally {
          const totalProcessed = completed + failed;
          const elapsedMs = Date.now() - startTime;
          const elapsedSec = elapsedMs / 1000;
          
          // Speed (tickers per second)
          const speed = (totalProcessed / (elapsedSec || 1)).toFixed(1);
          
          // Progress percentage
          const pct = ((totalProcessed / tickers.length) * 100).toFixed(1);
          
          // Estimated Time of Arrival (ETA)
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

          // Print real-time progress on stdout (updates inline)
          logger.progress(`Progress: ${totalProcessed}/${tickers.length} (${pct}%) | Failed: ${failed} | Speed: ${speed} t/s | ETA: ${etaStr}`);

          // Log checkpoint to log file every 100 tickers
          if (totalProcessed % 100 === 0 || totalProcessed === tickers.length) {
            const elapsedMin = (elapsedSec / 60).toFixed(1);
            logger.log(`Progress Checkpoint: ${totalProcessed}/${tickers.length} (${pct}%) | Failed: ${failed} | Speed: ${speed} t/s | Elapsed: ${elapsedMin} min`);
          }
        }
      });
    });

    // Wait for all tasks to finish
    await Promise.all(tasks);
    logger.done();

    const totalTimeSec = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.log(`Batch execution complete!`);
    logger.log(`Total processed: ${completed + failed} tickers`);
    logger.log(`Successfully completed: ${completed}`);
    logger.log(`Failed: ${failed}`);
    logger.log(`Total time: ${totalTimeSec} seconds`);

  } finally {
    // Close all cached DB connections
    await closeCachedDbConnections();
    // Delete database temporary copy
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
