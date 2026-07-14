# 日本株データパイプライン (stock-data)

日本取引所グループ (JPX) の銘柄一覧から、Yahoo Finance API を用いて全銘柄の日足データ（2000年〜本日）を取得し、分析用高速データベースである **DuckDB** に格納するデータパイプラインシステムです。

---

## 1. アーキテクチャ構成

中間レイヤーとして Parquet などを挟まず、APIから取得したデータをそのまま JSON キャッシュとしてローカルに保存し、そこから直接 DuckDB データベースを再構築するシンプルな構成になっています。

```
stock-data/
├── data/
│   └── raw/
│       ├── 7203.T.json      ← 各銘柄の全期間日足データ（中間キャッシュ）
│       └── ...
├── stock.duckdb             ← 分析用の最終DB（JSONキャッシュから自動ビルド）
├── tickers.json             ← JPXからダウンロードした最新の銘柄一覧
├── errors.json              ← 取得エラー履歴
├── src/
│   ├── repository/
│   │   ├── jpx.ts           ← JPXからの銘柄リストダウンロード
│   │   ├── yahoo.ts         ← Yahoo Finance (Chart API) からのデータ取得
│   │   └── duckdb.ts        ← DuckDBの構築・アトミック更新
│   ├── fetch.ts             ← 統合データ取得・DB構築スクリプト（メイン）
│   └── build-duckdb.ts      ← DB手動再構築用スクリプト
```

---

## 2. 主要な機能特徴

### ① 統合された実行フロー (`npm run fetch`)
以前の `fetch-initial` (初回全件) と `fetch-update` (日次差分) は1つの処理に統合されました。
毎回「2000年1月1日〜本日」を指定して各銘柄の全データをYahoo Financeから取得し、キャッシュを完全に上書きします。これにより、複雑なマージ・重複排除ロジックを排除し、データの整合性を担保しています。

### ② ファイル更新日時 (`mtime`) によるレジューム機能
約4,000銘柄のデータ取得にはウェイト処理を挟むため、全体で約1時間強かかります。
途中でエラーや強制終了が発生した場合でも、再度スクリプトを実行するだけで **「本日すでに取得が完了した銘柄（JSONファイルの更新日時が本日のもの）」を自動的にスキップ** し、未処理の銘柄から処理を再開します。翌日になると自動的にタイムスタンプが「昨日以前」になるため、特別なリセットを行わずに次の日の取得が始まります。

### ③ アトミックなDB構築によるロック競合回避
他アプリが `stock.duckdb` を読み取り専用で開いている場合でもバッチが停止しないよう、構築時は一時ファイル `stock.duckdb.tmp` に対して書き込みを行い、完全にビルドが終わった段階で元のファイルにアトミックに差し替える (`renameSync`) ように設計されています。

---

## 3. コマンド

### 銘柄リストの更新
```bash
npm run fetch-tickers
```
JPXの公式リストをダウンロードし、`tickers.json` を最新化します。

### データ取得とDB構築 (日次の自動実行用)
```bash
npm run fetch
```
`tickers.json` の更新後、Yahoo Finance から日足データを取得して `data/raw/*.json` を最新化し、最後に `stock.duckdb` を再構築します（※前述の通りレジュームが有効です）。

### DuckDB の手動再ビルド (キャッシュからのみ)
```bash
npm run build-duckdb
```
APIへの問い合わせを行わず、すでに `data/raw/` 以下に保存されている JSON キャッシュのみを用いて、`stock.duckdb` を一瞬で再構築します。DBスキーマを変更した際などに便利です。

### 全プロセスの順次一括実行
```bash
npm run all
```
`fetch-tickers` (銘柄更新) -> `fetch` (データ取得) -> `build-duckdb` (DB再構築) の3つのコマンドを順番に実行します。前ステップが正常に成功した場合のみ次へ進みます。定期実行の際などに便利です。

### テストの実行
```bash
npm run test
```
Vitest を使用してユニットテストを実行します。

---

## 4. 他アプリケーションから DuckDB を利用する際の実装アドバイス

同じサーバー上で動く別のWebアプリケーションやAPIから `stock.duckdb` を参照したい場合、**「直接 `READ_ONLY` モードでファイルに接続する」** 方法がオーバーヘッドがなく最も高速です。

パイプライン側が一時ファイルを構築した後にリネーム上書きする設計になっているため、別アプリ側で接続を開きっぱなしにしていても、データ更新バッチがロックエラーで失敗することはありません。

### 実装サンプル (TypeScript / Node.js)

`@duckdb/node-api` を用いて、必ず **`access_mode: 'READ_ONLY'`** オプションを明示して接続してください。

