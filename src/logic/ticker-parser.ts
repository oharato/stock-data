import type { Ticker } from '../domain/types.js';

export function parseJpxRows(rows: any[][]): Ticker[] {
  return rows
    .slice(1) // skip header row
    .filter(row => {
      const code = row[1];
      const market = String(row[3] ?? '');
      return (
        typeof code === 'number' &&
        code >= 1000 &&
        code <= 9999 &&
        market.includes('内国株式')
      );
    })
    .map(row => ({
      code: `${String(Math.floor(row[1])).padStart(4, '0')}.T`,
      name: String(row[2] ?? ''),
      market: String(row[3] ?? ''),
    }));
}
