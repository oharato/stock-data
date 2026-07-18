// src/repository/duckdb.ts
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { existsSync, writeFileSync, readFileSync, unlinkSync, renameSync } from 'fs';
import { resolve, join } from 'path';
import { tmpdir } from 'os';

const dbCache: Record<string, DuckDBInstance> = {};

async function getCachedInstance(dbPath: string): Promise<DuckDBInstance> {
  const absPath = resolve(dbPath);
  if (!dbCache[absPath]) {
    dbCache[absPath] = await DuckDBInstance.create(absPath, { access_mode: 'READ_ONLY' });
  }
  return dbCache[absPath];
}

export async function closeCachedDbConnections(): Promise<void> {
  for (const path of Object.keys(dbCache)) {
    const inst = dbCache[path];
    try {
      inst.closeSync();
    } catch {}
    delete dbCache[path];
  }
}

/** stock.duckdb の prices テーブルから全データの最終日を取得する */
export async function readDbMaxDate(dbPath: string = 'stock.duckdb'): Promise<string | null> {
  const absDb = resolve(dbPath);
  if (!existsSync(absDb)) return null;
  const inst = await DuckDBInstance.create(absDb);
  const conn = await inst.connect();
  try {
    const result = await conn.runAndReadAll('SELECT max(date)::VARCHAR AS max_date FROM prices');
    const rows = result.getRowObjects();
    return (rows[0] as any)?.max_date ?? null;
  } catch {
    return null; // pricesテーブルが存在しない場合など
  } finally {
    conn.disconnectSync();
    inst.closeSync();
  }
}

export async function buildDuckDb(
  rawGlob: string = 'data/raw/*.json',
  dbPath: string = 'stock.duckdb',
  tickersPath: string = 'tickers.json'
): Promise<void> {
  const absGlob = resolve(rawGlob).replace(/\\/g, '/');
  const absDb = resolve(dbPath);
  const tempDbPath = `${absDb}.tmp`;
  const absTickersPath = resolve(tickersPath);

  // 以前のビルド時の一時ファイルが残っていれば削除しておく
  if (existsSync(tempDbPath)) {
    try {
      unlinkSync(tempDbPath);
    } catch {}
  }

  const inst = await DuckDBInstance.create(tempDbPath);
  const conn = await inst.connect();
  try {
    // prices テーブル
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

    // tickers テーブル（tickers.json があれば取り込む）
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

    // Create database index on ticker column for optimized queries
    console.log('Creating database index on ticker column...');
    await conn.run('CREATE INDEX IF NOT EXISTS idx_prices_ticker ON prices (ticker)');
  } finally {
    conn.disconnectSync();
    inst.closeSync();
  }

  // 完全に完了した後にリネームして入れ替える
  renameSync(tempDbPath, absDb);
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export interface StockPriceRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ma1: number | null;
  ma2: number | null;
  ma3: number | null;
}

