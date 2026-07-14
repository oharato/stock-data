import type { Ticker } from '../domain/types.js';

export function parseJpxRows(rows: any[][]): Ticker[] {
  return rows
    .slice(1) // skip header row
    .filter(row => {
      const codeRaw = row[1];
      if (codeRaw === undefined || codeRaw === null) return false;
      const code = String(codeRaw).trim();
      const market = String(row[3] ?? '');
      
      // 4桁の英数字（例: 1301, 285A）にマッチする正規表現
      const isValidCode = /^[0-9]{3}[0-9A-Z]$/.test(code);
      return isValidCode && market.includes('内国株式');
    })
    .map(row => {
      const code = String(row[1]).trim();
      return {
        code: `${code}.T`,
        name: String(row[2] ?? ''),
        market: String(row[3] ?? ''),
      };
    });
}
