import { join } from 'path';

export function getMonthKey(dateStr: string): string {
  return dateStr.substring(0, 7); // "2024-01-04" → "2024-01"
}

export function monthParquetPath(year: number, month: number): string {
  return join('data', 'prices', String(year), `${String(month).padStart(2, '0')}.parquet`);
}

export function addDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().split('T')[0];
}

export function today(): string {
  return new Date().toISOString().split('T')[0];
}

export function isWeekend(dateStr: string): boolean {
  const day = new Date(dateStr + 'T00:00:00Z').getUTCDay();
  return day === 0 || day === 6;
}

export function getCurrentYearMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}
