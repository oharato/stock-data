# Per-Ticker Parquet Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 月別parquetを廃止し、銘柄別parquetに一本化することでデータパイプラインを簡素化する。

**Architecture:** `data/prices/{ticker}.parquet`（銘柄ごとに全期間の日足データ）を主要ストレージとし、`stock.duckdb`を引き続き分析用DBとして使う。初回取得（`fetch-initial`）では全銘柄のraw JSONを読み込み単一DuckDBセッションで銘柄別parquetを生成。差分更新（`fetch-update`）ではupdate-cacheのJSONを単一DuckDBセッションで銘柄別parquetにマージする。

**Tech Stack:** Node.js v24, TypeScript (NodeNext ESM), @duckdb/node-api, vitest

---

## File Structure

```
Modified:
  src/repository/parquet.ts       — buildTickerParquets, mergeUpdateIntoTickerParquets追加、旧関数削除
  src/repository/duckdb.ts        — デフォルトglob変更 (prices/*/*.parquet → prices/*.parquet)
  src/repository/duckdb.test.ts   — writeParquet使用をやめて直接DuckDB生成に変更
  src/repository/parquet.test.ts  — 旧テスト削除、新関数テスト追加
  src/fetch-initial.ts            — Phase 2をbuildTickerParquets呼び出しに変更
  src/fetch-update.ts             — mergeUpdateIntoTickerParquetsに変更、parquetLastDate削除
  src/logic/date-utils.ts         — monthParquetPath, getMonthKey削除
  src/logic/date-utils.test.ts    — 削除した関数のテスト削除
  src/logic/update-logic.ts       — mergeRecords削除
  src/logic/update-logic.test.ts  — mergeRecordsテスト削除
```

---

## Task 1: `buildTickerParquets()` を parquet.ts に追加

**Files:**
- Modify: `src/repository/parquet.ts`
- Modify: `src/repository/parquet.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/repository/parquet.test.ts`の先頭のimportを以下に更新する（ファイル全体を置き換えるのではなく、import行だけ更新）：

