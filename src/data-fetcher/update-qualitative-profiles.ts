import { promises as fs, existsSync } from 'fs';
import { resolve } from 'path';
import { 
  EdinetXbrlDownloader, 
  EdinetXbrlParser, 
  EdinetInfoSeeder, 
  EdinetRepository, 
  EdinetDocumentType 
} from 'edinet-ts';
import { DuckDBInstance } from '@duckdb/node-api';
import { createLogger } from '../shared/logic/logger.js';
import dayjs from 'dayjs';

const LIMIT = process.env.FETCH_LIMIT ? parseInt(process.env.FETCH_LIMIT, 10) : 50;
const DELAY_MS = 2000; // API restrictions friendly (2 seconds delay)
const LOOKBACK_DAYS = process.env.LOOKBACK_DAYS ? parseInt(process.env.LOOKBACK_DAYS, 10) : 500;

async function main() {
  // Load .env file using Node's native API if available
  if (typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile();
    } catch {}
  }

  const logger = createLogger('update-qualitative-profiles');
  logger.log(`Starting update-qualitative-profiles (Limit: ${LIMIT}, log: ${logger.logFile})`);

  const dbPath = resolve('stock.duckdb');
  if (!existsSync(dbPath)) {
    logger.error(`Database not found at ${dbPath}`);
    process.exit(1);
  }

  const edinetDbPath = resolve('data/edinet/edinet.db');
  
  // 1. Sync EDINET Metadata (Seeding)
  logger.log('Syncing EDINET documents metadata...');
  const end = dayjs();
  const start = end.subtract(LOOKBACK_DAYS, 'day');
  
  try {
    const seeder = new EdinetInfoSeeder({
      apiKey: process.env.EDINET_API_KEY || '',
      dbPath: edinetDbPath,
      start: start.format('YYYY-MM-DD'),
      end: end.format('YYYY-MM-DD'),
      skipExisting: true,
      onProgress: (current, total, date, status) => {
        if (status === 'processed') {
          logger.log(`Seeder: [${current}/${total}] ${date} synchronized.`);
        }
      }
    });
    await seeder.run();
    logger.log('EDINET metadata sync completed.');
  } catch (err) {
    logger.error(`Failed during EDINET metadata seeding: ${err}`);
  }

  // 2. Fetch pending tickers from DuckDB
  const inst = await DuckDBInstance.create(dbPath);
  const conn = await inst.connect();
  
  let targetTickers: string[] = [];
  try {
    const res = await conn.runAndReadAll(`
      SELECT code::VARCHAR AS code 
      FROM tickers 
      WHERE business_description IS NULL
      ORDER BY code ASC
      LIMIT ${LIMIT}
    `);
    targetTickers = res.getRowObjects().map((r: any) => r.code);
  } catch (err) {
    logger.error(`Failed to read pending tickers: ${err}`);
    conn.disconnectSync();
    inst.closeSync();
    process.exit(1);
  }

  if (targetTickers.length === 0) {
    logger.log('All tickers already have profiles. Nothing to fetch.');
    conn.disconnectSync();
    inst.closeSync();
    return;
  }

  logger.log(`Found ${targetTickers.length} tickers to fetch details for.`);

  // 3. Initialize repositories and parser
  const repo = new EdinetRepository(edinetDbPath);
  const cacheDir = resolve('data/edinet_cache');
  const downloader = new EdinetXbrlDownloader({
    apiKey: process.env.EDINET_API_KEY || '',
    enableRateLimit: true,
    rootDir: cacheDir
  });
  const parser = new EdinetXbrlParser();

  let processed = 0;

  for (let i = 0; i < targetTickers.length; i++) {
    const ticker = targetTickers[i];
    const code = ticker.replace('.T', '');
    const secCode = `${code}0`; // EDINET uses 5 digit code (ticker + '0')
    
    logger.log(`[${i + 1}/${targetTickers.length}] Searching document for ${ticker}...`);

    try {
      // Find the latest Annual Report (120) in local metadata DB
      const docs = repo.findDocuments({
        secCode: secCode,
        docTypeCode: EdinetDocumentType.AnnualCards,
        limit: 1
      });

      if (docs.length === 0) {
        logger.log(`No annual report metadata found for ${ticker} in edinet.db.`);
        // Set an empty string to avoid repeatedly trying to fetch missing ones
        await conn.run(`
          UPDATE tickers
          SET 
            business_description = '',
            business_risks = '',
            business_policy = ''
          WHERE code = '${ticker}'
        `);
        continue;
      }

      const doc = docs[0];
      logger.log(`Downloading report ${doc.docID} (filed ${doc.submitDate}) for ${ticker}...`);
      
      const xbrlPath = await downloader.download(doc.docID, cacheDir);
      if (!xbrlPath || !existsSync(xbrlPath)) {
        logger.error(`Failed to download XBRL for ${ticker} (docID: ${doc.docID})`);
        await new Promise(res => setTimeout(res, DELAY_MS));
        continue;
      }

      // Parse XBRL
      const xml = await fs.readFile(xbrlPath, 'utf-8');
      const data = parser.parse(xml);
      const qualInfo = data.getQualitativeInfo();

      const desc = qualInfo.businessDescription || '';
      const risks = qualInfo.businessRisks || '';
      const policy = qualInfo.businessPolicy || '';

      // Escape values for SQL insert
      const escDesc = desc.replace(/'/g, "''");
      const escRisks = risks.replace(/'/g, "''");
      const escPolicy = policy.replace(/'/g, "''");
      const escTicker = ticker.replace(/'/g, "''");

      await conn.run(`
        UPDATE tickers
        SET 
          business_description = '${escDesc}',
          business_risks = '${escRisks}',
          business_policy = '${escPolicy}'
        WHERE code = '${escTicker}'
      `);

      processed++;
      logger.log(`Successfully updated database for ${ticker}.`);
    } catch (err) {
      logger.error(`Error processing ticker ${ticker}: ${err}`);
    }

    // Wait to respect API limits
    if (i < targetTickers.length - 1) {
      await new Promise(res => setTimeout(res, DELAY_MS));
    }
  }

  repo.close();
  conn.disconnectSync();
  inst.closeSync();
  logger.log(`Batch finished. Successfully processed ${processed} of ${targetTickers.length} tickers.`);
  logger.done();
}

main().catch(console.error);
