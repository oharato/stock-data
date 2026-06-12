// src/repository/duckdb.test.ts
import { describe, it, expect, afterAll } from 'vitest';
import { buildDuckDb } from './duckdb.js';
import { writeParquet } from './parquet.js';
import { DuckDBInstance } from '@duckdb/node-api';
import { join } from 'path';
import { tmpdir } from 'os';
import { rmSync, existsSync, mkdirSync } from 'fs';

const testBase = join(tmpdir(), `duckdb-test-${process.pid}-${Date.now()}`);
const testDbPath = join(testBase, 'test.duckdb');

afterAll(() => {
  if (existsSync(testBase)) rmSync(testBase, { recursive: true });
});

describe('buildDuckDb', () => {
  it('creates prices table from monthly parquet files', async () => {
    const parquetDir = join(testBase, 'prices', '2024');
    mkdirSync(parquetDir, { recursive: true });
    await writeParquet(join(parquetDir, '01.parquet'), [
      { date: '2024-01-04', ticker: '7203.T', open: 2500, high: 2550, low: 2490, close: 2530, adj_close: 2530, volume: 1000000 },
      { date: '2024-01-04', ticker: '1234.T', open: 1000, high: 1010, low: 990, close: 1005, adj_close: 1005, volume: 50000 },
    ]);

    const parquetGlob = join(testBase, 'prices', '*', '*.parquet');
    await buildDuckDb(parquetGlob, testDbPath);

    const inst = await DuckDBInstance.create(testDbPath);
    const conn = await inst.connect();
    const countResult = await conn.runAndReadAll('SELECT COUNT(*) AS cnt FROM prices');
    const tickerResult = await conn.runAndReadAll('SELECT DISTINCT ticker FROM prices ORDER BY ticker');
    conn.disconnectSync();
    inst.closeSync();

    const countRows = countResult.getRowObjects();
    const tickerRows = tickerResult.getRowObjects();

    expect(Number((countRows[0] as any).cnt)).toBe(2);
    expect(tickerRows.map((r: any) => r.ticker)).toEqual(['1234.T', '7203.T']);
  });
});