```typescript
// src/repository/parquet.test.ts
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { buildTickerParquets } from './parquet.js';
import { DuckDBInstance } from '@duckdb/node-api';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createLogger } from '../logic/logger.js';

const testBase = join(tmpdir(), `parquet-test-${process.pid}-${Date.now()}`);

afterAll(() => {
  if (existsSync(testBase)) rmSync(testBase, { recursive: true });
});

describe('buildTickerParquets', () => {
  it('creates one parquet per ticker from JSON glob', async () => {
    const rawDir = join(testBase, 'raw');
    const pricesDir = join(testBase, 'prices-build');
    mkdirSync(rawDir, { recursive: true });

    writeFileSync(join(rawDir, '7203.T.json'), JSON.stringify([
      { date: '2024-01-04', ticker: '7203.T', open: 2500, high: 2550, low: 2490, close: 2530, adj_close: 2530, volume: 1000000 },
      { date: '2024-01-05', ticker: '7203.T', open: 2530, high: 2560, low: 2510, close: 2540, adj_close: 2540, volume: 900000 },
    ]));
    writeFileSync(join(rawDir, '1234.T.json'), JSON.stringify([
      { date: '2024-01-04', ticker: '1234.T', open: 1000, high: 1010, low: 990, close: 1005, adj_close: 1005, volume: 50000 },
    ]));

    const logger = createLogger('test-build');
    const count = await buildTickerParquets(`${rawDir}/*.json`, pricesDir, logger);

    expect(count).toBe(2);
    expect(existsSync(join(pricesDir, '7203.T.parquet'))).toBe(true);
    expect(existsSync(join(pricesDir, '1234.T.parquet'))).toBe(true);

    const inst = await DuckDBInstance.create(':memory:');
    const conn = await inst.connect();
    const r = await conn.runAndReadAll(
      `SELECT COUNT(*) AS cnt FROM read_parquet('${join(pricesDir, '7203.T.parquet')}')`
    );
    conn.disconnectSync();
    inst.closeSync();
    expect(Number(r.getRowObjects()[0].cnt)).toBe(2);
  });

  it('returns 0 when glob matches no files', async () => {
    const emptyDir = join(testBase, 'empty');
    mkdirSync(emptyDir, { recursive: true });
    const logger = createLogger('test-empty');
    // globSync がファイルを返さない場合、DuckDBを起動せず0を返す
    const count = await buildTickerParquets(`${emptyDir}/*.json`, join(testBase, 'prices-empty'), logger);
    expect(count).toBe(0);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
cd /home/oharato/workspace/stock-data && npm test -- --reporter=verbose src/repository/parquet.test.ts 2>&1 | tail -20
```
Expected: FAIL — `buildTickerParquets` は未定義

- [ ] **Step 3: `buildTickerParquets` を parquet.ts に実装する**

`src/repository/parquet.ts` を以下のファイル全体で置き換える：

```typescript
// src/repository/parquet.ts
import { DuckDBInstance } from '@duckdb/node-api';
import { mkdirSync, existsSync, renameSync } from 'fs';
import { join, resolve } from 'path';
import type { Logger } from '../logic/logger.js';

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
  // ファイルが存在するか確認
  const { globSync } = await import('glob');
  const files = globSync(rawGlob);
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
  const { globSync } = await import('glob');
  const files = globSync(cacheGlob);
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
```

- [ ] **Step 4: `glob` パッケージが利用可能か確認する**

```bash
cd /home/oharato/workspace/stock-data && node --input-type=module -e "import { globSync } from 'glob'; console.log('glob ok:', typeof globSync)"
```

Expected: `glob ok: function`

もし `glob` がない場合：`npm install glob` を実行する。

> **注意:** `globSync` の代わりに `readdirSync` で実装することもできる。glob パッケージが不要なら以下で代替：
> ```typescript
> import { readdirSync, existsSync } from 'fs';
> const files = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.json')) : [];
> ```
> ただし parquet.ts では rawGlob を文字列で受け取るため、glob が自然。

- [ ] **Step 5: テストを実行して通過を確認する**

```bash
cd /home/oharato/workspace/stock-data && npm test -- src/repository/parquet.test.ts 2>&1 | tail -20
```

Expected: PASS (buildTickerParquets の2テスト)

- [ ] **Step 6: コミット**

```bash
cd /home/oharato/workspace/stock-data && git add src/repository/parquet.ts src/repository/parquet.test.ts && git commit -m "feat: add buildTickerParquets for per-ticker parquet generation

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 2: `mergeUpdateIntoTickerParquets()` テスト追加

**Files:**
- Modify: `src/repository/parquet.test.ts`

Task 1 でファイルを作成済み。テストを追加する。

- [ ] **Step 1: mergeUpdateIntoTickerParquets のテストを parquet.test.ts に追記する**

まず `src/repository/parquet.test.ts` 先頭の import を更新する：

```typescript
import { buildTickerParquets, mergeUpdateIntoTickerParquets } from './parquet.js';
```

次に、ファイル末尾に以下の describe ブロックを追加する：

```typescript
describe('mergeUpdateIntoTickerParquets', () => {
  it('merges new records into existing per-ticker parquet', async () => {
    const pricesDir = join(testBase, 'prices-merge');
    const cacheDir = join(testBase, 'cache-merge');
    mkdirSync(pricesDir, { recursive: true });
    mkdirSync(cacheDir, { recursive: true });

    // 既存parquetをDuckDBで作成
    const inst = await DuckDBInstance.create(':memory:');
    const conn = await inst.connect();
    await conn.run(`
      COPY (SELECT '2024-01-04'::VARCHAR AS date, '7203.T'::VARCHAR AS ticker,
                   2500.0::DOUBLE AS open, 2550.0::DOUBLE AS high,
                   2490.0::DOUBLE AS low, 2530.0::DOUBLE AS close,
                   2530.0::DOUBLE AS adj_close, 1000000::BIGINT AS volume)
      TO '${join(pricesDir, '7203.T.parquet')}' (FORMAT PARQUET, COMPRESSION ZSTD)
    `);
    conn.disconnectSync();
    inst.closeSync();

    // deltaキャッシュ（新日付のデータ）
    writeFileSync(join(cacheDir, '7203.T.json'), JSON.stringify([
      { date: '2024-01-05', ticker: '7203.T', open: 2530, high: 2560, low: 2510, close: 2540, adj_close: 2540, volume: 900000 },
    ]));
    // 重複（既存と同じ日付）も含める → 排除されるはず
    writeFileSync(join(cacheDir, '9999.T.json'), JSON.stringify([
      { date: '2024-01-04', ticker: '9999.T', open: 100, high: 110, low: 90, close: 105, adj_close: 105, volume: 1000 },
    ]));

    const logger = createLogger('test-merge');
    const updated = await mergeUpdateIntoTickerParquets(`${cacheDir}/*.json`, pricesDir, logger);

    expect(updated).toBe(2); // 7203.T (merge) + 9999.T (new)

    // 7203.T: 2行（既存1 + 新1）
    const inst2 = await DuckDBInstance.create(':memory:');
    const conn2 = await inst2.connect();
    const r1 = await conn2.runAndReadAll(
      `SELECT COUNT(*) AS cnt FROM read_parquet('${join(pricesDir, '7203.T.parquet')}')`
    );
    // 9999.T: 新規作成されている
    expect(existsSync(join(pricesDir, '9999.T.parquet'))).toBe(true);
    conn2.disconnectSync();
    inst2.closeSync();

    expect(Number(r1.getRowObjects()[0].cnt)).toBe(2);
  });

  it('deduplicates records with same date', async () => {
    const pricesDir = join(testBase, 'prices-dedup');
    const cacheDir = join(testBase, 'cache-dedup');
    mkdirSync(pricesDir, { recursive: true });
    mkdirSync(cacheDir, { recursive: true });

    const inst = await DuckDBInstance.create(':memory:');
    const conn = await inst.connect();
    await conn.run(`
      COPY (SELECT '2024-01-04'::VARCHAR AS date, '1234.T'::VARCHAR AS ticker,
                   1000.0::DOUBLE AS open, 1010.0::DOUBLE AS high,
                   990.0::DOUBLE AS low, 1005.0::DOUBLE AS close,
                   1005.0::DOUBLE AS adj_close, 50000::BIGINT AS volume)
      TO '${join(pricesDir, '1234.T.parquet')}' (FORMAT PARQUET, COMPRESSION ZSTD)
    `);
    conn.disconnectSync();
    inst.closeSync();

    // 同じ日付のデータを delta に入れる（重複排除テスト）
    writeFileSync(join(cacheDir, '1234.T.json'), JSON.stringify([
      { date: '2024-01-04', ticker: '1234.T', open: 1000, high: 1010, low: 990, close: 1005, adj_close: 1005, volume: 50000 },
    ]));

    const logger = createLogger('test-dedup');
    await mergeUpdateIntoTickerParquets(`${cacheDir}/*.json`, pricesDir, logger);

    const inst2 = await DuckDBInstance.create(':memory:');
    const conn2 = await inst2.connect();
    const r = await conn2.runAndReadAll(
      `SELECT COUNT(*) AS cnt FROM read_parquet('${join(pricesDir, '1234.T.parquet')}')`
    );
    conn2.disconnectSync();
    inst2.closeSync();

    expect(Number(r.getRowObjects()[0].cnt)).toBe(1); // 重複排除で1行
  });
});
```

- [ ] **Step 2: テストを実行して通過を確認する**

```bash
cd /home/oharato/workspace/stock-data && npm test -- src/repository/parquet.test.ts 2>&1 | tail -25
```

Expected: PASS (全テスト)

- [ ] **Step 3: コミット**

```bash
cd /home/oharato/workspace/stock-data && git add src/repository/parquet.test.ts && git commit -m "test: add mergeUpdateIntoTickerParquets tests

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 3: `fetch-initial.ts` を更新

**Files:**
- Modify: `src/fetch-initial.ts`

- [ ] **Step 1: fetch-initial.ts を更新する**

`src/fetch-initial.ts` の import と Phase 2 を変更する：

```typescript
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import type { Ticker, ErrorRecord } from './domain/types.js';
import { fetchTickerRange } from './repository/yahoo.js';
import { buildTickerParquets } from './repository/parquet.js';
import { today } from './logic/date-utils.js';
import { createLogger } from './logic/logger.js';

const DELAY_MS = 1000;
const RAW_DIR = 'data/raw';
const PRICES_DIR = 'data/prices';
const START_DATE = '2000-01-01';
```

Phase 2 の部分（`// Phase 2:` のコメントから `logger.log('Phase 2 complete...')` まで）を：

```typescript
  // Phase 2: raw JSONを銘柄別Parquetに変換（単一DuckDBインスタンスで高速処理）
  const rawGlob = `${RAW_DIR}/*.json`;
  const written = await buildTickerParquets(rawGlob, PRICES_DIR, logger);
  logger.log(`Phase 2 complete: ${written} parquet files written`);
```

- [ ] **Step 2: TypeScript型チェック**

```bash
cd /home/oharato/workspace/stock-data && npx tsc --noEmit 2>&1 | head -20
```

Expected: エラーなし（または無関係のエラーのみ）

- [ ] **Step 3: 全テストが通ることを確認**

```bash
cd /home/oharato/workspace/stock-data && npm test 2>&1 | tail -15
```

Expected: All tests pass

- [ ] **Step 4: コミット**

```bash
cd /home/oharato/workspace/stock-data && git add src/fetch-initial.ts && git commit -m "feat: update fetch-initial Phase 2 to use per-ticker parquets

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 4: `fetch-update.ts` を更新

**Files:**
- Modify: `src/fetch-update.ts`

- [ ] **Step 1: fetch-update.ts を更新する**

ファイル全体を以下に置き換える：

```typescript
import { writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import type { Ticker, ErrorRecord } from './domain/types.js';
import { fetchTickerRange } from './repository/yahoo.js';
import { mergeUpdateIntoTickerParquets } from './repository/parquet.js';
import { buildDuckDb, readDbMaxDate } from './repository/duckdb.js';
import { fetchAndSaveTickers } from './repository/jpx.js';
import { today, getCurrentYearMonth } from './logic/date-utils.js';
import { calcFetchRange } from './logic/update-logic.js';
import { createLogger } from './logic/logger.js';

const DELAY_MS = 1000;
const UPDATE_CACHE_BASE = 'data/update-cache';
const PRICES_DIR = 'data/prices';

/** 当日以外のキャッシュディレクトリを削除する */
function pruneOldCaches(currentKey: string, logger: ReturnType<typeof createLogger>): void {
  if (!existsSync(UPDATE_CACHE_BASE)) return;
  for (const entry of readdirSync(UPDATE_CACHE_BASE)) {
    if (entry !== currentKey) {
      const stale = join(UPDATE_CACHE_BASE, entry);
      rmSync(stale, { recursive: true, force: true });
      logger.log(`Removed stale cache: ${stale}`);
    }
  }
}

