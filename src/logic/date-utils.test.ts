import { describe, it, expect } from 'vitest';
import {
  getMonthKey,
  monthParquetPath,
  addDay,
  isWeekend,
} from './date-utils.js';

describe('getMonthKey', () => {
  it('extracts YYYY-MM from ISO date string', () => {
    expect(getMonthKey('2024-01-04')).toBe('2024-01');
    expect(getMonthKey('2024-12-31')).toBe('2024-12');
  });
});

describe('monthParquetPath', () => {
  it('returns correctly formatted path with zero-padded month', () => {
    expect(monthParquetPath(2024, 6)).toBe('data/prices/2024/06.parquet');
    expect(monthParquetPath(2024, 12)).toBe('data/prices/2024/12.parquet');
  });
});

describe('addDay', () => {
  it('adds one day', () => {
    expect(addDay('2024-01-04')).toBe('2024-01-05');
  });
  it('crosses month boundary', () => {
    expect(addDay('2024-01-31')).toBe('2024-02-01');
  });
  it('crosses year boundary', () => {
    expect(addDay('2024-12-31')).toBe('2025-01-01');
  });
});

describe('isWeekend', () => {
  it('returns true for Saturday (2024-01-06)', () => {
    expect(isWeekend('2024-01-06')).toBe(true);
  });
  it('returns true for Sunday (2024-01-07)', () => {
    expect(isWeekend('2024-01-07')).toBe(true);
  });
  it('returns false for Monday (2024-01-08)', () => {
    expect(isWeekend('2024-01-08')).toBe(false);
  });
});
