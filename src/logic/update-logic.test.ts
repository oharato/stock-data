import { describe, it, expect } from 'vitest';
import { calcFetchRange, mergeRecords } from './update-logic.js';
import type { PriceRecord } from '../domain/types.js';

describe('calcFetchRange', () => {
  it('returns period1 = day after lastDate', () => {
    expect(calcFetchRange('2024-06-10', '2024-06-12', '2024-06-01'))
      .toEqual({ period1: '2024-06-11', period2: '2024-06-12' });
  });

  it('returns month start as period1 when no existing data (lastDate = null)', () => {
    expect(calcFetchRange(null, '2024-06-12', '2024-06-01'))
      .toEqual({ period1: '2024-06-01', period2: '2024-06-12' });
  });

  it('returns null when already up to date', () => {
    expect(calcFetchRange('2024-06-12', '2024-06-12', '2024-06-01')).toBeNull();
  });

  it('returns null when period1 would be after today', () => {
    expect(calcFetchRange('2099-01-01', '2024-06-12', '2024-06-01')).toBeNull();
  });
});

describe('mergeRecords', () => {
  const existing: PriceRecord[] = [
    { date: '2024-06-10', ticker: '7203.T', open: 2500, high: 2550, low: 2490, close: 2530, adj_close: 2530, volume: 1000000 },
  ];
  const incoming: PriceRecord[] = [
    { date: '2024-06-11', ticker: '7203.T', open: 2530, high: 2560, low: 2510, close: 2540, adj_close: 2540, volume: 900000 },
    // duplicate — should be dropped
    { date: '2024-06-10', ticker: '7203.T', open: 2500, high: 2550, low: 2490, close: 2530, adj_close: 2530, volume: 1000000 },
  ];

  it('deduplicates by date+ticker and sorts by date then ticker', () => {
    const result = mergeRecords(existing, incoming);
    expect(result).toHaveLength(2);
    expect(result[0].date).toBe('2024-06-10');
    expect(result[1].date).toBe('2024-06-11');
  });
});
