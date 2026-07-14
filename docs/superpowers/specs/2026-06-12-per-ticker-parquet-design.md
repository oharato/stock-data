# Per-Ticker Parquet アーキテクチャ設計

**日付:** 2026-06-12  
**目的:** 月別parquetを廃止し、銘柄別parquetに一本化することでパイプラインを簡素化する

---

## 背景・課題

現行アーキテクチャでは以下の2層ストレージが存在し冗長：

- `data/raw/{ticker}.json` — 初回取得キャッシュ
- `data/prices/YYYY/MM.parquet` — 月別parquet（318ファイル）

差分更新時に月をまたぐと複数の月別parquetを更新する必要があり、複雑。  
DuckDB globも2階層（`data/prices/*/*.parquet`）でわかりづらい。

毎日の更新は全銘柄数分のリクエストが必要なため、どのアーキテクチャでもリクエスト数は変わらない。  
ならばリクエスト結果を銘柄ごとのparquetとして直接保存し、間接レイヤーを減らす。

---

## 新アーキテクチャ

### ファイル構造

```
data/
  raw/                       # Phase 1 fetchキャッシュ（初回のみ、再開用）
    {ticker}.json
  prices/
    {ticker}.parquet         # 銘柄別全期間parquet（主要ストレージ）★NEW
  update-cache/
    {YYYY-MM-DD}/            # 差分更新キャッシュ（翌日自動削除）
      {ticker}.json
stock.duckdb                 # 分析用DB（data/prices/*.parquetから構築）
tickers.json
```

### データフロー

#### 初回取得 (`fetch-initial`)

```
Phase 1: tickers.json
  → Yahoo Finance API (1req/sec, 1req/銘柄, 全期間)
  → data/raw/{ticker}.json  (再開可能なキャッシュ)

Phase 2: data/raw/*.json (DuckDB単一セッション)
  → data/prices/{ticker}.parquet (3566ファイル)
```

#### 差分更新 (`fetch-update`)

```
1. JPXからtickers.json更新
2. stock.duckdb最終日 → 翌日〜本日のfetch範囲を計算
3. Yahoo Finance API (1req/sec)
   → data/update-cache/{YYYY-MM-DD}/{ticker}.json
4. 単一DuckDBセッション:
   - delta全体を一括ロード
   - 新データのある銘柄のみ data/prices/{ticker}.parquet を更新（マージ）
5. stock.duckdb 再構築
```

#### DuckDB構築 (`build-duckdb`)

```
data/prices/*.parquet (glob, 1階層)
  → stock.duckdb (prices テーブル + tickers テーブル)
```

---

## 実装変更詳細

### 追加する関数

**`src/repository/parquet.ts`**

```typescript
// Phase 2用: raw/*.jsonをper-tickerパーケに変換（単一DuckDBセッション）
buildTickerParquets(rawGlob: string, pricesDir: string, logger: Logger): Promise<number>

// 差分更新用: update-cache以下のJSONをper-tickerパーケにマージ（単一DuckDBセッション）
// tickersパラメータ不要 — delta自体から ticker を特定する
mergeUpdateIntoTickerParquets(
  cacheGlob: string,    // e.g. 'data/update-cache/2026-06-13/*.json'
  pricesDir: string,
  logger: Logger
): Promise<number>
```

**マージ戦略（単一DuckDBセッション）:**
```sql
-- 全deltaを一括ロード
CREATE TEMP TABLE delta AS SELECT * FROM read_json_auto('{cacheDir}/*.json');

-- 新データのある銘柄を特定
SELECT DISTINCT ticker FROM delta;

-- 銘柄ごとにマージしてparquet上書き（tmpファイル経由でアトミックに）
COPY (
  SELECT * FROM (
    SELECT * FROM read_parquet('{pricesDir}/{ticker}.parquet')
    UNION ALL
    SELECT * FROM delta WHERE ticker = '{ticker}'
  )
  QUALIFY ROW_NUMBER() OVER (PARTITION BY date ORDER BY date) = 1
  ORDER BY date
) TO '{pricesDir}/{ticker}.parquet.tmp' (FORMAT PARQUET, COMPRESSION ZSTD)
-- → renameSync(tmp, parquet)
```

### 変更する関数

**`src/repository/duckdb.ts`**

- `buildDuckDb()` のデフォルトglob: `data/prices/*/*.parquet` → `data/prices/*.parquet`

**`src/fetch-update.ts`**

- Step 4（月別parquetマージ）を `mergeUpdateIntoTickerParquets()` 呼び出しに変更
- `monthParquetPath`, `getCurrentYearMonth` の import 削除

**`src/fetch-initial.ts`**

- Phase 2を `buildTickerParquets()` 呼び出しに変更（関数名変更のみ）

### 削除する関数・ファイル

- `src/repository/parquet.ts`: `buildParquetsFromRaw()`, `readParquetMaxDate()`, `readParquet()`, `writeParquet()` — テストごと削除
- `src/logic/date-utils.ts`: `monthParquetPath()`, `getCurrentYearMonth()`, `getMonthKey()` — テストごと削除
- `src/logic/update-logic.ts`: `mergeRecords()` — DuckDBマージに置き換え、テストも削除

---

## テスト方針

- `buildTickerParquets()`: モックJSONから正しいparquetが生成されることを確認
- `mergeUpdateIntoTickerParquets()`: 既存parquet+deltaのマージ、重複排除、日付順ソートを確認
- `buildDuckDb()`: 新globパターンでpricesテーブルが構築されることを確認
- 既存テストの更新: `monthParquetPath`, `getCurrentYearMonth` を参照するテストを削除/修正

---

## マイグレーション

既存の `data/prices/YYYY/MM.parquet` から新形式への移行:

```bash
# fetch-initial を再実行（data/raw/*.jsonキャッシュが残っているので高速）
npm run fetch-initial
# data/raw/*.json → data/prices/*.parquet に変換される
```

旧形式のparquetは `fetch-initial` 完了後に手動削除。

---

## 非機能要件

- 再開可能性: Phase 1は `data/raw/{ticker}.json` が存在すればスキップ（現行維持）
- 差分キャッシュ: 翌日実行時に前日のキャッシュを自動削除（現行維持）
- ログ: 進捗は50件ごと（現行維持）
- エラーハンドリング: 失敗銘柄は `errors.json` に記録（現行維持）