async function main() {
  const logger = createLogger('fetch-update');
  logger.log(`Starting fetch-update (log: ${logger.logFile})`);

  // Step 1: tickers.jsonを最新のJPXリストで更新（新規上場・上場廃止を反映）
  logger.log('Step 1: Updating tickers.json from JPX...');
  const tickers: Ticker[] = await fetchAndSaveTickers();
  logger.log(`Loaded ${tickers.length} tickers`);

  // Step 2: 最終取得日を確認（stock.duckdb > 当月1日 の優先順）
  const { year, month } = getCurrentYearMonth();
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const todayStr = today();

  const lastDate = await readDbMaxDate();
  logger.log(`Last date: ${lastDate ?? 'none'} (source: ${lastDate ? 'stock.duckdb' : 'none'})`);

  const range = calcFetchRange(lastDate, todayStr, monthStart);
  if (!range) {
    logger.log(`Already up to date (last date: ${lastDate ?? 'none'}).`);
    return;
  }

  // キャッシュキー = "period1_period2"（当日ユニーク）
  const cacheKey = `${range.period1}_${range.period2}`;
  const cacheDir = join(UPDATE_CACHE_BASE, cacheKey);

  // 前日以前のキャッシュを削除
  pruneOldCaches(cacheKey, logger);
  mkdirSync(cacheDir, { recursive: true });

  const cachedFiles = existsSync(cacheDir)
    ? readdirSync(cacheDir).filter(f => f.endsWith('.json')).length
    : 0;
  logger.log(`Step 2: Fetching ${range.period1} ~ ${range.period2} for ${tickers.length} tickers (cache: ${cacheDir}, ${cachedFiles} cached)...`);

  // Step 3: 差分を取得（逐次、キャッシュあり）
  const errors: ErrorRecord[] = [];
  let done = 0;
  let cached = 0;

  for (const ticker of tickers) {
    const cachePath = join(cacheDir, `${ticker.code}.json`);

    if (existsSync(cachePath)) {
      done++;
      cached++;
      logger.progress(`${done}/${tickers.length} (${cached} cached)`);
      continue;
    }

    try {
      const records = await fetchTickerRange(ticker.code, range.period1, range.period2);
      writeFileSync(cachePath, JSON.stringify(records));
    } catch (err) {
      errors.push({
        ticker: ticker.code,
        period: `${range.period1}~${range.period2}`,
        reason: String(err),
      });
      logger.error(`Failed: ${ticker.code} — ${err}`);
    }
    done++;
    logger.progress(`${done}/${tickers.length}`);
    if (done % 100 === 0) {
      logger.log(`Progress: ${done}/${tickers.length} fetched, ${errors.length} errors`);
    }
    if (done < tickers.length) {
      await new Promise(res => setTimeout(res, DELAY_MS));
    }
  }
  logger.done();
  logger.log(`Fetch complete: ${cached} cached, ${errors.length} errors`);

  // Step 4: 銘柄別parquetに差分をマージ（単一DuckDBセッション）
  const cacheGlob = join(cacheDir, '*.json');
  logger.log(`Step 4: Merging update cache into per-ticker parquets...`);
  const updated = await mergeUpdateIntoTickerParquets(cacheGlob, PRICES_DIR, logger);
  logger.log(`Updated ${updated} ticker parquets`);

  if (errors.length > 0) {
    writeFileSync('errors.json', JSON.stringify(errors, null, 2));
    logger.error(`${errors.length} errors saved to errors.json`);
  }

  // Step 5: DuckDB再構築
  logger.log('Step 5: Rebuilding stock.duckdb...');
  await buildDuckDb();
  logger.log('Done!');
}

