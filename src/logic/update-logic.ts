import type { PriceRecord } from '../domain/types.js';
import { addDay } from './date-utils.js';

export function calcFetchRange(
  lastDate: string | null,
  todayStr: string,
  monthStart: string
): { period1: string; period2: string } | null {
  const period1 = lastDate ? addDay(lastDate) : monthStart;
  if (period1 > todayStr) return null;
  return { period1, period2: todayStr };
}

export function mergeRecords(existing: PriceRecord[], incoming: PriceRecord[]): PriceRecord[] {
  const seen = new Set(existing.map(r => `${r.date}:${r.ticker}`));
  const merged = [
    ...existing,
    ...incoming.filter(r => !seen.has(`${r.date}:${r.ticker}`)),
  ];
  return merged.sort(
    (a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker)
  );
}
