// src/repository/parquet.ts
import { DuckDBInstance } from '@duckdb/node-api';
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { tmpdir } from 'os';
import type { PriceRecord } from '../domain/types.js';

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function writeParquet(outputPath: string, records: PriceRecord[]): Promise<void> {
  if (records.length === 0) return;

  const absOutput = resolve(outputPath);
  mkdirSync(dirname(absOutput), { recursive: true });

  const tempCsv = join(tmpdir(), `stock-${process.pid}-${Date.now()}.csv`);
  const header = 'date,ticker,open,high,low,close,adj_close,volume';
  const lines = records.map(
    r => `${r.date},${csvEscape(r.ticker)},${r.open},${r.high},${r.low},${r.close},${r.adj_close},${r.volume}`
  );
  writeFileSync(tempCsv, `${header}\n${lines.join('\n')}`);

  const inst = await DuckDBInstance.create(':memory:');
  const conn = await inst.connect();
  try {
    await conn.run(`
      COPY (
        SELECT * FROM read_csv('${tempCsv}', header=true, columns={
          'date': 'DATE', 'ticker': 'VARCHAR',
          'open': 'DOUBLE', 'high': 'DOUBLE', 'low': 'DOUBLE',
          'close': 'DOUBLE', 'adj_close': 'DOUBLE', 'volume': 'BIGINT'
        })
      ) TO '${absOutput}' (FORMAT PARQUET, COMPRESSION ZSTD)
    `);
  } finally {
    conn.disconnectSync();
    inst.closeSync();
    unlinkSync(tempCsv);
  }
}

export async function readParquetMaxDate(parquetPath: string): Promise<string | null> {
  const absPath = resolve(parquetPath);
  if (!existsSync(absPath)) return null;
  const inst = await DuckDBInstance.create(':memory:');
  const conn = await inst.connect();
  try {
    const result = await conn.runAndReadAll(
      `SELECT max(date)::VARCHAR AS max_date FROM read_parquet('${absPath}')`
    );
    const rows = result.getRowObjects();
    return (rows[0] as any)?.max_date ?? null;
  } finally {
    conn.disconnectSync();
    inst.closeSync();
  }
}

export async function readParquet(parquetPath: string): Promise<PriceRecord[]> {
  const absPath = resolve(parquetPath);
  if (!existsSync(absPath)) return [];
  const inst = await DuckDBInstance.create(':memory:');
  const conn = await inst.connect();
  try {
    const result = await conn.runAndReadAll(`SELECT * FROM read_parquet('${absPath}')`);
    return result.getRowObjects() as unknown as PriceRecord[];
  } finally {
    conn.disconnectSync();
    inst.closeSync();
  }
}