main().catch(console.error);
```

- [ ] **Step 2: TypeScript型チェック**

```bash
cd /home/oharato/workspace/stock-data && npx tsc --noEmit 2>&1 | head -20
```

Expected: エラーなし

- [ ] **Step 3: 全テストが通ることを確認**

```bash
cd /home/oharato/workspace/stock-data && npm test 2>&1 | tail -15
```

Expected: All tests pass

- [ ] **Step 4: コミット**

```bash
cd /home/oharato/workspace/stock-data && git add src/fetch-update.ts && git commit -m "feat: update fetch-update to merge into per-ticker parquets

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 5: `buildDuckDb` のデフォルト glob 更新 + duckdb テスト修正

**Files:**
- Modify: `src/repository/duckdb.ts`
- Modify: `src/repository/duckdb.test.ts`

- [ ] **Step 1: duckdb.ts のデフォルト glob を変更する**

`src/repository/duckdb.ts` の `buildDuckDb` シグネチャ行を変更：

```typescript
export async function buildDuckDb(
  parquetGlob: string = 'data/prices/*.parquet',
  dbPath: string = 'stock.duckdb',
  tickersPath: string = 'tickers.json'
): Promise<void> {
```

- [ ] **Step 2: duckdb.test.ts を書き換える（writeParquet廃止）**

