# 日本株データパイプライン & 静的チャートビューア (stock-data)

本プロジェクトは、Yahoo Finance から日本株データを自動取得して高速データベース **DuckDB** を構築し、テクニカル指標（移動平均線）を描画したチャート画像（日足・週足・月足）を WebP 形式で生成するデータパイプラインです。

生成されたチャートと銘柄メタデータは、GitHub Actions 上で自動ビルドされて **GitHub Pages** に完全静的サイト（JAMstack / SPA）としてデプロイされます。サーバー要らずで、ブラウザ側（クライアントサイド）での遅延ゼロの超高速な検索・フィルタリング・ソートを実現しています。

---

## 1. システム構成・ディレクトリ構造

```
stock-data/
├── data/
│   ├── raw/                 ← 各銘柄の全期間日足データ (JSONキャッシュ)
│   ├── charts/              ← 生成された WebP チャート画像 (日足/週足/月足)
│   └── tickers.json         ← Yahoo Finance から抽出した最新の全銘柄情報 (Git管理キャッシュ)
├── dist/                    ← GitHub Pages デプロイ用の完全静的サイト出力 (Git除外)
│   ├── index.html           ← 静的レンダリングされた HTML ビューア
│   ├── public/
│   │   ├── viewer.css       ← デザインスタイルシート
│   │   ├── viewer.js        ← クライアントサイドでのフィルタ・ページング・DOM生成ロジック
│   │   └── data.json        ← 全銘柄のメタデータリスト (時価総額・上場日等, 約 800 KB)
│   └── charts/              ← 生成された WebP 画像コピー
├── stock.duckdb             ← ローカル分析用の統合データベース (Git除外)
├── src/
│   ├── data-fetcher/        ← データ取得・マージ・DuckDB構築ロジック
│   ├── chart-generator/     ← テクニカルチャート画像 (WebP) 生成バッチ
│   ├── chart-viewer/        ← ビューア用 UI スケルトン (Layout.tsx, Viewer.tsx)
│   ├── static-builder/      ← 静的サイトエクスポートビルダー (build.ts)
│   └── shared/              ← 共通リポジトリ (DuckDB 接続・Yahoo API 等)
```

---

## 2. 主要な機能特徴

* **GitHub Pages への JAMstack 移行**:
  Node.js サーバーを不要にし、クライアントサイド JavaScript が `data.json` をロードして検索・業種フィルタ・ソート（時価総額、上場日）をすべてブラウザ上で処理します。サーバーとの通信が発生しないため、条件切り替えが遅延ゼロで瞬時に行われます。
* **ファイル更新日時によるレジューム機能**:
  大量のデータ取得（数時間）の途中でエラーや強制終了が発生しても、JSON キャッシュの更新日時を確認し、**「本日すでに取得した銘柄」を自動スキップ** して未処理の銘柄から再開します。
* **チャート生成のインクリメンタル（差分）更新**:
  画像生成時、DuckDB 内の最終取引日と既存の WebP 画像のタイムスタンプを比較し、**最新データがすでに描画済みの場合は生成をスキップ** します。これにより、日次の定期バッチはほぼ瞬時（約 0.6 秒）に終了します。
* **アトミックなDB構築**:
  DuckDB の構築時は一時ファイル `stock.duckdb.tmp` に書き込みを行い、ビルドが成功した段階でリネームして本番DBと差し替えることで、他プロセスが読み取り専用で開いている状態でもロック競合を起こさずに更新できます。

---

## 3. コマンド一覧

### データ収集・静的サイトビルド

#### 🔄 フルビルド（データ取得から静的エクスポートまで）
```bash
npm run all:static
```
銘柄一覧取得 ➔ 株価履歴取得 ➔ DuckDB構築 ➔ チャート画像生成 ➔ `dist/` への静的ファイル出力、をすべて一貫して実行します。GitHub Actions 上のデプロイで実行されるコマンドです。

#### 📦 静的エクスポート単体実行
```bash
npm run build:static
```
すでにローカルにある `stock.duckdb` とチャート画像群（`data/charts/`）を用いて、`dist/` ディレクトリ配下に静的 Web サイト（`data.json` や HTML）を一括エクスポートします。

