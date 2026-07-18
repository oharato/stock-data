import { writeFileSync } from 'fs';
import * as XLSX from 'xlsx';
import { parseJpxRows } from '../../data-fetcher/logic/ticker-parser.js';
import type { Ticker } from '../domain/types.js';

const JPX_URL =
  'https://www.jpx.co.jp/markets/statistics-equities/misc/tvdivq0000001vg2-att/data_j.xls';

export async function fetchAndSaveTickers(outputPath = 'tickers.json'): Promise<Ticker[]> {
  console.log('Downloading JPX ticker list...');
  const res = await fetch(JPX_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${JPX_URL}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];

  const tickers = parseJpxRows(rows);
  writeFileSync(outputPath, JSON.stringify(tickers, null, 2));
  console.log(`Saved ${tickers.length} tickers to ${outputPath}`);
  return tickers;
}
