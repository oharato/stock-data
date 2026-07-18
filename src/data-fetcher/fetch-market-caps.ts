import { writeFileSync, existsSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import YahooFinance from 'yahoo-finance2';
import { DuckDBInstance } from '@duckdb/node-api';
import { createLogger } from '../shared/logic/logger.js';
const yahooFinance = new YahooFinance({ suppressNotices: ['ripHistorical'] });

const CHUNK_SIZE = 50;
const DELAY_MS = 500; // API delay to avoid rate limit

async function main() {
  const logger = createLogger('fetch-market-caps');
  logger.log(`Starting fetch-market-caps (log: ${logger.logFile})`);

  const dbPath = resolve('stock.duckdb');
  if (!existsSync(dbPath)) {
    logger.error(`Database not found at ${dbPath}`);
    process.exit(1);
  }

  // 1. Get tickers from DB (both existing tickers and tickers in prices but NOT in tickers table)
  const inst = await DuckDBInstance.create(dbPath);
  const conn = await inst.connect();
  let tickers: string[] = [];
  let missingFromTickers: string[] = [];
  try {
    const res = await conn.runAndReadAll('SELECT code::VARCHAR AS code FROM tickers ORDER BY code ASC');
    tickers = res.getRowObjects().map((r: any) => r.code);

    // Find tickers present in prices but missing from tickers table (e.g. new listings with alphanumeric codes)
    const missingRes = await conn.runAndReadAll(`
      SELECT DISTINCT p.ticker::VARCHAR AS code
      FROM prices p
      LEFT JOIN tickers t ON p.ticker = t.code
      WHERE t.code IS NULL
      ORDER BY p.ticker ASC
    `);
    missingFromTickers = missingRes.getRowObjects().map((r: any) => r.code);
    if (missingFromTickers.length > 0) {
      logger.log(`Found ${missingFromTickers.length} tickers in prices but missing from tickers table. Will fetch and insert.`);
    }
  } catch (err) {
    logger.error(`Failed to read tickers: ${err}`);
    conn.disconnectSync();
    inst.closeSync();
    process.exit(1);
  }

  // Combine both lists - existing tickers + missing ones from prices
  const allTickersToFetch = [...new Set([...tickers, ...missingFromTickers])];
  logger.log(`Found ${tickers.length} tickers in tickers table + ${missingFromTickers.length} missing. Fetching ${allTickersToFetch.length} total...`);

  const results: { code: string; marketCap: number | null; ipoDate: string | null }[] = [];
  let done = 0;

  // Split into chunks of CHUNK_SIZE
  const newTickerQuotes: { code: string; name: string; market: string; sector33: string; marketCap: number | null; ipoDate: string | null }[] = [];

  for (let i = 0; i < allTickersToFetch.length; i += CHUNK_SIZE) {
    const chunk = allTickersToFetch.slice(i, i + CHUNK_SIZE);
    try {
      // Fetch quote info in bulk
      const quotes = await yahooFinance.quote(chunk);
      for (const quote of quotes) {
        if (quote.symbol) {
          const marketCap = typeof quote.marketCap === 'number' ? quote.marketCap : null;
          
          let ipoDate: string | null = null;
          if (quote.newListingDate) {
            const d = new Date(quote.newListingDate);
            if (!isNaN(d.getTime())) {
              ipoDate = d.toISOString().split('T')[0];
            }
          }
          // NOTE: firstTradeDateMilliseconds is NOT used — it's unreliable for existing stocks
          // (returns recent trading dates instead of actual IPO dates).
          // Only newListingDate (set by Yahoo Finance for new listings) is trustworthy.

          results.push({
            code: quote.symbol,
            marketCap,
            ipoDate,
          });

          // Track newly listed tickers that need to be inserted
          if (missingFromTickers.includes(quote.symbol)) {
            newTickerQuotes.push({
              code: quote.symbol,
              name: quote.shortName || quote.longName || quote.symbol,
              market: '',
              sector33: '',
              marketCap,
              ipoDate,
            });
          }
        }
      }
    } catch (err) {
      logger.error(`Failed to fetch chunk starting at index ${i}: ${err}`);
    }

    done += chunk.length;
    logger.progress(`${done}/${allTickersToFetch.length} tickers processed (${results.length} quotes fetched)`);

    if (i + CHUNK_SIZE < allTickersToFetch.length) {
      await new Promise(res => setTimeout(res, DELAY_MS));
    }
  }
  logger.done();

  logger.log(`Fetched ${results.length} quotes. Updating database...`);

  // Write to temporary CSV for bulk update
  const tempCsv = join(tmpdir(), `market-caps-${process.pid}-${Date.now()}.csv`);
  const header = 'code,market_cap,ipo_date';
  const lines = results.map(r => `${r.code},${r.marketCap !== null ? r.marketCap : ''},${r.ipoDate !== null ? r.ipoDate : ''}`);
  writeFileSync(tempCsv, `${header}\n${lines.join('\n')}`);

  try {
    // 1. Create temporary table
    await conn.run(`
      CREATE OR REPLACE TEMPORARY TABLE temp_caps AS
      SELECT 
        code::VARCHAR AS code, 
        market_cap::BIGINT AS market_cap,
        ipo_date::VARCHAR AS ipo_date
      FROM read_csv('${tempCsv.replace(/\\/g, '/')}', header=true, columns={'code': 'VARCHAR', 'market_cap': 'BIGINT', 'ipo_date': 'VARCHAR'})
    `);

    // 2. Perform bulk update for existing tickers
    await conn.run(`
      UPDATE tickers
      SET 
        market_cap = temp_caps.market_cap,
        ipo_date = COALESCE(temp_caps.ipo_date, tickers.ipo_date)
      FROM temp_caps
      WHERE tickers.code = temp_caps.code
    `);

    // 3. Insert newly listed tickers that were missing from tickers table
    if (newTickerQuotes.length > 0) {
      logger.log(`Inserting ${newTickerQuotes.length} newly listed tickers into tickers table...`);
      for (const t of newTickerQuotes) {
        const escapedCode = t.code.replace(/'/g, "''");
        const escapedName = (t.name || t.code).replace(/'/g, "''");
        const escapedMarket = (t.market || '').replace(/'/g, "''");
        const escapedSector = (t.sector33 || '').replace(/'/g, "''");
        const marketCapVal = t.marketCap !== null ? String(t.marketCap) : 'NULL';
        const ipoDateVal = t.ipoDate ? `'${t.ipoDate}'` : `(
          SELECT MIN(date)::VARCHAR FROM prices WHERE ticker = '${escapedCode}'
        )`;
        await conn.run(`
          INSERT INTO tickers (code, name, market, sector33, market_cap, ipo_date)
          SELECT '${escapedCode}', '${escapedName}', '${escapedMarket}', '${escapedSector}', ${marketCapVal}, ${ipoDateVal}
          WHERE NOT EXISTS (SELECT 1 FROM tickers WHERE code = '${escapedCode}')
        `);
      }
      logger.log(`Done inserting ${newTickerQuotes.length} newly listed tickers.`);
    }

    logger.log('Database market caps and IPO dates updated successfully!');
  } catch (err) {
    logger.error(`Failed to update database: ${err}`);
  } finally {
    if (existsSync(tempCsv)) {
      unlinkSync(tempCsv);
    }
    conn.disconnectSync();
    inst.closeSync();
  }

  logger.log('All done!');
}

main().catch(console.error);
