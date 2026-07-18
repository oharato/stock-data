import type { PriceRecord } from '../../shared/domain/types.js';

export function mapRow(row: any, ticker: string): PriceRecord {
  return {
    date: (row.date as Date).toISOString().split('T')[0],
    ticker,
    open: row.open ?? 0,
    high: row.high ?? 0,
    low: row.low ?? 0,
    close: row.close ?? 0,
    adj_close: row.adjclose ?? row.adjClose ?? row.close ?? 0,
    volume: row.volume ?? 0,
  };
}
