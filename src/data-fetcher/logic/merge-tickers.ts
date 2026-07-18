import { writeFileSync } from 'fs';
import { fetchJpTickersFromYahoo } from '../../shared/repository/yahoo.js';
import { fetchJpxTickers } from '../../shared/repository/jpx.js';
import type { Ticker } from '../../shared/domain/types.js';

export async function fetchAndSaveTickers(outputPath = 'tickers.json'): Promise<Ticker[]> {
  console.log('Fetching ticker list from Yahoo Finance + JPX...');
  const [yahooTickers, jpxTickers] = await Promise.all([
    fetchJpTickersFromYahoo(),
    fetchJpxTickers(),
  ]);

  const jpxMap = new Map(jpxTickers.map(t => [t.code, t]));

  const merged = yahooTickers.map(yt => {
    const jt = jpxMap.get(yt.code);
    if (jt) {
      return { ...yt, name: jt.name, market: jt.market, sector33: jt.sector33 };
    }
    return yt;
  });

  writeFileSync(outputPath, JSON.stringify(merged, null, 2));
  console.log(`Saved ${merged.length} tickers to ${outputPath}`);
  return merged;
}
