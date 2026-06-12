// src/repository/parquet.test.ts
import { describe, it, expect, afterAll } from 'vitest';
import { buildTickerParquets } from './parquet.js';
import { DuckDBInstance } from '@duckdb/node-api';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../logic/logger.js';

const testBase = join(process.cwd(), `.test-tmp/parquet-test-${process.pid}-${Date.now()}`);

afterAll(() => {
  if (existsSync(testBase)) rmSync(testBase, { recursive: true });
});

describe('buildTickerParquets', () => {
  it('creates one parquet per ticker from JSON glob', async () => {
    const rawDir = join(testBase, 'raw');
    const pricesDir = join(testBase, 'prices-build');
    mkdirSync(rawDir, { recursive: true });

    writeFileSync(join(rawDir, '7203.T.json'), JSON.stringify([
      { date: '2024-01-04', ticker: '7203.T', open: 2500, high: 2550, low: 2490, close: 2530, adj_close: 2530, volume: 1000000 },
      { date: '2024-01-05', ticker: '7203.T', open: 2530, high: 2560, low: 2510, close: 2540, adj_close: 2540, volume: 900000 },
    ]));
    writeFileSync(join(rawDir, '1234.T.json'), JSON.stringify([
      { date: '2024-01-04', ticker: '1234.T', open: 1000, high: 1010, low: 990, close: 1005, adj_close: 1005, volume: 50000 },
    ]));

    const logger = createLogger('test-build');
    const count = await buildTickerParquets(`${rawDir}/*.json`, pricesDir, logger);

    expect(count).toBe(2);
    expect(existsSync(join(pricesDir, '7203.T.parquet'))).toBe(true);
    expect(existsSync(join(pricesDir, '1234.T.parquet'))).toBe(true);

    const inst = await DuckDBInstance.create(':memory:');
    const conn = await inst.connect();
    const r = await conn.runAndReadAll(
      `SELECT COUNT(*) AS cnt FROM read_parquet('${join(pricesDir, '7203.T.parquet')}')`
    );
    conn.disconnectSync();
    inst.closeSync();
    expect(Number(r.getRowObjects()[0].cnt)).toBe(2);
  });

  it('returns 0 when no JSON files exist in directory', async () => {
    const emptyDir = join(testBase, 'empty');
    mkdirSync(emptyDir, { recursive: true });
    const logger = createLogger('test-empty');
    const count = await buildTickerParquets(`${emptyDir}/*.json`, join(testBase, 'prices-empty'), logger);
    expect(count).toBe(0);
  });
});
