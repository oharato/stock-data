// src/repository/yahoo.ts
import YahooFinance from 'yahoo-finance2';
import { mapRow } from '../../data-fetcher/logic/price-mapper.js';
import type { PriceRecord, Ticker } from '../domain/types.js';

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

export async function fetchJpTickersFromYahoo(): Promise<Ticker[]> {
  // Initialize cookies and crumb via a dummy request.
  await yahooFinance.quote('AAPL');

  const jar = (yahooFinance as any)._opts.cookieJar;
  const cookies = await jar.getCookies('http://config.yf2/');
  const crumb = cookies.find((c: any) => c.key === 'crumb')?.value;
  if (!crumb) {
    throw new Error('Failed to retrieve Yahoo Finance crumb');
  }

  const urlBase = 'https://query1.finance.yahoo.com/v1/finance/screener';
  const pageSize = 250;
  const allQuotes: any[] = [];

  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const body = {
      offset,
      size: pageSize,
      sortField: 'ticker',
      sortType: 'asc',
      quoteType: 'EQUITY',
      query: {
        operator: 'AND',
        operands: [
          { operator: 'EQ', operands: ['region', 'jp'] },
        ],
      },
    };

    const cookieStr = await jar.getCookieString(urlBase);
    const res = await fetch(`${urlBase}?crumb=${encodeURIComponent(crumb)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: cookieStr,
        origin: 'https://finance.yahoo.com',
        referer: 'https://finance.yahoo.com/',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from Yahoo Finance screener`);
    }

    const json = await res.json();
    const result = json.finance?.result?.[0];
    if (!result) {
      throw new Error('Unexpected response from Yahoo Finance screener');
    }

    total = result.total;
    allQuotes.push(...result.quotes);

    offset += pageSize;
    if (offset < total) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  return allQuotes.map((q: any): Ticker => ({
    code: q.symbol,
    name: q.longName || q.shortName || q.symbol,
    market: '',
    sector33: '',
  }));
}
