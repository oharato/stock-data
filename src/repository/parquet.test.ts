// src/repository/parquet.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { writeParquet, readParquetMaxDate, readParquet } from './parquet.js';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const testPath = join(tmpdir(), `test-parquet-${process.pid}-${Date.now()}.parquet`);

afterEach(() => {
  if (existsSync(testPath)) rmSync(testPath);
});

const records = [
  { date: '2024-01-04', ticker: '7203.T', open: 2500, high: 2550, low: 2490, close: 2530, adj_close: 2530, volume: 1000000 },
  { date: '2024-01-05', ticker: '7203.T', open: 2530, high: 2560, low: 2510, close: 2540, adj_close: 2540, volume: 900000 },
];

describe('writeParquet + readParquetMaxDate', () => {
  it('writes parquet and reads correct max date', async () => {
    await writeParquet(testPath, records);
    expect(existsSync(testPath)).toBe(true);
    expect(await readParquetMaxDate(testPath)).toBe('2024-01-05');
  });

  it('does nothing when records array is empty', async () => {
    await writeParquet(testPath, []);
    expect(existsSync(testPath)).toBe(false);
  });
});

describe('readParquet', () => {
  it('reads all rows back from a written file', async () => {
    await writeParquet(testPath, records);
    const result = await readParquet(testPath);
    expect(result).toHaveLength(2);
    expect(result[0].ticker).toBe('7203.T');
    expect(Number(result[1].volume)).toBe(900000);
  });

  it('returns empty array for a non-existent file', async () => {
    expect(await readParquet('/nonexistent/path.parquet')).toEqual([]);
  });
});

describe('readParquetMaxDate', () => {
  it('returns null for a non-existent file', async () => {
    expect(await readParquetMaxDate('/nonexistent/path.parquet')).toBeNull();
  });
});
