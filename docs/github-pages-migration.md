# GitHub Pages への移行および GitHub Actions デプロイ計画書

本ドキュメントは、株価データ取得・チャート画像生成バッチ（`npm run all`）を GitHub Actions 上で定期実行し、かつサーバーの動かない GitHub Pages（完全静的ホスティング）上で「株価チャート・パノラマビューア」を稼働させるための移行計画をまとめたものです。

---

## 1. 静的サイト化の基本方針 (Static Architecture)

GitHub Pages には Node.js サーバーや DuckDB データベースをホストする機能がありません。そのため、以下のような **JAMstack (JavaScript / APIs / Markup)** 構成へシフトします。

```mermaid
graph TD
    A[GitHub Actions (Cron/Manual)] -->|1. Data Fetch| B(Yahoo Finance)
    A -->|2. Build DB| C[(DuckDB)]
    A -->|3. Export Data| D[data.json]
    A -->|4. Generate Charts| E[charts/*.webp]
    A -->|5. Render HTML| F[index.html]
    A -->|6. Deploy| G((GitHub Pages))
    
    G -->|Static Hosting| H[Client Browser]
    H -->|Fetch once| D
    H -->|Local Filter & Scroll| I[Client JS / DOM]
```

* **サーバーレス・DBレス運用**:
  ビルド時に DuckDB から全銘柄のメタデータ（時価総額や上場日を含む）を 1 つの JSON ファイル（`data.json`）としてエクスポートします。
* **クライアントサイドでのフィルタ＆ソート**:
  ブラウザがロード時に `data.json` を一度だけ `fetch` してメモリにキャッシュし、検索・業種フィルタ・ソート（時価総額順、上場日順）の処理を **すべてブラウザ上の JavaScript で実行** します。

---

## 2. ディレクトリ・静的ファイルの構成設計

ビルド後に生成される静的ファイルは、リポジトリの `dist/` ディレクトリ（またはデプロイ対象ディレクトリ）に以下のように配置されるように構築します。

```
dist/
├── index.html               # サーバーサイド SSR から、完全な静的 HTML へ移行
├── charts/                  # 生成された WebP チャート画像 (./data/charts からコピー)
│   ├── daily/*.webp
│   ├── weekly/*.webp
│   └── monthly/*.webp
├── public/
│   ├── viewer.css           # 既存のスタイル
│   ├── viewer.js            # クライアントサイドでデータフィルタを行うロジック (大幅拡張)
│   └── data.json            # DuckDB からエクスポートされた全銘柄の JSON メタデータ (約 500 KB)
```

---

## 3. 具体的なソースコードの修正計画

### 3.1. 静的書き出しビルドスクリプトの作成 (`src/static-builder/build.ts`)
DuckDB の構築完了後に、以下を実行するNodeスクリプトを新規作成します。
1. **`data.json` のエクスポート**:
   `tickers` テーブルの全銘柄レコードを抽出し、`dist/public/data.json` としてファイル出力。
2. **`index.html` の静的書き出し**:
   初期表示用の `Viewer.tsx` コンポーネントを HTML 文字列としてレンダリングし、`dist/index.html` としてファイル出力。
3. **静的アセットのコピー**:
   `public/viewer.css`, `public/viewer.js` および `data/charts/` を `dist/` ディレクトリ配下に自動コピー。

### 3.2. クライアントサイド JS の拡張 (`public/viewer.js`)
現在、サーバーサイド（`server.tsx`）が担っているフィルタリングとページャー（追加読み込み）を、クライアント側 JavaScript で自律的に行うように実装します。

* **データ読み込み**:
  初期化時に `/public/data.json` を非同期で取得。
* **DOM生成関数**:
  `data.json` の各要素から、HTML テンプレート（`TickerCard` に相当するもの）を動的に構築し、挿入する関数を定義。
* **イベント監視**:
  検索窓の `input`、業種セレクトボックスの `change`、ソート順の `change` イベントをハンドリングし、メモリ内の配列に対して `filter` および `sort` を実行し、DOMを再描画。

### 3.3. HTML（`Viewer.tsx` / `Layout.tsx`）の静的調整
* `/api/tickers/html` に対する `fetch` によるサーバー側 HTML 追加読み込み処理を廃止し、クライアントサイドの `viewer.js` がメモリ内のデータを切り出して DOM 構築するように調整。
* パス解決を絶対パスから相対パス（例: `./public/viewer.css`）へ移行し、GitHub Pages のサブディレクトリ構成（`https://username.github.io/repository-name/`）でも画像やアセットが壊れないように調整。

---

## 4. GitHub Actions ワークフロー設計

`.github/workflows/deploy.yml` に定義する設定案です。

* **トリガー (Trigger)**:
  * 平日の日本時間 18:00 (UTC 9:00) に自動実行する cron スケジュール。
  * `workflow_dispatch`（手動実行可能）。
* **デプロイステップ**:
  1. **Checkout**: ソースコードの取得。
  2. **Setup Node**: Node.js 環境の用意。
  3. **Install**: `npm ci` による確実なインストール。
  4. **Fetch**: `npm run fetch` で Yahoo Finance から最新データを取得。
  5. **Build DB**: `npm run build-duckdb` で DuckDB にデータ構築。
  6. **Generate Batch**: `npm run generate-batch` でチャート画像生成。
  7. **Static Build**: `npm run build:static` で JSON と HTML を `dist/` に生成。
  8. **Deploy to Pages**: GitHub Pages 向けアクション（`actions/deploy-pages`）を用いて `dist/` をデプロイ。

---

## 5. 移行ロードマップ (Phased Roadmap)

* **フェーズ 1: 静的ビルド・エクスポートの実装 (ローカル検証可能)**
  Hono サーバーを起動せずとも、`node src/static-builder/build.js` を動かせば `dist/` 配下に完全な静的サイトが出力され、`npx http-server dist` などでローカルで完全に稼働する状態を作ります。
* **フェーズ 2: クライアントサイド JS のフィルタリング開発**
  `viewer.js` 内に `data.json` を使ったフィルタ、ソート、インフィニットスクロールのロジックを実装。ローカルで動作検証。
* **フェーズ 3: GitHub Actions の構築と Pages デプロイ**
  Actions ワークフローファイルを定義し、実際に GitHub にプッシュして自動実行・公開テストを実施。
