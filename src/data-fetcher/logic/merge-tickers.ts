import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import pLimit from 'p-limit';
import { fetchJpTickersFromYahoo } from '../../shared/repository/yahoo.js';
import type { Ticker } from '../../shared/domain/types.js';

// Map Yahoo Finance markets to JPX format
function mapMarket(label: string): string {
  if (!label) return '';
  if (label.includes('PRM')) return 'プライム（内国株式）';
  if (label.includes('STD')) return 'スタンダード（内国株式）';
  if (label.includes('GRT')) return 'グロース（内国株式）';
  return label;
}

// Map Yahoo Finance sectors to JPX 33 sectors
function mapSector33(sector: string): string {
  if (!sector) return '';
  const mapping: { [key: string]: string } = {
    '水産・農林': '水産・農林業',
    '情報・通信': '情報・通信業',
    '小売': '小売業',
    '建設': '建設業',
    'サービス': 'サービス業',
    '不動産': '不動産業',
    '卸売': '卸売業',
    '陸運': '陸運業',
    '証券・商品先物': '証券、商品先物取引業',
    '証券': '証券、商品先物取引業',
    'その他金融': 'その他金融業',
    '銀行': '銀行業',
    '保険': '保険業',
    '海運': '海運業',
    '倉庫・運輸': '倉庫・運輸関連業',
    '空運': '空運業',
    '電気・ガス': '電気・ガス業',
  };
  return mapping[sector] || sector;
}

// Fetch name, market, and sector from Japanese Yahoo Finance detail page
async function fetchYahooJpTickerDetail(code: string): Promise<{ name: string; market: string; sector33: string }> {
  const url = `https://finance.yahoo.co.jp/quote/${code}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch Yahoo JP page for ${code}: ${res.status}`);
  }
  const html = await res.text();

  let name = '';
  let market = '';
  let sector = '';

  const cleanCode = code.replace('.T', '');

  // Try regex for name (considering escape backslashes in JSON-like strings)
  const nameRegex = new RegExp(`\\\\?"name\\\\?"\\s*:\\s*\\\\?"([^"\\\\]+)\\\\?"\\s*,\\s*\\\\?"code\\\\?"\\s*:\\s*\\\\?"${cleanCode}\\\\?"`);
  const nameMatch = html.match(nameRegex);
  if (nameMatch) {
    name = nameMatch[1];
  } else {
    const titleMatch = html.match(/<title>([^【［\(]+)/);
    if (titleMatch) {
      name = titleMatch[1].trim();
    }
  }

  // Try regex for market
  const marketRegex = /\\?"label\\?"\s*:\s*\\?"([^"\\]+)\\?"/;
  const marketMatch = html.match(marketRegex);
  if (marketMatch) {
    market = mapMarket(marketMatch[1]);
  }

  // Try regex for industry/sector
  const industryRegex = /\\?"industry\\?"\s*:\s*\{\s*\\?"industryName\\?"\s*:\s*\\?"([^"\\]+)\\?"/;
  const industryRegex2 = /\\?"industryName\\?"\s*:\s*\\?"([^"\\]+)\\?"/;
  const industryRegex3 = /\\?"industry\\?"\s*:\s*\{\s*\\?"name\\?"\s*:\s*\\?"([^"\\]+)\\?"/;
  const indMatch = html.match(industryRegex) || html.match(industryRegex2) || html.match(industryRegex3);
  if (indMatch) {
    sector = mapSector33(indMatch[1]);
  }

  return { name: name || code, market, sector33: sector };
}

export async function fetchAndSaveTickers(outputPath = 'data/tickers.json'): Promise<Ticker[]> {
  console.log('Fetching all JP symbols from Yahoo Finance Screener...');
  const yahooTickers = await fetchJpTickersFromYahoo();
  console.log(`Found ${yahooTickers.length} symbols from screener.`);

  // Load existing tickers as cache
  let cacheMap = new Map<string, Ticker>();
  // We check both the new path 'data/tickers.json' and the legacy 'tickers.json' for maximum backwards compatibility
  const legacyPath = 'tickers.json';
  const checkPaths = [outputPath, legacyPath];

  for (const path of checkPaths) {
    if (existsSync(path)) {
      try {
        const cachedList: Ticker[] = JSON.parse(readFileSync(path, 'utf-8'));
        for (const t of cachedList) {
          if (t.code && t.name && t.market && t.sector33) {
            cacheMap.set(t.code, t);
          }
        }
        console.log(`Loaded ${cachedList.length} cached tickers from ${path}`);
        break; // Stop at the first available file
      } catch (err) {
        console.warn(`Failed to parse cache from ${path}: ${err}`);
      }
    }
  }

  const limit = pLimit(3); // Fetch 3 details concurrently
  const merged: Ticker[] = [];
  let fetchedCount = 0;

  const tasks = yahooTickers.map((yt) => {
    return limit(async () => {
      const cached = cacheMap.get(yt.code);
      if (cached) {
        merged.push(cached);
        return;
      }

      // Fetch detail for new ticker
      try {
        console.log(`Fetching details for new ticker: ${yt.code}...`);
        const detail = await fetchYahooJpTickerDetail(yt.code);
        merged.push({
          code: yt.code,
          name: detail.name,
          market: detail.market,
          sector33: detail.sector33,
        });
        fetchedCount++;
        // Slight delay to be polite
        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch (err) {
        console.error(`Failed to fetch detail for ${yt.code}: ${err}`);
        // Push with fallback name
        merged.push(yt);
      }
    });
  });

  await Promise.all(tasks);

  // Ensure output directory exists
  const outDir = dirname(outputPath);
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  // Sort by code to maintain consistent order
  merged.sort((a, b) => a.code.localeCompare(b.code));

  writeFileSync(outputPath, JSON.stringify(merged, null, 2));
  console.log(`Saved ${merged.length} tickers to ${outputPath} (Fetched details for ${fetchedCount} new tickers).`);
  return merged;
}

