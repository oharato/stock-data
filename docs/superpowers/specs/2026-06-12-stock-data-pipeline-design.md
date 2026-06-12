# 日本株データパイプライン 設計書

**作成日:** 2026-06-12  
**対象:** 日本株全銘柄の日足データ取得・DuckDB保存・差分更新システム

---

## 概要

Yahoo Finance（`yahoo-finance2`）から日本株の全上場銘柄の日足データ（2000年〜）を取得し、月別Parquetファイルに保存する。最終的にDuckDBファイルとして統合し、毎日の差分更新を可能にする。

---

## ディレクトリ構成

```
stock-data/
├── data/
│   └── prices/
│       ├── 2000/
│       │   ├── 01.parquet   ← 2000年1月・全銘柄・全取引日
│       │   ├── 02.parquet
│       │   └── ...
│       └── 2026/
│           └── 06.parquet   ← 当月（更新対象）
├── stock.duckdb             ← 最終的なDuckDBファイル（全データ）
├── tickers.json             ← JPX上場銘柄リスト（キャッシュ）
├── errors.json              ← 取得失敗銘柄の記録
├── src/
│   ├── domain/
│   │   └── types.ts             ← Ticker, PriceRecord, ErrorRecord型定義
│   ├── logic/
│   │   ├── date-utils.ts        ← 純粋な日付関数
│   │   ├── ticker-parser.ts     ← parseJpxRows（純粋関数）
│   │   ├── price-mapper.ts      ← yahoo行 → PriceRecord変換
│   │   └── update-logic.ts      ← calcFetchRange, mergeRecords
│   ├── repository/
│   │   ├── jpx.ts               ← JPX Excelダウンロード（I/O）
│   │   ├── yahoo.ts             ← yahoo-finance2呼び出し（I/O）
│   │   ├── parquet.ts           ← Parquet読み書き（DuckDB経由）
│   │   └── duckdb.ts            ← DuckDB構築
│   ├── fetch-tickers.ts         ← エントリーポイント
│   ├── fetch-initial.ts         ← エントリーポイント
│   ├── fetch-update.ts          ← エントリーポイント
│   └── build-duckdb.ts          ← エントリーポイント
├── package.json
└── tsconfig.json
```

---

## データスキーマ

### tickers.json

```json
[
  { "code": "7203.T", "name": "トヨタ自動車", "market": "プライム" },
  ...
]
```

### Parquetスキーマ（月別ファイル: `data/prices/YYYY/MM.parquet`）

| カラム | 型 | 説明 |
|--------|-----|------|
| `date` | DATE | 取引日 |
| `ticker` | VARCHAR | 銘柄コード（例: `7203.T`） |
| `open` | DOUBLE | 始値 |
| `high` | DOUBLE | 高値 |
| `low` | DOUBLE | 安値 |
| `close` | DOUBLE | 終値 |
| `adj_close` | DOUBLE | 調整済み終値 |
| `volume` | BIGINT | 出来高 |

---

## スクリプト仕様

### `src/fetch-tickers.ts`

JPX（日本取引所グループ）の公開CSV（上場銘柄一覧）をダウンロードし、`tickers.json`を生成する。

- 取得元: JPX公式サイトの上場銘柄一覧CSV（https://www.jpx.co.jp/markets/statistics-equities/misc/ から最新URLを確認）
- ティッカー変換: `7203` → `7203.T`
- 保存項目: 銘柄コード・銘柄名・市場区分（プライム/スタンダード/グロース）

### `src/fetch-initial.ts`

2000年1月から現在まで、月単位でループして全銘柄の日足データを取得する。

- 銘柄リスト: `tickers.json`から読み込み
- 取得期間: 2000-01-01 〜 現在
- 並列制御: 同時リクエスト数を制限（デフォルト5並列）してAPI制限を回避
- 保存先: `data/prices/YYYY/MM.parquet`（月ごと上書き）
- エラー処理: 取得失敗銘柄を`errors.json`に記録（再実行で再試行可能）
- 進捗表示: 月ごとに進捗をコンソール出力

### `src/fetch-update.ts`（毎日実行）

当月Parquetの最終取得日を確認し、不足分のデータを差分取得する。

1. `fetch-tickers.ts`を呼び出して`tickers.json`を最新のJPXリストで上書き更新（新規上場・上場廃止を反映）
2. 当月Parquetが存在すれば読み込み、`max(date)`を確認
3. 翌営業日から本日まで全銘柄のデータを取得
4. 当月Parquetを既存データとマージして上書き保存
5. `build-duckdb.ts`を呼び出してDuckDBを更新

### `src/build-duckdb.ts`

全Parquetファイルを読み込み、`stock.duckdb`の`prices`テーブルを再構築する。

```sql
CREATE OR REPLACE TABLE prices AS
SELECT * FROM read_parquet('data/prices/**/*.parquet')
ORDER BY date, ticker;
```

---

## 依存パッケージ（npm）

| パッケージ | 用途 |
|------------|------|
| `yahoo-finance2` | Yahoo Financeからの株価取得 |
| `duckdb-async` | DuckDB操作（async/await対応） |
| `@dsnp/parquetjs` | Parquetファイルの読み書き |
| `csv-parse` | JPX CSVのパース |
| `tsx` | TypeScript実行環境 |

---

## エラーハンドリング

- **取得失敗銘柄:** `errors.json`に`{ ticker, period, reason }`形式（period例: `"2024-06"`）で記録。`fetch-initial.ts`は`errors.json`を読み込んで再試行オプションあり。
- **API制限:** 並列数制限＋リトライ（指数バックオフ）で対応
- **不完全な月データ:** Parquet書き込み前に一時ファイルへ保存し、成功後にリネームすることでファイル破損を防ぐ

---

## 実行手順

```bash
# 1. 銘柄リスト取得
npx tsx src/fetch-tickers.ts

# 2. 初回一括取得（時間がかかる）
npx tsx src/fetch-initial.ts

# 3. DuckDB構築
npx tsx src/build-duckdb.ts

# 4. 差分更新（毎日 cron 等で実行）
npx tsx src/fetch-update.ts
```

---

## 設計上の決定事項

- **月別Parquet:** 日別では〜6000ファイル、年別では更新時に巨大ファイルを再構築する必要があるため、月別（〜310ファイル）をバランス点として採用
- **adj_close:** 株式分割・配当の影響を除いた継続的な価格比較のために必要
- **DuckDBは最終成果物:** Parquetが中間生成物、DuckDBが分析用の最終形