```typescript
import { DuckDBInstance } from '@duckdb/node-api';
import { resolve } from 'path';

async function queryStockData() {
  const dbPath = resolve('path/to/stock-data/stock.duckdb');
  
  // 読み取り専用モードでインスタンスを作成
  const inst = await DuckDBInstance.create(dbPath, {
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
    // 接続の解除とインスタンスのクローズ
    conn.disconnectSync();
    inst.closeSync();
  }
}
```

*※注意: Linux環境下では、バッチ更新によってファイルがリネーム差し替えされた場合、接続中のプロセスは古いDBの実体を参照し続けます。最新のデータを反映させるためには、クエリを実行するたびに新しく接続を確立するか、定期的に再接続を行うように実装してください。*

---

## 5. 定期実行 (systemd)

本システムは、systemd のユーザーサービスおよびタイマー機能（`systemd --user`）を利用して、日次で自動実行することができます。

設定ファイルはリポジトリの [systemd/](file:///home/oharato/workspace/stock-data/systemd) ディレクトリ以下に格納されており、ユーザー設定ディレクトリとシンボリックリンクで紐付けることで動作します。

### セットアップ手順

1. **設定ファイルをユーザーの systemd ディレクトリへシンボリックリンク**
   ```bash
   mkdir -p ~/.config/systemd/user/
   ln -sf $(pwd)/systemd/stock-data.service ~/.config/systemd/user/stock-data.service
   ln -sf $(pwd)/systemd/stock-data.timer ~/.config/systemd/user/stock-data.timer
   ```

2. **systemd デーモンの再読み込みとタイマーの有効化・起動**
   ```bash
   systemctl --user daemon-reload
   systemctl --user enable --now stock-data.timer
   ```

3. **(推奨) ログアウト中も実行を継続させる設定**
   デフォルトでは、ユーザーがログインしている間のみタイマーが動作します。ログアウト中も常時稼働させるため、ユーザーの「Linger (常駐)」を有効化してください。
   ```bash
   loginctl enable-linger $(whoami)
   ```

### 管理・デバッグコマンド

* **タイマーの稼働状態・次回実行予定の確認:**
  ```bash
  systemctl --user status stock-data.timer
  ```
* **手動での即時テスト実行:**
  ```bash
  systemctl --user start stock-data.service
  ```
* **実行ログの確認 (リアルタイム追跡):**
  標準出力および標準エラー出力は、リポジトリ内の `logs/systemd.log` に自動的に保存（追記）されます。
  * **ログファイルの確認:**
    ```bash
    tail -f logs/systemd.log
    ```
  * **systemd ログ (journald) での確認:**
    ```bash
    journalctl --user -u stock-data.service -f
    ```

---

## 6. MCP (Model Context Protocol) を用いたデータ分析

AIアシスタント（Cursor、Claude Desktop、Clineなど）から本プロジェクトの DuckDB に直接アクセスして自然言語で分析できるようにするための、MCP設定手順です。Node.js製の `mcp-duckdb-local` を使用します。

### ① ローカル環境での接続設定
同一PC上のAIクライアントから接続する場合、クライアントのMCP設定ファイル（`mcp.json` や `mcp_config.json`）に以下を追加します。

```json
{
  "mcpServers": {
    "duckdb-local": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-duckdb-local",
        "--db-path",
        "/home/oharato/workspace/stock-data/stock.duckdb"
      ]
    }
  }
}
```

### ② 別PC（リモート）から SSH 経由での接続設定
別のPCからネットワーク経由（SSH経由の標準入出力）で本PCの DuckDB に接続し、安全に分析を実行する場合の設定です。

#### 1. 前提条件
*   クライアント側（別PC）からサーバー側（本PC）へ、**パスワード入力なし（SSH公開鍵認証）**でSSHログインできる状態にしておいてください。

#### 2. クライアント側（別PC）の設定ファイル (`mcp.json`)

特にサーバー側で **NVM (Node Version Manager)** を使って Node.js を管理している場合、SSH経由の非インタラクティブセッションでは `node`/`npx` へのパスが失われるため、以下のように `PATH` を明示的に export し、絶対パスで指定する必要があります。

```json
{
  "mcpServers": {
    "duckdb-remote-ssh": {
      "type": "stdio",
      "command": "ssh",
      "args": [
        "oharato@nuc7.local",
        "export PATH=/home/oharato/.nvm/versions/node/v24.13.0/bin:$PATH && /home/oharato/.nvm/versions/node/v24.13.0/bin/npx -y mcp-duckdb-local --db-path /home/oharato/workspace/stock-data/stock.duckdb --read-write"
      ]
    }
  }
}
```

*   **`export PATH=... && <npxの絶対パス> ...`**: NVM環境下で `npx` や `node` のコマンドが見つからない問題（Command not found）を回避するための設定です。
*   **`--read-write`**: 必要に応じて書き込み権限を有効にするオプションです。