function escapeSqlString(str: string): string {
  return str.replace(/'/g, "''");
}

export async function fetchDailyPrices(
  ticker: string,
  limit: number = 100,
  dbPath: string = 'stock.duckdb'
): Promise<StockPriceRow[]> {
  const inst = await getCachedInstance(dbPath);
  const conn = await inst.connect();
  try {
    const escapedTicker = escapeSqlString(ticker);
    const query = `
      WITH ordered_prices AS (
        SELECT * FROM prices
        WHERE ticker = '${escapedTicker}'
        ORDER BY date ASC
      )
      SELECT 
        date::VARCHAR as date,
        open,
        high,
        low,
        close,
        volume,
        AVG(close) OVER (ORDER BY date ROWS BETWEEN 4 PRECEDING AND CURRENT ROW) as ma5,
        AVG(close) OVER (ORDER BY date ROWS BETWEEN 24 PRECEDING AND CURRENT ROW) as ma25,
        AVG(close) OVER (ORDER BY date ROWS BETWEEN 74 PRECEDING AND CURRENT ROW) as ma75
      FROM ordered_prices
      ORDER BY date DESC
      LIMIT ${limit}
    `;
    const result = await conn.runAndReadAll(query);
    const rows = result.getRowObjects() as any[];
    return rows.map(r => ({
      date: r.date,
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
      ma1: r.ma5 !== null && r.ma5 !== undefined ? Number(r.ma5) : null,
      ma2: r.ma25 !== null && r.ma25 !== undefined ? Number(r.ma25) : null,
      ma3: r.ma75 !== null && r.ma75 !== undefined ? Number(r.ma75) : null,
    })).reverse();
  } finally {
    conn.disconnectSync();
  }
}

export async function fetchWeeklyPrices(
  ticker: string,
  limit: number = 100,
  dbPath: string = 'stock.duckdb'
): Promise<StockPriceRow[]> {
  const inst = await getCachedInstance(dbPath);
  const conn = await inst.connect();
  try {
    const escapedTicker = escapeSqlString(ticker);
    const query = `
      WITH weekly_prices AS (
        SELECT 
          date_trunc('week', CAST(date AS DATE))::DATE as w_date,
          first(open ORDER BY date) as open,
          max(high) as high,
          min(low) as low,
          last(close ORDER BY date) as close,
          sum(volume) as volume
        FROM prices
        WHERE ticker = '${escapedTicker}'
        GROUP BY w_date
        ORDER BY w_date ASC
      )
      SELECT
        w_date::VARCHAR as date,
        open,
        high,
        low,
        close,
        volume,
        AVG(close) OVER (ORDER BY w_date ROWS BETWEEN 12 PRECEDING AND CURRENT ROW) as ma13,
        AVG(close) OVER (ORDER BY w_date ROWS BETWEEN 25 PRECEDING AND CURRENT ROW) as ma26
      FROM weekly_prices
      ORDER BY date DESC
      LIMIT ${limit}
    `;
    const result = await conn.runAndReadAll(query);
    const rows = result.getRowObjects() as any[];
    return rows.map(r => ({
      date: r.date,
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
      ma1: r.ma13 !== null && r.ma13 !== undefined ? Number(r.ma13) : null,
      ma2: r.ma26 !== null && r.ma26 !== undefined ? Number(r.ma26) : null,
      ma3: null,
    })).reverse();
  } finally {
    conn.disconnectSync();
  }
}

export async function fetchMonthlyPrices(
  ticker: string,
  limit: number = 100,
  dbPath: string = 'stock.duckdb'
): Promise<StockPriceRow[]> {
  const inst = await getCachedInstance(dbPath);
  const conn = await inst.connect();
  try {
    const escapedTicker = escapeSqlString(ticker);
    const query = `
      WITH monthly_prices AS (
        SELECT 
          date_trunc('month', CAST(date AS DATE))::DATE as m_date,
          first(open ORDER BY date) as open,
          max(high) as high,
          min(low) as low,
          last(close ORDER BY date) as close,
          sum(volume) as volume
        FROM prices
        WHERE ticker = '${escapedTicker}'
        GROUP BY m_date
        ORDER BY m_date ASC
      )
      SELECT
        m_date::VARCHAR as date,
        open,
        high,
        low,
        close,
        volume,
        AVG(close) OVER (ORDER BY m_date ROWS BETWEEN 11 PRECEDING AND CURRENT ROW) as ma12,
        AVG(close) OVER (ORDER BY m_date ROWS BETWEEN 23 PRECEDING AND CURRENT ROW) as ma24
      FROM monthly_prices
      ORDER BY date DESC
      LIMIT ${limit}
    `;
    const result = await conn.runAndReadAll(query);
    const rows = result.getRowObjects() as any[];
    return rows.map(r => ({
      date: r.date,
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
      ma1: r.ma12 !== null && r.ma12 !== undefined ? Number(r.ma12) : null,
      ma2: r.ma24 !== null && r.ma24 !== undefined ? Number(r.ma24) : null,
      ma3: null,
    })).reverse();
  } finally {
    conn.disconnectSync();
  }
}