`src/repository/duckdb.test.ts` をファイル全体で置き換える：

```typescript
// src/repository/duckdb.test.ts
import { describe, it, expect, afterAll } from 'vitest';
import { buildDuckDb, readDbMaxDate } from './duckdb.js';
import { DuckDBInstance } from '@duckdb/node-api';
import { join } from 'path';
import { tmpdir } from 'os';
import { rmSync, existsSync, mkdirSync, writeFileSync } from 'fs';

const testBase = join(tmpdir(), `duckdb-test-${process.pid}-${Date.now()}`);
const testDbPath = join(testBase, 'test.duckdb');
const testTickersPath = join(testBase, 'tickers.json');

/** テスト用の per-ticker parquet を DuckDB で直接作成するヘルパー */
async function writeTestParquet(path: string, rows: Array<{
  date: string; ticker: string; open: number; high: number;
  low: number; close: number; adj_close: number; volume: number;
}>): Promise<void> {
  const inst = await DuckDBInstance.create(':memory:');
  const conn = await inst.connect();
  try {
    const values = rows.map(r =>
      `('${r.date}'::VARCHAR, '${r.ticker}'::VARCHAR, ${r.open}, ${r.high}, ${r.low}, ${r.close}, ${r.adj_close}, ${r.volume}::BIGINT)`
    ).join(',\n');
    await conn.run(`
      COPY (
        SELECT col0 AS date, col1 AS ticker, col2 AS open, col3 AS high,
               col4 AS low, col5 AS close, col6 AS adj_close, col7 AS volume
        FROM (VALUES ${values})
      ) TO '${path}' (FORMAT PARQUET, COMPRESSION ZSTD)
    `);
  } finally {
    conn.disconnectSync();
    inst.closeSync();
  }
}

afterAll(() => {
  if (existsSync(testBase)) rmSync(testBase, { recursive: true });
});

describe('buildDuckDb', () => {
  it('creates prices and tickers tables from per-ticker parquets', async () => {
    const pricesDir = join(testBase, 'prices');
    mkdirSync(pricesDir, { recursive: true });

    await writeTestParquet(join(pricesDir, '7203.T.parquet'), [
      { date: '2024-01-04', ticker: '7203.T', open: 2500, high: 2550, low: 2490, close: 2530, adj_close: 2530, volume: 1000000 },
    ]);
    await writeTestParquet(join(pricesDir, '1234.T.parquet'), [
      { date: '2024-01-04', ticker: '1234.T', open: 1000, high: 1010, low: 990, close: 1005, adj_close: 1005, volume: 50000 },
    ]);

    writeFileSync(testTickersPath, JSON.stringify([
      { code: '7203.T', name: 'トヨタ自動車', market: 'プライム（内国株式）' },
      { code: '1234.T', name: 'テスト銘柄', market: 'スタンダード（内国株式）' },
    ]));

    const parquetGlob = join(pricesDir, '*.parquet');
    await buildDuckDb(parquetGlob, testDbPath, testTickersPath);

    const inst = await DuckDBInstance.create(testDbPath);
    const conn = await inst.connect();
    const priceCount = await conn.runAndReadAll('SELECT COUNT(*) AS cnt FROM prices');
    const tickerCount = await conn.runAndReadAll('SELECT COUNT(*) AS cnt FROM tickers');
    const tickerRow = await conn.runAndReadAll("SELECT name FROM tickers WHERE code = '7203.T'");
    conn.disconnectSync();
    inst.closeSync();

    expect(Number((priceCount.getRowObjects()[0] as any).cnt)).toBe(2);
    expect(Number((tickerCount.getRowObjects()[0] as any).cnt)).toBe(2);
    expect((tickerRow.getRowObjects()[0] as any).name).toBe('トヨタ自動車');
  });

  it('creates only prices table when tickers.json is absent', async () => {
    const db2Path = join(testBase, 'test2.duckdb');
    const pricesGlob = join(testBase, 'prices', '*.parquet');
    await buildDuckDb(pricesGlob, db2Path, join(testBase, 'nonexistent.json'));

    const inst = await DuckDBInstance.create(db2Path);
    const conn = await inst.connect();
    const priceCount = await conn.runAndReadAll('SELECT COUNT(*) AS cnt FROM prices');
    let tickersExists = false;
    try {
      await conn.runAndReadAll('SELECT 1 FROM tickers LIMIT 1');
      tickersExists = true;
    } catch { /* expected */ }
    conn.disconnectSync();
    inst.closeSync();

    expect(Number((priceCount.getRowObjects()[0] as any).cnt)).toBe(2);
    expect(tickersExists).toBe(false);
  });
});

describe('readDbMaxDate', () => {
  it('returns max date from prices table', async () => {
    expect(await readDbMaxDate(testDbPath)).toBe('2024-01-04');
  });

  it('returns null for non-existent db', async () => {
    expect(await readDbMaxDate(join(testBase, 'nonexistent.duckdb'))).toBeNull();
  });
});
```