#### 👁️ ローカルでの動作確認（プレビュー）
```bash
npm run preview
```
簡易的な静的ファイルサーバーを立ち上げ、`dist/` 配下の静的ビューアをローカルホストでテストできます。GitHub Pages 上にデプロイされた際と **100% 同等の挙動**（検索やフィルタ）を確認できます。

### 開発・検証用コマンド

* **`npm run fetch-tickers`**: 銘柄リスト (`data/tickers.json`) の新規取得。
* **`npm run fetch`**: 株価詳細データ取得と `data/raw/` への JSON キャッシュ化。
* **`npm run build-duckdb`**: キャッシュ JSON からの `stock.duckdb` データベース再構築。
* **`npm run generate-batch`**: テクニカルチャート WebP 画像の差分生成。
* **`npm run test`**: Vitest によるユニットテストの実行。

---

## 4. GitHub Actions による自動化 & デプロイ

本プロジェクトは、`.github/workflows/deploy.yml` で定義された GitHub Actions ワークフローにより、平日の日本時間 18:00 に自動的に実行されます。

* **キャッシュ (GitHub Cache) の活用**:
  `actions/cache@v4` を使用して `stock.duckdb` と `data/charts/` フォルダをビルド間でキャッシュしています。これにより、GitHub Actions 上でも「差分更新（スキップ）」が有効に働き、2回目以降のビルド時間は **数十秒〜1分程度** で終わるように最適化されています。
* **自動リリースアップロード**:
  ビルド完了時、 Actions 上で構築された最新の `stock.duckdb` データベースファイルが、自動的に GitHub Releases の `latest` リリースにアセットとして上書き更新されます。

---

## 5. 最新データベース (DuckDB) のクイック同期 (ダウンロード)

ローカル環境で時間のかかる株価データのスクレイピングを直接動かさなくても、GitHub Releases にアップロードされた最新の `stock.duckdb` をダウンロードしてローカルで即座に分析などに利用できます。

### 📥 同期コマンド (GitHub CLI)
```bash
gh release download latest -p "stock.duckdb" --clobber
```
* **`--clobber`**: ローカルにある既存の古い `stock.duckdb` を、ダウンロードした最新のデータベースファイルで自動的に上書きします。
* ※ 本コマンドの利用には、[GitHub CLI (gh)](https://cli.github.com/) のインストールおよび `gh auth login` によるログインが必要です。

---

## 6. MCP (Model Context Protocol) を用いたデータ分析

AIアシスタント（Cursor、Cline、Claude Desktop など）から本プロジェクト of the DuckDB に直接アクセスし、自然言語で日本株のデータ分析を行うための接続設定です。

### 接続設定 (`mcp.json`)
AIクライアントの MCP 設定ファイルに以下を追記します。

```json
{
  "mcpServers": {
    "duckdb-local": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-duckdb-local",
        "--db-path",
        "/absolute/path/to/stock-data/stock.duckdb"
      ]
    }
  }
}
```

---

## 7. 他プログラムから DuckDB を利用する際の実装アドバイス

同じマシン内の別のプログラムから `stock.duckdb` を参照する場合、**`READ_ONLY` モードで直接ファイルに接続する** のが最も高速です。

バッチ更新時は別の一時ファイルに構築したあとアトミックにリネーム差し替えされるため、別アプリ側で接続を開きっぱなしにしていても、データ更新バッチがロックエラーで失敗することはありません。

### 実装サンプル (TypeScript / Node.js)
```typescript
import { DuckDBInstance } from '@duckdb/node-api';

async function queryStockData() {
  // 読み取り専用モードでインスタンスを作成
  const inst = await DuckDBInstance.create('stock.duckdb', {
    access_mode: 'READ_ONLY'
  });
  
  const conn = await inst.connect();
  try {
    const result = await conn.runAndReadAll(
      `SELECT date, ticker, close FROM prices WHERE ticker = '7203.T' ORDER BY date DESC LIMIT 10`
    );
    const rows = result.getRowObjects();
    console.log(rows);
  } finally {
    conn.disconnectSync();
    inst.closeSync();
  }
}
```
*※注意: Linux環境下では、ファイルがリネーム差し替えされた場合、接続中のプロセスは古いDBの実体（inode）を参照し続けます。最新データを取得するためには、クエリごとに接続を再確立するか、定期的な再接続を行ってください。*
