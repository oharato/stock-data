// src/repository/yahoo.ts
import YahooFinance from 'yahoo-finance2';
import { mapRow } from '../logic/price-mapper.js';
import type { PriceRecord } from '../domain/types.js';

const yahooFinance = new YahooFinance({ suppressNotices: ['ripHistorical'] });

const RETRY_DELAYS_MS = [1000, 2000, 4000]; // exponential backoff

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < RETRY_DELAYS_MS.length) {
        await new Promise(res => setTimeout(res, RETRY_DELAYS_MS[attempt]));
      }
    }
  }
  throw new Error(`${label}: ${lastErr}`);
}

export async function fetchTickerYear(ticker: string, year: number): Promise<PriceRecord[]> {
  const result = await withRetry(
    () => yahooFinance.chart(ticker, {
      period1: `${year}-01-01`,
      period2: `${year}-12-31`,
      interval: '1d',
    }),
    `Failed to fetch ${ticker} for ${year}`
  );
  const quotes = result.quotes || [];
  return quotes.map(row => mapRow(row, ticker));
}

export async function fetchTickerRange(
  ticker: string,
  period1: string,
  period2: string
): Promise<PriceRecord[]> {
  const result = await withRetry(
    () => yahooFinance.chart(ticker, { period1, period2, interval: '1d' }),
    `Failed to fetch ${ticker} [${period1}~${period2}]`
  );
  const quotes = result.quotes || [];
  return quotes.map(row => mapRow(row, ticker));
}
