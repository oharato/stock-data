import { DuckDBInstance } from '@duckdb/node-api';
import { existsSync, writeFileSync, readFileSync, unlinkSync, renameSync } from 'fs';
import { resolve, join } from 'path';
import { tmpdir } from 'os';

export async function buildDuckDb(
  rawGlob: string = 'data/raw/*.json',
  dbPath: string = 'stock.duckdb',
  tickersPath: string = 'data/tickers.json'
): Promise<void> {
  const absGlob = resolve(rawGlob).replace(/\\/g, '/');
  const absDb = resolve(dbPath);
  const tempDbPath = `${absDb}.tmp`;
  const absTickersPath = resolve(tickersPath);

  // Clean up stale temp DB from previous runs
  if (existsSync(tempDbPath)) {
    try {
      unlinkSync(tempDbPath);
    } catch {}
  }

  const inst = await DuckDBInstance.create(tempDbPath);
  const conn = await inst.connect();
  try {
    // 1. prices table
    await conn.run(`
      CREATE OR REPLACE TABLE prices AS
      SELECT
        date::VARCHAR AS date,
        ticker::VARCHAR AS ticker,
        open::DOUBLE AS open,
        high::DOUBLE AS high,
        low::DOUBLE AS low,
        close::DOUBLE AS close,
        adj_close::DOUBLE AS adj_close,
        volume::BIGINT AS volume
      FROM read_json_auto('${absGlob}')
      WHERE date IS NOT NULL AND ticker IS NOT NULL
      ORDER BY date, ticker
    `);
    const priceResult = await conn.runAndReadAll('SELECT COUNT(*) AS cnt FROM prices');
    const priceRows = priceResult.getRowObjects();
    console.log(`prices: ${Number((priceRows[0] as any).cnt)} rows`);

    // 2. tickers table (populated from data/tickers.json if available)
    if (existsSync(absTickersPath)) {
      const tempCsv = join(tmpdir(), `tickers-${process.pid}-${Date.now()}.csv`);
      const tickers: any[] = JSON.parse(readFileSync(absTickersPath, 'utf-8'));
      const header = 'code,name,market,sector33';
      const lines = tickers.map(
        t => `${csvEscape(t.code)},${csvEscape(t.name)},${csvEscape(t.market)},${csvEscape(t.sector33 || '')}`
      );
      writeFileSync(tempCsv, `${header}\n${lines.join('\n')}`);
      try {
        await conn.run(`
          CREATE OR REPLACE TABLE tickers AS
          SELECT
            code::VARCHAR AS code,
            name::VARCHAR AS name,
            market::VARCHAR AS market,
            sector33::VARCHAR AS sector33,
            CAST(NULL AS BIGINT) AS market_cap,
            CAST(NULL AS VARCHAR) AS ipo_date
          FROM read_csv('${tempCsv}', header=true, columns={
            'code': 'VARCHAR', 'name': 'VARCHAR', 'market': 'VARCHAR', 'sector33': 'VARCHAR'
          })
        `);

        // Compute simulated IPO date from prices min date
        // Only set for tickers with sufficient price history (>=5 rows) to avoid
        // setting wrong dates for delisting-candidate stocks with sparse data
        console.log('Computing IPO dates from price history...');
        await conn.run(`
          UPDATE tickers
          SET ipo_date = (
            SELECT MIN(date) FROM prices 
            WHERE prices.ticker = tickers.code
            HAVING COUNT(*) >= 5
          )
        `);

        const tickerResult = await conn.runAndReadAll('SELECT COUNT(*) AS cnt FROM tickers');
        const tickerRows = tickerResult.getRowObjects();
        console.log(`tickers: ${Number((tickerRows[0] as any).cnt)} rows`);
      } finally {
        unlinkSync(tempCsv);
      }
    }

    // 3. Create database index on ticker column for optimized queries
    console.log('Creating database index on ticker column...');
    await conn.run('CREATE INDEX IF NOT EXISTS idx_prices_ticker ON prices (ticker)');
  } finally {
    conn.disconnectSync();
    inst.closeSync();
  }

  // Atomically swap the new database into place
  renameSync(tempDbPath, absDb);
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
