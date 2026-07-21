import { writeFileSync, existsSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import YahooFinance from 'yahoo-finance2';
import { DuckDBInstance } from '@duckdb/node-api';
import { createLogger } from '../shared/logic/logger.js';
const yahooFinance = new YahooFinance({ suppressNotices: ['ripHistorical'] });

const CHUNK_SIZE = 50;
const DELAY_MS = 500; // API delay to avoid rate limit

// 株価指標・財務指標の共通型定義
interface TickerFundamentals {
  marketCap: number | null;      // 時価総額
  ipoDate: string | null;        // 上場日
  per: number | null;            // 実績PER
  pbr: number | null;            // PBR
  dividendYield: number | null;  // 配当利回り
  dividendRate: number | null;   // 配当金
  currentPrice: number | null;   // 現在株価
  eps: number | null;            // 実績EPS
  bps: number | null;            // BPS
  changePercent: number | null;  // 前日比騰落率
  prevClose: number | null;      // 前日終値
  openPrice: number | null;      // 始値
  highPrice: number | null;      // 高値
  lowPrice: number | null;       // 安値
  volumeDay: number | null;      // 本日売買高
  ma50Diff: number | null;       // 50日線乖離
  ma200Diff: number | null;      // 200日線乖離
  low52Diff: number | null;      // 52週安値乖離
  high52Diff: number | null;     // 52週高値乖離
}

async function main() {
  const logger = createLogger('update-fundamental-metrics');
  logger.log(`Starting update-fundamental-metrics (log: ${logger.logFile})`);

  const dbPath = resolve('stock.duckdb');
  if (!existsSync(dbPath)) {
    logger.error(`Database not found at ${dbPath}`);
    process.exit(1);
  }

  // 1. Get tickers from DB (both existing tickers and tickers in prices but NOT in tickers table)
  const inst = await DuckDBInstance.create(dbPath);
  const conn = await inst.connect();
  let tickers: string[] = [];
  let missingFromTickers: string[] = [];
  try {
    const res = await conn.runAndReadAll('SELECT code::VARCHAR AS code FROM tickers ORDER BY code ASC');
    tickers = res.getRowObjects().map((r: any) => r.code);

    // Find tickers present in prices but missing from tickers table (e.g. new listings with alphanumeric codes)
    const missingRes = await conn.runAndReadAll(`
      SELECT DISTINCT p.ticker::VARCHAR AS code
      FROM prices p
      LEFT JOIN tickers t ON p.ticker = t.code
      WHERE t.code IS NULL
      ORDER BY p.ticker ASC
    `);
    missingFromTickers = missingRes.getRowObjects().map((r: any) => r.code);
    if (missingFromTickers.length > 0) {
      logger.log(`Found ${missingFromTickers.length} tickers in prices but missing from tickers table. Will fetch and insert.`);
    }
  } catch (err) {
    logger.error(`Failed to read tickers: ${err}`);
    conn.disconnectSync();
    inst.closeSync();
    process.exit(1);
  }

  // Combine both lists - existing tickers + missing ones from prices
  const allTickersToFetch = [...new Set([...tickers, ...missingFromTickers])];
  logger.log(`Found ${tickers.length} tickers in tickers table + ${missingFromTickers.length} missing. Fetching ${allTickersToFetch.length} total...`);

  const results: (TickerFundamentals & { code: string })[] = [];
  let done = 0;

  // Split into chunks of CHUNK_SIZE
  const newTickerQuotes: (TickerFundamentals & { 
    code: string; 
    name: string; 
    market: string; 
    sector33: string; 
  })[] = [];

  for (let i = 0; i < allTickersToFetch.length; i += CHUNK_SIZE) {
    const chunk = allTickersToFetch.slice(i, i + CHUNK_SIZE);
    try {
      // Fetch quote info in bulk
      const quotes = await yahooFinance.quote(chunk);
      for (const quote of quotes) {
        if (quote.symbol) {
          const marketCap = typeof quote.marketCap === 'number' ? quote.marketCap : null;
          
          let ipoDate: string | null = null;
          if (quote.newListingDate) {
            const d = new Date(quote.newListingDate);
            if (!isNaN(d.getTime())) {
              ipoDate = d.toISOString().split('T')[0];
            }
          }

          // 各種投資指標の抽出 (Yahoo Finance API)
          const per = typeof quote.trailingPE === 'number' ? quote.trailingPE : null; // 実績PER (株価収益率)
          const pbr = typeof quote.priceToBook === 'number' ? quote.priceToBook : null; // PBR (株価純資産倍率)
          const dividendYield = typeof quote.trailingAnnualDividendYield === 'number' ? quote.trailingAnnualDividendYield : null; // 実績配当利回り (小数表記、例: 0.035 = 3.5%)
          const dividendRate = typeof quote.trailingAnnualDividendRate === 'number' ? quote.trailingAnnualDividendRate : null; // 年間実績配当金 (円)
          
          // 追加の詳細価格・財務・テクニカル指標 (詳細ポップアップ表示用)
          const currentPrice = typeof quote.regularMarketPrice === 'number' ? quote.regularMarketPrice : null; // 現在株価 (円)
          const eps = typeof quote.epsTrailingTwelveMonths === 'number' ? quote.epsTrailingTwelveMonths : null; // 実績EPS (1株当たり利益)
          const bps = typeof quote.bookValue === 'number' ? quote.bookValue : null; // BPS (1株当たり純資産)
          const changePercent = typeof quote.regularMarketChangePercent === 'number' ? quote.regularMarketChangePercent : null; // 前日比騰落率 (パーセンテージそのもの、例: -0.22 = -0.22%)
          const prevClose = typeof quote.regularMarketPreviousClose === 'number' ? quote.regularMarketPreviousClose : null; // 前日終値 (円)
          const openPrice = typeof quote.regularMarketOpen === 'number' ? quote.regularMarketOpen : null; // 当日始値 (円)
          const highPrice = typeof quote.regularMarketDayHigh === 'number' ? quote.regularMarketDayHigh : null; // 本日高値 (円)
          const lowPrice = typeof quote.regularMarketDayLow === 'number' ? quote.regularMarketDayLow : null; // 本日安値 (円)
          const volumeDay = typeof quote.regularMarketVolume === 'number' ? quote.regularMarketVolume : null; // 本日売買高 (株)
          const ma50Diff = typeof quote.fiftyDayAverageChangePercent === 'number' ? quote.fiftyDayAverageChangePercent : null; // 50日移動平均線乖離率 (小数表記、例: 0.02 = +2%)
          const ma200Diff = typeof quote.twoHundredDayAverageChangePercent === 'number' ? quote.twoHundredDayAverageChangePercent : null; // 200日移動平均線乖離率 (小数表記)
          const low52Diff = typeof quote.fiftyTwoWeekLowChangePercent === 'number' ? quote.fiftyTwoWeekLowChangePercent : null; // 52週安値からの上昇率 (小数表記)
          const high52Diff = typeof quote.fiftyTwoWeekHighChangePercent === 'number' ? quote.fiftyTwoWeekHighChangePercent : null; // 52週高値からの下落率 (小数表記)

          results.push({
            code: quote.symbol,
            marketCap,
            ipoDate,
            per,
            pbr,
            dividendYield,
            dividendRate,
            currentPrice,
            eps,
            bps,
            changePercent,
            prevClose,
            openPrice,
            highPrice,
            lowPrice,
            volumeDay,
            ma50Diff,
            ma200Diff,
            low52Diff,
            high52Diff,
          });

          // Track newly listed tickers that need to be inserted
          if (missingFromTickers.includes(quote.symbol)) {
            newTickerQuotes.push({
              code: quote.symbol,
              name: quote.shortName || quote.longName || quote.symbol,
              market: '',
              sector33: '',
              marketCap,
              ipoDate,
              per,
              pbr,
              dividendYield,
              dividendRate,
              currentPrice,
              eps,
              bps,
              changePercent,
              prevClose,
              openPrice,
              highPrice,
              lowPrice,
              volumeDay,
              ma50Diff,
              ma200Diff,
              low52Diff,
              high52Diff,
            });
          }
        }
      }
    } catch (err) {
      logger.error(`Failed to fetch chunk starting at index ${i}: ${err}`);
    }

    done += chunk.length;
    logger.progress(`${done}/${allTickersToFetch.length} tickers processed (${results.length} quotes fetched)`);

    if (i + CHUNK_SIZE < allTickersToFetch.length) {
      await new Promise(res => setTimeout(res, DELAY_MS));
    }
  }
  logger.done();

  logger.log(`Fetched ${results.length} quotes. Updating database...`);

  // Write to temporary CSV for bulk update
  const tempCsv = join(tmpdir(), `market-caps-${process.pid}-${Date.now()}.csv`);
  const header = 'code,market_cap,ipo_date,per,pbr,dividend_yield,dividend_rate,current_price,eps,bps,change_percent,prev_close,open_price,high_price,low_price,volume_day,ma50_diff,ma200_diff,low52_diff,high52_diff';
  const lines = results.map(r => 
    `${r.code},${r.marketCap !== null ? r.marketCap : ''},${r.ipoDate !== null ? r.ipoDate : ''},` +
    `${r.per !== null ? r.per : ''},${r.pbr !== null ? r.pbr : ''},` +
    `${r.dividendYield !== null ? r.dividendYield : ''},${r.dividendRate !== null ? r.dividendRate : ''},` +
    `${r.currentPrice !== null ? r.currentPrice : ''},${r.eps !== null ? r.eps : ''},` +
    `${r.bps !== null ? r.bps : ''},${r.changePercent !== null ? r.changePercent : ''},` +
    `${r.prevClose !== null ? r.prevClose : ''},${r.openPrice !== null ? r.openPrice : ''},` +
    `${r.highPrice !== null ? r.highPrice : ''},${r.lowPrice !== null ? r.lowPrice : ''},` +
    `${r.volumeDay !== null ? r.volumeDay : ''},${r.ma50Diff !== null ? r.ma50Diff : ''},` +
    `${r.ma200Diff !== null ? r.ma200Diff : ''},${r.low52Diff !== null ? r.low52Diff : ''},` +
    `${r.high52Diff !== null ? r.high52Diff : ''}`
  );
  writeFileSync(tempCsv, `${header}\n${lines.join('\n')}`);

  try {
    // 1. Create temporary table
    await conn.run(`
      CREATE OR REPLACE TEMPORARY TABLE temp_caps AS
      SELECT 
        code::VARCHAR AS code, 
        market_cap::BIGINT AS market_cap,
        ipo_date::VARCHAR AS ipo_date,
        per::DOUBLE AS per,
        pbr::DOUBLE AS pbr,
        dividend_yield::DOUBLE AS dividend_yield,
        dividend_rate::DOUBLE AS dividend_rate,
        current_price::DOUBLE AS current_price,
        eps::DOUBLE AS eps,
        bps::DOUBLE AS bps,
        change_percent::DOUBLE AS change_percent,
        prev_close::DOUBLE AS prev_close,
        open_price::DOUBLE AS open_price,
        high_price::DOUBLE AS high_price,
        low_price::DOUBLE AS low_price,
        volume_day::BIGINT AS volume_day,
        ma50_diff::DOUBLE AS ma50_diff,
        ma200_diff::DOUBLE AS ma200_diff,
        low52_diff::DOUBLE AS low52_diff,
        high52_diff::DOUBLE AS high52_diff
      FROM read_csv('${tempCsv.replace(/\\/g, '/')}', header=true, columns={
        'code': 'VARCHAR', 
        'market_cap': 'BIGINT', 
        'ipo_date': 'VARCHAR',
        'per': 'DOUBLE',
        'pbr': 'DOUBLE',
        'dividend_yield': 'DOUBLE',
        'dividend_rate': 'DOUBLE',
        'current_price': 'DOUBLE',
        'eps': 'DOUBLE',
        'bps': 'DOUBLE',
        'change_percent': 'DOUBLE',
        'prev_close': 'DOUBLE',
        'open_price': 'DOUBLE',
        'high_price': 'DOUBLE',
        'low_price': 'DOUBLE',
        'volume_day': 'BIGINT',
        'ma50_diff': 'DOUBLE',
        'ma200_diff': 'DOUBLE',
        'low52_diff': 'DOUBLE',
        'high52_diff': 'DOUBLE'
      })
    `);

    // 2. Perform bulk update for existing tickers
    await conn.run(`
      UPDATE tickers
      SET 
        market_cap = temp_caps.market_cap,
        ipo_date = COALESCE(temp_caps.ipo_date, tickers.ipo_date),
        per = temp_caps.per,
        pbr = temp_caps.pbr,
        dividend_yield = temp_caps.dividend_yield,
        dividend_rate = temp_caps.dividend_rate,
        current_price = temp_caps.current_price,
        eps = temp_caps.eps,
        bps = temp_caps.bps,
        change_percent = temp_caps.change_percent,
        prev_close = temp_caps.prev_close,
        open_price = temp_caps.open_price,
        high_price = temp_caps.high_price,
        low_price = temp_caps.low_price,
        volume_day = temp_caps.volume_day,
        ma50_diff = temp_caps.ma50_diff,
        ma200_diff = temp_caps.ma200_diff,
        low52_diff = temp_caps.low52_diff,
        high52_diff = temp_caps.high52_diff
      FROM temp_caps
      WHERE tickers.code = temp_caps.code
    `);

    // 3. Insert newly listed tickers that were missing from tickers table
    if (newTickerQuotes.length > 0) {
      logger.log(`Inserting ${newTickerQuotes.length} newly listed tickers into tickers table...`);
      for (const t of newTickerQuotes) {
        const escapedCode = t.code.replace(/'/g, "''");
        const escapedName = (t.name || t.code).replace(/'/g, "''");
        const escapedMarket = (t.market || '').replace(/'/g, "''");
        const escapedSector = (t.sector33 || '').replace(/'/g, "''");
        
        const marketCapVal = t.marketCap !== null ? String(t.marketCap) : 'NULL';
        const ipoDateVal = t.ipoDate ? `'${t.ipoDate}'` : `(
          SELECT MIN(date)::VARCHAR FROM prices WHERE ticker = '${escapedCode}'
        )`;
        const perVal = t.per !== null ? String(t.per) : 'NULL';
        const pbrVal = t.pbr !== null ? String(t.pbr) : 'NULL';
        const divYieldVal = t.dividendYield !== null ? String(t.dividendYield) : 'NULL';
        const divRateVal = t.dividendRate !== null ? String(t.dividendRate) : 'NULL';
        
        const currentPriceVal = t.currentPrice !== null ? String(t.currentPrice) : 'NULL';
        const epsVal = t.eps !== null ? String(t.eps) : 'NULL';
        const bpsVal = t.bps !== null ? String(t.bps) : 'NULL';
        const changePercentVal = t.changePercent !== null ? String(t.changePercent) : 'NULL';
        const prevCloseVal = t.prevClose !== null ? String(t.prevClose) : 'NULL';
        const openPriceVal = t.openPrice !== null ? String(t.openPrice) : 'NULL';
        const highPriceVal = t.highPrice !== null ? String(t.highPrice) : 'NULL';
        const lowPriceVal = t.lowPrice !== null ? String(t.lowPrice) : 'NULL';
        const volumeDayVal = t.volumeDay !== null ? String(t.volumeDay) : 'NULL';
        const ma50DiffVal = t.ma50Diff !== null ? String(t.ma50Diff) : 'NULL';
        const ma200DiffVal = t.ma200Diff !== null ? String(t.ma200Diff) : 'NULL';
        const low52DiffVal = t.low52Diff !== null ? String(t.low52Diff) : 'NULL';
        const high52DiffVal = t.high52Diff !== null ? String(t.high52Diff) : 'NULL';

        await conn.run(`
          INSERT INTO tickers (
            code, name, market, sector33, market_cap, ipo_date, per, pbr, dividend_yield, dividend_rate,
            current_price, eps, bps, change_percent, prev_close, open_price, high_price, low_price, volume_day,
            ma50_diff, ma200_diff, low52_diff, high52_diff
          )
          SELECT 
            '${escapedCode}', '${escapedName}', '${escapedMarket}', '${escapedSector}', 
            ${marketCapVal}, ${ipoDateVal}, ${perVal}, ${pbrVal}, ${divYieldVal}, ${divRateVal},
            ${currentPriceVal}, ${epsVal}, ${bpsVal}, ${changePercentVal}, ${prevCloseVal}, ${openPriceVal},
            ${highPriceVal}, ${lowPriceVal}, ${volumeDayVal}, ${ma50DiffVal}, ${ma200DiffVal}, ${low52DiffVal}, ${high52DiffVal}
          WHERE NOT EXISTS (SELECT 1 FROM tickers WHERE code = '${escapedCode}')
        `);
      }
      logger.log(`Done inserting ${newTickerQuotes.length} newly listed tickers.`);
    }

    logger.log('Database market caps and fundamentals updated successfully!');
  } catch (err) {
    logger.error(`Failed to update database: ${err}`);
  } finally {
    if (existsSync(tempCsv)) {
      unlinkSync(tempCsv);
    }
    conn.disconnectSync();
    inst.closeSync();
  }

  logger.log('All done!');
}

main().catch(console.error);
