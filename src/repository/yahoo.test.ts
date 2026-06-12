// src/repository/yahoo.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockHistorical } = vi.hoisted(() => ({
  mockHistorical: vi.fn(),
}));

vi.mock('yahoo-finance2', () => ({
  default: vi.fn().mockImplementation(() => ({
    historical: mockHistorical,
  })),
}));

import { fetchTickerYear, fetchTickerRange } from './yahoo.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('fetchTickerYear', () => {
  it('maps historical rows to PriceRecord format', async () => {
    mockHistorical.mockResolvedValue([
      { date: new Date('2024-01-04T00:00:00Z'), open: 2500, high: 2550, low: 2490, close: 2530, adjClose: 2530, volume: 1000000 },
    ]);

    const result = await fetchTickerYear('7203.T', 2024);
    expect(result).toEqual([{
      date: '2024-01-04', ticker: '7203.T',
      open: 2500, high: 2550, low: 2490, close: 2530, adj_close: 2530, volume: 1000000,
    }]);
  });

  it('returns empty array when no data', async () => {
    mockHistorical.mockResolvedValue([]);
    expect(await fetchTickerYear('9999.T', 1999)).toEqual([]);
  });

  it('throws descriptive error after retries', async () => {
    vi.useFakeTimers();
    mockHistorical.mockRejectedValue(new Error('Not Found'));
    const assertion = expect(fetchTickerYear('7203.T', 2024)).rejects.toThrow('Failed to fetch 7203.T for 2024');
    await vi.runAllTimersAsync();
    await assertion;
  });

  it('succeeds on second attempt after transient failure', async () => {
    vi.useFakeTimers();
    mockHistorical
      .mockRejectedValueOnce(new Error('429'))
      .mockResolvedValue([
        { date: new Date('2024-01-04T00:00:00Z'), open: 100, high: 110, low: 95, close: 105, adjClose: 105, volume: 100 },
      ]);
    const promise = fetchTickerYear('7203.T', 2024);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toHaveLength(1);
    expect(mockHistorical).toHaveBeenCalledTimes(2);
  });
});

describe('fetchTickerRange', () => {
  it('fetches data for a specific date range', async () => {
    mockHistorical.mockResolvedValue([
      { date: new Date('2024-06-10T00:00:00Z'), open: 100, high: 110, low: 95, close: 105, adjClose: 105, volume: 100 },
    ]);

    const result = await fetchTickerRange('7203.T', '2024-06-01', '2024-06-12');
    expect(result[0].date).toBe('2024-06-10');
  });

  it('throws descriptive error after retries', async () => {
    vi.useFakeTimers();
    mockHistorical.mockRejectedValue(new Error('timeout'));
    const assertion = expect(fetchTickerRange('7203.T', '2024-06-01', '2024-06-12')).rejects.toThrow('Failed to fetch 7203.T [2024-06-01~2024-06-12]');
    await vi.runAllTimersAsync();
    await assertion;
  });
});

