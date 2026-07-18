import { describe, it, expect } from 'vitest';
import { mapRow } from './price-mapper.js';

describe('mapRow', () => {
  it('maps yahoo-finance2 row to PriceRecord', () => {
    const row = {
      date: new Date('2024-01-04T00:00:00Z'),
      open: 2500, high: 2550, low: 2490, close: 2530,
      adjClose: 2530, volume: 1000000,
    };
    expect(mapRow(row, '7203.T')).toEqual({
      date: '2024-01-04',
      ticker: '7203.T',
      open: 2500, high: 2550, low: 2490, close: 2530,
      adj_close: 2530, volume: 1000000,
    });
  });

  it('falls back to close when adjClose is null', () => {
    const row = { date: new Date('2024-01-04T00:00:00Z'), open: 100, high: 110, low: 95, close: 105, adjClose: null, volume: 500 };
    expect(mapRow(row, '1234.T').adj_close).toBe(105);
  });

  it('defaults numeric fields to 0 when undefined', () => {
    const row = { date: new Date('2024-01-04T00:00:00Z'), open: undefined, high: undefined, low: undefined, close: undefined, adjClose: undefined, volume: undefined };
    const result = mapRow(row, '1234.T');
    expect(result.open).toBe(0);
    expect(result.adj_close).toBe(0);
    expect(result.volume).toBe(0);
  });
});
