// src/repository/duckdb.ts
import { DuckDBInstance } from '@duckdb/node-api';
import { existsSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { resolve, join } from 'path';
import { tmpdir } from 'os';

export async function buildDuckDb(
  parquetGlob: string = 'data/prices/*/*.parquet',
  dbPath: string = 'stock.duckdb',
  tickersPath: string = 'tickers.json'
): Promise<void> {
  const absGlob = resolve(parquetGlob).replace(/\\/g, '/');
  const absDb = resolve(dbPath);
  const absTickersPath = resolve(tickersPath);

  const inst = await DuckDBInstance.create(absDb);
  const conn = await inst.connect();
  try {
    // prices テーブル
    await conn.run(`
      CREATE OR REPLACE TABLE prices AS
      SELECT * FROM read_parquet('${absGlob}')
      ORDER BY date, ticker
    `);
    const priceResult = await conn.runAndReadAll('SELECT COUNT(*) AS cnt FROM prices');
    const priceRows = priceResult.getRowObjects();
    console.log(`prices: ${Number((priceRows[0] as any).cnt)} rows`);

    // tickers テーブル（tickers.json があれば取り込む）
    if (existsSync(absTickersPath)) {
      const tempCsv = join(tmpdir(), `tickers-${process.pid}-${Date.now()}.csv`);
      const tickers: { code: string; name: string; market: string }[] =
        JSON.parse(readFileSync(absTickersPath, 'utf-8'));
      const header = 'code,name,market';
      const lines = tickers.map(
        t => `${csvEscape(t.code)},${csvEscape(t.name)},${csvEscape(t.market)}`
      );
      writeFileSync(tempCsv, `${header}\n${lines.join('\n')}`);
      try {
        await conn.run(`
          CREATE OR REPLACE TABLE tickers AS
          SELECT * FROM read_csv('${tempCsv}', header=true, columns={
            'code': 'VARCHAR', 'name': 'VARCHAR', 'market': 'VARCHAR'
          })
        `);
        const tickerResult = await conn.runAndReadAll('SELECT COUNT(*) AS cnt FROM tickers');
        const tickerRows = tickerResult.getRowObjects();
        console.log(`tickers: ${Number((tickerRows[0] as any).cnt)} rows`);
      } finally {
        unlinkSync(tempCsv);
      }
    }
  } finally {
    conn.disconnectSync();
    inst.closeSync();
  }
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
