// src/repository/yahoo.ts
import YahooFinance from 'yahoo-finance2';
import { mapRow } from '../logic/price-mapper.js';
import type { PriceRecord } from '../domain/types.js';

const yahooFinance = new YahooFinance({ suppressNotices: ['ripHistorical'] });

export async function fetchTickerYear(ticker: string, year: number): Promise<PriceRecord[]> {
  try {
    const rows = await yahooFinance.historical(ticker, {
      period1: `${year}-01-01`,
      period2: `${year}-12-31`,
      interval: '1d',
    });
    return rows.map(row => mapRow(row, ticker));
  } catch (err) {
    throw new Error(`Failed to fetch ${ticker} for ${year}: ${err}`);
  }
}

export async function fetchTickerRange(
  ticker: string,
  period1: string,
  period2: string
): Promise<PriceRecord[]> {
  try {
    const rows = await yahooFinance.historical(ticker, { period1, period2, interval: '1d' });
    return rows.map(row => mapRow(row, ticker));
  } catch (err) {
    throw new Error(`Failed to fetch ${ticker} [${period1}~${period2}]: ${err}`);
  }
}
