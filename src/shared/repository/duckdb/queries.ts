import { DuckDBInstance } from '@duckdb/node-api';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { getCachedInstance } from './connection.js';

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

export async function readDbMaxDate(dbPath: string = 'stock.duckdb'): Promise<string | null> {
  const absDb = resolve(dbPath);
  if (!existsSync(absDb)) return null;
  const inst = await DuckDBInstance.create(absDb, { access_mode: 'READ_ONLY' });
  const conn = await inst.connect();
  try {
    const result = await conn.runAndReadAll('SELECT max(date)::VARCHAR AS max_date FROM prices');
    const rows = result.getRowObjects();
    return (rows[0] as any)?.max_date ?? null;
  } catch {
    return null;
  } finally {
    conn.disconnectSync();
    inst.closeSync();
  }
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