- [ ] **Step 3: テストを実行して通過を確認**

```bash
cd /home/oharato/workspace/stock-data && npm test -- src/repository/duckdb.test.ts 2>&1 | tail -20
```

Expected: PASS (4テスト)

- [ ] **Step 4: 全テストを実行**

```bash
cd /home/oharato/workspace/stock-data && npm test 2>&1 | tail -15
```

Expected: All tests pass

- [ ] **Step 5: コミット**

```bash
cd /home/oharato/workspace/stock-data && git add src/repository/duckdb.ts src/repository/duckdb.test.ts && git commit -m "feat: update buildDuckDb to use flat per-ticker parquet glob

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 6: 旧コードの削除

**Files:**
- Modify: `src/repository/parquet.ts` — 旧関数（readParquet, writeParquet, readParquetMaxDate, buildParquetsFromRaw）は Task 1 で置き換え済み。このタスクでは確認のみ。
- Modify: `src/logic/date-utils.ts` — `monthParquetPath`, `getMonthKey` 削除
- Modify: `src/logic/date-utils.test.ts` — 削除した関数のテスト削除
- Modify: `src/logic/update-logic.ts` — `mergeRecords` 削除
- Modify: `src/logic/update-logic.test.ts` — `mergeRecords` テスト削除

- [ ] **Step 1: date-utils.ts から monthParquetPath と getMonthKey を削除する**

`src/logic/date-utils.ts` を以下に置き換える：

```typescript
import { join } from 'path';

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
```

- [ ] **Step 2: date-utils.test.ts から削除した関数のテストを削除する**

`src/logic/date-utils.test.ts` を以下に置き換える：

```typescript
import { describe, it, expect } from 'vitest';
import { addDay, isWeekend } from './date-utils.js';

