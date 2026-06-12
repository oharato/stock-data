// src/repository/duckdb.ts
import { DuckDBInstance } from '@duckdb/node-api';
import { resolve } from 'path';

export async function buildDuckDb(
  parquetGlob: string = 'data/prices/*/*.parquet',
  dbPath: string = 'stock.duckdb'
): Promise<void> {
  const absGlob = resolve(parquetGlob).replace(/\\/g, '/');
  const absDb = resolve(dbPath);

  const inst = await DuckDBInstance.create(absDb);
  const conn = await inst.connect();
  try {
    await conn.run(`
      CREATE OR REPLACE TABLE prices AS
      SELECT * FROM read_parquet('${absGlob}')
      ORDER BY date, ticker
    `);
    const result = await conn.runAndReadAll('SELECT COUNT(*) AS cnt FROM prices');
    const rows = result.getRowObjects();
    console.log(`stock.duckdb built: ${Number((rows[0] as any).cnt)} rows in prices table`);
  } finally {
    conn.disconnectSync();
    inst.closeSync();
  }
}
