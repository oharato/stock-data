// src/repository/duckdb.test.ts
import { describe, it, expect, afterAll } from 'vitest';
import { buildDuckDb, readDbMaxDate } from './duckdb.js';
import { writeParquet } from './parquet.js';
import { DuckDBInstance } from '@duckdb/node-api';
import { join } from 'path';
import { tmpdir } from 'os';
import { rmSync, existsSync, mkdirSync, writeFileSync } from 'fs';

const testBase = join(tmpdir(), `duckdb-test-${process.pid}-${Date.now()}`);
const testDbPath = join(testBase, 'test.duckdb');
const testTickersPath = join(testBase, 'tickers.json');

afterAll(() => {
  if (existsSync(testBase)) rmSync(testBase, { recursive: true });
});

describe('buildDuckDb', () => {
  it('creates prices and tickers tables', async () => {
    const parquetDir = join(testBase, 'prices', '2024');
    mkdirSync(parquetDir, { recursive: true });
    await writeParquet(join(parquetDir, '01.parquet'), [
      { date: '2024-01-04', ticker: '7203.T', open: 2500, high: 2550, low: 2490, close: 2530, adj_close: 2530, volume: 1000000 },
      { date: '2024-01-04', ticker: '1234.T', open: 1000, high: 1010, low: 990, close: 1005, adj_close: 1005, volume: 50000 },
    ]);

    writeFileSync(testTickersPath, JSON.stringify([
      { code: '7203.T', name: 'トヨタ自動車', market: 'プライム（内国株式）' },
      { code: '1234.T', name: 'テスト銘柄', market: 'スタンダード（内国株式）' },
    ]));

    const parquetGlob = join(testBase, 'prices', '*', '*.parquet');
    await buildDuckDb(parquetGlob, testDbPath, testTickersPath);

    const inst = await DuckDBInstance.create(testDbPath);
    const conn = await inst.connect();
    const priceCount = await conn.runAndReadAll('SELECT COUNT(*) AS cnt FROM prices');
    const tickerCount = await conn.runAndReadAll('SELECT COUNT(*) AS cnt FROM tickers');
    const tickerRow = await conn.runAndReadAll("SELECT name FROM tickers WHERE code = '7203.T'");
    conn.disconnectSync();
    inst.closeSync();

    expect(Number((priceCount.getRowObjects()[0] as any).cnt)).toBe(2);
    expect(Number((tickerCount.getRowObjects()[0] as any).cnt)).toBe(2);
    expect((tickerRow.getRowObjects()[0] as any).name).toBe('トヨタ自動車');
  });

  it('creates only prices table when tickers.json is absent', async () => {
    const db2Path = join(testBase, 'test2.duckdb');
    const parquetGlob = join(testBase, 'prices', '*', '*.parquet');
    await buildDuckDb(parquetGlob, db2Path, join(testBase, 'nonexistent.json'));

    const inst = await DuckDBInstance.create(db2Path);
    const conn = await inst.connect();
    const priceCount = await conn.runAndReadAll('SELECT COUNT(*) AS cnt FROM prices');
    // tickers テーブルが存在しないことを確認
    let tickersExists = false;
    try {
      await conn.runAndReadAll('SELECT 1 FROM tickers LIMIT 1');
      tickersExists = true;
    } catch { /* expected */ }
    conn.disconnectSync();
    inst.closeSync();

    expect(Number((priceCount.getRowObjects()[0] as any).cnt)).toBe(2);
    expect(tickersExists).toBe(false);
  });
});

describe('readDbMaxDate', () => {
  it('returns max date from prices table', async () => {
    expect(await readDbMaxDate(testDbPath)).toBe('2024-01-04');
  });

  it('returns null for non-existent db', async () => {
    expect(await readDbMaxDate(join(testBase, 'nonexistent.duckdb'))).toBeNull();
  });
});