describe('addDay', () => {
  it('adds one day', () => {
    expect(addDay('2024-01-04')).toBe('2024-01-05');
  });
  it('crosses month boundary', () => {
    expect(addDay('2024-01-31')).toBe('2024-02-01');
  });
  it('crosses year boundary', () => {
    expect(addDay('2024-12-31')).toBe('2025-01-01');
  });
});

describe('isWeekend', () => {
  it('returns true for Saturday (2024-01-06)', () => {
    expect(isWeekend('2024-01-06')).toBe(true);
  });
  it('returns true for Sunday (2024-01-07)', () => {
    expect(isWeekend('2024-01-07')).toBe(true);
  });
  it('returns false for Monday (2024-01-08)', () => {
    expect(isWeekend('2024-01-08')).toBe(false);
  });
});
```

- [ ] **Step 3: update-logic.ts から mergeRecords を削除する**

`src/logic/update-logic.ts` を以下に置き換える：

```typescript
export function calcFetchRange(
  lastDate: string | null,
  todayStr: string,
  monthStart: string
): { period1: string; period2: string } | null {
  const period1 = lastDate ? addDay(lastDate) : monthStart;
  if (period1 > todayStr) return null;
  return { period1, period2: todayStr };
}

import { addDay } from './date-utils.js';
```

> **注意:** import 文は TypeScript の慣習上ファイル先頭に置く。以下が正しい形：

```typescript
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
```

- [ ] **Step 4: update-logic.test.ts から mergeRecords テストを削除する**

`src/logic/update-logic.test.ts` を以下に置き換える：

```typescript
import { describe, it, expect } from 'vitest';
import { calcFetchRange } from './update-logic.js';

