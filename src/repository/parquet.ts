// src/repository/parquet.ts
import { DuckDBInstance } from '@duckdb/node-api';
import { mkdirSync, existsSync, renameSync, readdirSync } from 'fs';
import { join, resolve, dirname, basename } from 'path';
import type { Logger } from '../logic/logger.js';

/** glob パターン（例: 'data/raw/*.json'）からファイル一覧を取得する */
function listFilesFromGlob(globPattern: string): string[] {
  const dir = dirname(globPattern);
  const ext = basename(globPattern).replace('*', '');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith(ext))
    .map(f => join(dir, f));
}

/**
 * data/raw/*.json（銘柄ごとの全期間JSON）を読み込み、
 * data/prices/{ticker}.parquet として銘柄ごとに書き出す（初回取得用）。
 * 単一DuckDBセッションで全銘柄を処理する。
 */
export async function buildTickerParquets(
  rawGlob: string,
  pricesDir: string,
  logger: Logger
): Promise<number> {
  const files = listFilesFromGlob(rawGlob);
  if (files.length === 0) return 0;

  const inst = await DuckDBInstance.create(':memory:');
  const conn = await inst.connect();
  try {
    logger.log('Phase 2: Loading raw JSON data into DuckDB...');
    const t0 = Date.now();
    await conn.run(`
      CREATE TABLE all_prices AS
      SELECT
        date::VARCHAR AS date,
        ticker::VARCHAR AS ticker,
        open::DOUBLE AS open,
        high::DOUBLE AS high,
        low::DOUBLE AS low,
        close::DOUBLE AS close,
        adj_close::DOUBLE AS adj_close,
        volume::BIGINT AS volume
      FROM read_json_auto('${rawGlob}')
      WHERE date IS NOT NULL AND ticker IS NOT NULL
    `);
    logger.log(`  Loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    const tickersResult = await conn.runAndReadAll(
      `SELECT DISTINCT ticker FROM all_prices ORDER BY ticker`
    );
    const tickers = tickersResult.getRowObjects().map(r => String(r.ticker));
    logger.log(`  ${tickers.length} tickers to write`);

    mkdirSync(pricesDir, { recursive: true });
    let written = 0;
    for (const ticker of tickers) {
      const outputPath = resolve(join(pricesDir, `${ticker}.parquet`));
      await conn.run(`
        COPY (
          SELECT date, ticker, open, high, low, close, adj_close, volume
          FROM all_prices
          WHERE ticker = '${ticker}'
          ORDER BY date
        ) TO '${outputPath}' (FORMAT PARQUET, COMPRESSION ZSTD)
      `);
      written++;
      if (written % 500 === 0 || written === tickers.length) {
        logger.log(`  Phase 2 progress: ${written}/${tickers.length} parquets written`);
      }
    }
    return written;
  } finally {
    conn.disconnectSync();
    inst.closeSync();
  }
}

/**
 * update-cache/{date}/*.json を読み込み、
 * 新データのある銘柄の data/prices/{ticker}.parquet を更新する（差分更新用）。
 * 単一DuckDBセッションで全銘柄を処理する。
 */
export async function mergeUpdateIntoTickerParquets(
  cacheGlob: string,
  pricesDir: string,
  logger: Logger
): Promise<number> {
  const files = listFilesFromGlob(cacheGlob);
  if (files.length === 0) {
    logger.log('  No cache files to merge');
    return 0;
  }

  const inst = await DuckDBInstance.create(':memory:');
  const conn = await inst.connect();
  try {
    await conn.run(`
      CREATE TABLE delta AS
      SELECT
        date::VARCHAR AS date,
        ticker::VARCHAR AS ticker,
        open::DOUBLE AS open,
        high::DOUBLE AS high,
        low::DOUBLE AS low,
        close::DOUBLE AS close,
        adj_close::DOUBLE AS adj_close,
        volume::BIGINT AS volume
      FROM read_json_auto('${cacheGlob}')
      WHERE date IS NOT NULL AND ticker IS NOT NULL
    `);

    const tickersResult = await conn.runAndReadAll(
      `SELECT DISTINCT ticker FROM delta ORDER BY ticker`
    );
    const tickers = tickersResult.getRowObjects().map(r => String(r.ticker));
    logger.log(`  ${tickers.length} tickers with new data`);

    mkdirSync(pricesDir, { recursive: true });
    let updated = 0;
    for (const ticker of tickers) {
      const parquetPath = resolve(join(pricesDir, `${ticker}.parquet`));
      const tmpPath = `${parquetPath}.tmp`;

      if (existsSync(parquetPath)) {
        // 既存parquetとdeltaをマージ（重複は date で排除）
        await conn.run(`
          COPY (
            SELECT * FROM (
              SELECT * FROM read_parquet('${parquetPath}')
              UNION ALL
              SELECT * FROM delta WHERE ticker = '${ticker}'
            )
            QUALIFY ROW_NUMBER() OVER (PARTITION BY date ORDER BY date) = 1
            ORDER BY date
          ) TO '${tmpPath}' (FORMAT PARQUET, COMPRESSION ZSTD)
        `);
        renameSync(tmpPath, parquetPath);
      } else {
        await conn.run(`
          COPY (
            SELECT * FROM delta WHERE ticker = '${ticker}' ORDER BY date
          ) TO '${parquetPath}' (FORMAT PARQUET, COMPRESSION ZSTD)
        `);
      }
      updated++;
    }
    return updated;
  } finally {
    conn.disconnectSync();
    inst.closeSync();
  }
}