describe('calcFetchRange', () => {
  it('returns period1 = day after lastDate', () => {
    expect(calcFetchRange('2024-06-10', '2024-06-12', '2024-06-01'))
      .toEqual({ period1: '2024-06-11', period2: '2024-06-12' });
  });

  it('returns month start as period1 when no existing data (lastDate = null)', () => {
    expect(calcFetchRange(null, '2024-06-12', '2024-06-01'))
      .toEqual({ period1: '2024-06-01', period2: '2024-06-12' });
  });

  it('returns null when already up to date', () => {
    expect(calcFetchRange('2024-06-12', '2024-06-12', '2024-06-01')).toBeNull();
  });

  it('returns null when period1 would be after today', () => {
    expect(calcFetchRange('2099-01-01', '2024-06-12', '2024-06-01')).toBeNull();
  });
});
```

- [ ] **Step 5: 全テストを実行して通過を確認**

```bash
cd /home/oharato/workspace/stock-data && npm test 2>&1 | tail -15
```

Expected: All tests pass（テスト数は減少しているはず）

- [ ] **Step 6: TypeScript型チェック**

```bash
cd /home/oharato/workspace/stock-data && npx tsc --noEmit 2>&1
```

Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
cd /home/oharato/workspace/stock-data && git add src/logic/date-utils.ts src/logic/date-utils.test.ts src/logic/update-logic.ts src/logic/update-logic.test.ts && git commit -m "refactor: remove monthParquetPath, getMonthKey, mergeRecords (replaced by DuckDB merge)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 7: データマイグレーション実行

既存の月別parquetを削除し、新しい銘柄別parquetを生成する。

- [ ] **Step 1: 既存の月別parquetを削除**

```bash
cd /home/oharato/workspace/stock-data && rm -rf data/prices && echo "Cleared monthly parquets"
```

- [ ] **Step 2: fetch-initial を実行（Phase 1はキャッシュ済みのため高速）**

```bash
cd /home/oharato/workspace/stock-data && npm run fetch-initial 2>&1 | tail -20
```

Expected:
- Phase 1: all 3566 cached（data/raw/*.json が存在するためスキップ）
- Phase 2: 3566 ticker parquets written (推定 30-40秒)

- [ ] **Step 3: 結果を確認**

```bash
cd /home/oharato/workspace/stock-data && ls data/prices/ | wc -l && echo "parquet files" && node --input-type=module <<'EOF'
import { DuckDBInstance } from '@duckdb/node-api';
const inst = await DuckDBInstance.create(':memory:');
const conn = await inst.connect();
const r = await conn.runAndReadAll(`SELECT COUNT(*) AS cnt FROM read_parquet('data/prices/*.parquet')`);
console.log('total rows:', Number(r.getRowObjects()[0].cnt).toLocaleString());
const r2 = await conn.runAndReadAll(`SELECT max(date)::VARCHAR AS d, min(date)::VARCHAR AS d2 FROM read_parquet('data/prices/*.parquet')`);
const row = r2.getRowObjects()[0];
console.log('date range:', row.d2, '~', row.d);
conn.disconnectSync(); inst.closeSync();
EOF
```

Expected:
```
3566
parquet files
total rows: 17,243,039
date range: 2000-01-03 ~ 2026-06-12
```

- [ ] **Step 4: build-duckdb を実行**

```bash
cd /home/oharato/workspace/stock-data && npm run build-duckdb 2>&1 | tail -10
```

Expected: stock.duckdb が更新される（prices: 17,243,039 rows）

- [ ] **Step 5: コミット**

```bash
cd /home/oharato/workspace/stock-data && git add -A && git commit -m "chore: migrate from monthly to per-ticker parquets

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## 自己レビュー

**Spec coverage チェック:**
- ✅ `buildTickerParquets()` — Task 1
- ✅ `mergeUpdateIntoTickerParquets()` — Task 2 (テスト) + Task 1 (実装)
- ✅ `fetch-initial` Phase 2更新 — Task 3
- ✅ `fetch-update` 更新 — Task 4
- ✅ `buildDuckDb` glob変更 — Task 5
- ✅ `monthParquetPath`, `getMonthKey` 削除 — Task 6
- ✅ `mergeRecords` 削除 — Task 6
- ✅ `readParquet`, `writeParquet`, `readParquetMaxDate` 削除 — Task 1（置き換え）
- ✅ データマイグレーション — Task 7

**パフォーマンス比較（実測ベース）:**
| Phase 2 | 旧（月別parquet） | 新（銘柄別parquet） |
|---------|------------------|-------------------|
| データロード | 17s | 12s |
| parquet書き出し | 68s (318ファイル) | 25s (3566ファイル) |
| **合計** | **~85s** | **~37s** |

差分更新マージ: 3566銘柄 × ~7ms = ~25s（単一DuckDBセッション）
