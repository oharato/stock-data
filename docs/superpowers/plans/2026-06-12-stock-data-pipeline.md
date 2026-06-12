# 日本株データパイプライン 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** yahoo-finance2でJPX上場全銘柄の日足データ（2000年〜）を取得し、月別Parquetに保存、DuckDBで統合クエリ可能にする。差分更新は毎回tickers.jsonを最新化してから差分株価を取得する。

**Architecture:** `domain`（型定義） / `logic`（純粋関数・テスト容易） / `repository`（I/O）の3層構造。エントリーポイントスクリプトがこれらを組み合わせる。Parquet書き込みはDuckDBのCOPY TO経由（一時CSV使用）。

**Tech Stack:** TypeScript (NodeNext ESM), tsx, yahoo-finance2, duckdb-async, xlsx, p-limit, vitest

---

## ファイルマップ

| ファイル | 責務 |
|---------|------|
| `src/domain/types.ts` | `Ticker` `PriceRecord` `ErrorRecord` 型定義 |
| `src/logic/date-utils.ts` | 純粋な日付関数（getMonthKey, addDay, etc.） |
| `src/logic/ticker-parser.ts` | JPX Excelの行配列 → `Ticker[]` 変換 |
| `src/logic/price-mapper.ts` | yahoo-finance2の行 → `PriceRecord` 変換 |
| `src/logic/update-logic.ts` | `calcFetchRange`, `mergeRecords` |
| `src/repository/jpx.ts` | JPX ExcelダウンロードI/O |
| `src/repository/yahoo.ts` | yahoo-finance2 API呼び出しI/O |
| `src/repository/parquet.ts` | Parquet読み書き（DuckDB経由） |
| `src/repository/duckdb.ts` | stock.duckdb構築 |
| `src/fetch-tickers.ts` | エントリーポイント: tickers.json生成 |
| `src/fetch-initial.ts` | エントリーポイント: 初回一括取得 |
| `src/fetch-update.ts` | エントリーポイント: 毎日差分更新 |
| `src/build-duckdb.ts` | エントリーポイント: DuckDB再構築 |

---

### Task 1: プロジェクトセットアップ

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`

- [ ] **Step 1: package.jsonを作成する**

```json
{
  "name": "stock-data",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "fetch-tickers": "tsx src/fetch-tickers.ts",
    "fetch-initial": "tsx src/fetch-initial.ts",
    "fetch-update": "tsx src/fetch-update.ts",
    "build-duckdb": "tsx src/build-duckdb.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "duckdb-async": "^0.10.3",
    "p-limit": "^6.2.0",
    "yahoo-finance2": "^2.13.3",
    "xlsx": "^0.18.5"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.3",
    "typescript": "^5.7.3",
    "vitest": "^3.2.3"
  }
}
```

- [ ] **Step 2: tsconfig.jsonを作成する**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: 依存パッケージをインストールし .gitignore を作成する**

```bash
npm install
git init
cat > .gitignore << 'EOF'
node_modules/
data/
stock.duckdb
errors.json
tickers.json
*.duckdb
EOF
```

Expected: `node_modules/` と `package-lock.json` が生成される

- [ ] **Step 4: コミットする**

```bash
git add package.json tsconfig.json .gitignore
git commit -m "chore: project setup"
```

---

### Task 2: Domain — 型定義

**Files:**
- Create: `src/domain/types.ts`

- [ ] **Step 1: src/domain/types.tsを作成する**

```typescript
// src/domain/types.ts
export interface Ticker {
  code: string;   // e.g. "7203.T"
  name: string;   // e.g. "トヨタ自動車"
  market: string; // e.g. "プライム（内国株式）"
}

export interface PriceRecord {
  date: string;      // ISO format: "2024-01-04"
  ticker: string;    // e.g. "7203.T"
  open: number;
  high: number;
  low: number;
  close: number;
  adj_close: number;
  volume: number;
}

export interface ErrorRecord {
  ticker: string;
  period: string;  // e.g. "2024" or "2024-06-01~2024-06-12"
  reason: string;
}
```

- [ ] **Step 2: コミットする**

```bash
git add src/domain/types.ts
git commit -m "feat: add domain types"
```

---

### Task 3: Logic — 日付ユーティリティ

**Files:**
- Create: `src/logic/date-utils.ts`
- Create: `src/logic/date-utils.test.ts`

- [ ] **Step 1: テストを書く**

```typescript
// src/logic/date-utils.test.ts
import { describe, it, expect } from 'vitest';
import {
  getMonthKey,
  monthParquetPath,
  addDay,
  isWeekend,
} from './date-utils.js';

describe('getMonthKey', () => {
  it('extracts YYYY-MM from ISO date string', () => {
    expect(getMonthKey('2024-01-04')).toBe('2024-01');
    expect(getMonthKey('2024-12-31')).toBe('2024-12');
  });
});

describe('monthParquetPath', () => {
  it('returns correctly formatted path with zero-padded month', () => {
    expect(monthParquetPath(2024, 6)).toBe('data/prices/2024/06.parquet');
    expect(monthParquetPath(2024, 12)).toBe('data/prices/2024/12.parquet');
  });
});

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

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npx vitest run src/logic/date-utils.test.ts
```

Expected: FAIL — "Cannot find module './date-utils.js'"

- [ ] **Step 3: src/logic/date-utils.tsを実装する**

```typescript
// src/logic/date-utils.ts
import { join } from 'path';

export function getMonthKey(dateStr: string): string {
  return dateStr.substring(0, 7); // "2024-01-04" → "2024-01"
}

export function monthParquetPath(year: number, month: number): string {
  return join('data', 'prices', String(year), `${String(month).padStart(2, '0')}.parquet`);
}

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

- [ ] **Step 4: テストが通ることを確認する**

```bash
npx vitest run src/logic/date-utils.test.ts
```

Expected: All 7 tests PASS

- [ ] **Step 5: コミットする**

```bash
git add src/logic/date-utils.ts src/logic/date-utils.test.ts
git commit -m "feat: add date utilities"
```

---

### Task 4: Logic — ティッカーパーサー

**Files:**
- Create: `src/logic/ticker-parser.ts`
- Create: `src/logic/ticker-parser.test.ts`

JPX Excelの行配列をTickerに変換する純粋関数。
実際のExcelヘッダー: `["日付","コード","銘柄名","市場・商品区分","33業種コード","33業種区分","17業種コード","17業種区分","規模コード","規模区分"]`

- [ ] **Step 1: テストを書く**

```typescript
// src/logic/ticker-parser.test.ts
import { describe, it, expect } from 'vitest';
import { parseJpxRows } from './ticker-parser.js';

describe('parseJpxRows', () => {
  it('converts numeric code to yfinance ticker format with .T suffix', () => {
    const rows = [
      ['日付', 'コード', '銘柄名', '市場・商品区分', '33業種コード', '33業種区分', '17業種コード', '17業種区分', '規模コード', '規模区分'],
      [20260531, 7203, 'トヨタ自動車', 'プライム（内国株式）', 25, '輸送用機器', 4, '自動車・輸送機', 2, 'TOPIX Large70'],
    ];
    expect(parseJpxRows(rows)).toEqual([
      { code: '7203.T', name: 'トヨタ自動車', market: 'プライム（内国株式）' },
    ]);
  });

  it('pads 4-digit codes with leading zeros', () => {
    const rows = [
      ['日付', 'コード', '銘柄名', '市場・商品区分'],
      [20260531, 1301, '極洋', 'プライム（内国株式）'],
    ];
    expect(parseJpxRows(rows)[0].code).toBe('1301.T');
  });

  it('filters out ETF/ETN rows', () => {
    const rows = [
      ['日付', 'コード', '銘柄名', '市場・商品区分'],
      [20260531, 1305, 'ｉＦｒｅｅＥＴＦ　ＴＯＰＩＸ', 'ETF・ETN'],
    ];
    expect(parseJpxRows(rows)).toHaveLength(0);
  });

  it('skips the header row', () => {
    const rows = [['日付', 'コード', '銘柄名', '市場・商品区分']];
    expect(parseJpxRows(rows)).toHaveLength(0);
  });

  it('includes プライム、スタンダード、グロース, excludes ETF', () => {
    const rows = [
      ['日付', 'コード', '銘柄名', '市場・商品区分'],
      [20260531, 7203, 'A', 'プライム（内国株式）'],
      [20260531, 1234, 'B', 'スタンダード（内国株式）'],
      [20260531, 5678, 'C', 'グロース（内国株式）'],
      [20260531, 9012, 'D', 'ETF・ETN'],
    ];
    expect(parseJpxRows(rows)).toHaveLength(3);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npx vitest run src/logic/ticker-parser.test.ts
```

Expected: FAIL — "Cannot find module './ticker-parser.js'"

- [ ] **Step 3: src/logic/ticker-parser.tsを実装する**

```typescript
// src/logic/ticker-parser.ts
import type { Ticker } from '../domain/types.js';

export function parseJpxRows(rows: any[][]): Ticker[] {
  return rows
    .slice(1) // skip header row
    .filter(row => {
      const code = row[1];
      const market = String(row[3] ?? '');
      return (
        typeof code === 'number' &&
        code >= 1000 &&
        code <= 9999 &&
        market.includes('内国株式')
      );
    })
    .map(row => ({
      code: `${String(Math.floor(row[1])).padStart(4, '0')}.T`,
      name: String(row[2] ?? ''),
      market: String(row[3] ?? ''),
    }));
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
npx vitest run src/logic/ticker-parser.test.ts
```

Expected: All 5 tests PASS

- [ ] **Step 5: コミットする**

```bash
git add src/logic/ticker-parser.ts src/logic/ticker-parser.test.ts
git commit -m "feat: add ticker parser"
```

---

### Task 5: Logic — 価格マッパー

**Files:**
- Create: `src/logic/price-mapper.ts`
- Create: `src/logic/price-mapper.test.ts`

- [ ] **Step 1: テストを書く**

```typescript
// src/logic/price-mapper.test.ts
import { describe, it, expect } from 'vitest';
import { mapRow } from './price-mapper.js';

describe('mapRow', () => {
  it('maps yahoo-finance2 row to PriceRecord', () => {
    const row = {
      date: new Date('2024-01-04T00:00:00Z'),
      open: 2500, high: 2550, low: 2490, close: 2530,
      adjClose: 2530, volume: 1000000,
    };
    expect(mapRow(row, '7203.T')).toEqual({
      date: '2024-01-04',
      ticker: '7203.T',
      open: 2500, high: 2550, low: 2490, close: 2530,
      adj_close: 2530, volume: 1000000,
    });
  });

  it('falls back to close when adjClose is null', () => {
    const row = { date: new Date('2024-01-04T00:00:00Z'), open: 100, high: 110, low: 95, close: 105, adjClose: null, volume: 500 };
    expect(mapRow(row, '1234.T').adj_close).toBe(105);
  });

  it('defaults numeric fields to 0 when undefined', () => {
    const row = { date: new Date('2024-01-04T00:00:00Z'), open: undefined, high: undefined, low: undefined, close: undefined, adjClose: undefined, volume: undefined };
    const result = mapRow(row, '1234.T');
    expect(result.open).toBe(0);
    expect(result.adj_close).toBe(0);
    expect(result.volume).toBe(0);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npx vitest run src/logic/price-mapper.test.ts
```

Expected: FAIL — "Cannot find module './price-mapper.js'"

- [ ] **Step 3: src/logic/price-mapper.tsを実装する**

```typescript
// src/logic/price-mapper.ts
import type { PriceRecord } from '../domain/types.js';

export function mapRow(row: any, ticker: string): PriceRecord {
  return {
    date: (row.date as Date).toISOString().split('T')[0],
    ticker,
    open: row.open ?? 0,
    high: row.high ?? 0,
    low: row.low ?? 0,
    close: row.close ?? 0,
    adj_close: row.adjClose ?? row.close ?? 0,
    volume: row.volume ?? 0,
  };
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
npx vitest run src/logic/price-mapper.test.ts
```

Expected: All 3 tests PASS

- [ ] **Step 5: コミットする**

```bash
git add src/logic/price-mapper.ts src/logic/price-mapper.test.ts
git commit -m "feat: add price mapper"
```

---

### Task 6: Logic — 更新ロジック

**Files:**
- Create: `src/logic/update-logic.ts`
- Create: `src/logic/update-logic.test.ts`

- [ ] **Step 1: テストを書く**

```typescript
// src/logic/update-logic.test.ts
import { describe, it, expect } from 'vitest';
import { calcFetchRange, mergeRecords } from './update-logic.js';
import type { PriceRecord } from '../domain/types.js';

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

describe('mergeRecords', () => {
  const existing: PriceRecord[] = [
    { date: '2024-06-10', ticker: '7203.T', open: 2500, high: 2550, low: 2490, close: 2530, adj_close: 2530, volume: 1000000 },
  ];
  const incoming: PriceRecord[] = [
    { date: '2024-06-11', ticker: '7203.T', open: 2530, high: 2560, low: 2510, close: 2540, adj_close: 2540, volume: 900000 },
    // duplicate — should be dropped
    { date: '2024-06-10', ticker: '7203.T', open: 2500, high: 2550, low: 2490, close: 2530, adj_close: 2530, volume: 1000000 },
  ];

  it('deduplicates by date+ticker and sorts by date then ticker', () => {
    const result = mergeRecords(existing, incoming);
    expect(result).toHaveLength(2);
    expect(result[0].date).toBe('2024-06-10');
    expect(result[1].date).toBe('2024-06-11');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npx vitest run src/logic/update-logic.test.ts
```

Expected: FAIL — "Cannot find module './update-logic.js'"

- [ ] **Step 3: src/logic/update-logic.tsを実装する**

```typescript
// src/logic/update-logic.ts
import type { PriceRecord } from '../domain/types.js';
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

export function mergeRecords(existing: PriceRecord[], incoming: PriceRecord[]): PriceRecord[] {
  const seen = new Set(existing.map(r => `${r.date}:${r.ticker}`));
  const merged = [
    ...existing,
    ...incoming.filter(r => !seen.has(`${r.date}:${r.ticker}`)),
  ];
  return merged.sort(
    (a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker)
  );
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
npx vitest run src/logic/update-logic.test.ts
```

Expected: All 5 tests PASS

- [ ] **Step 5: コミットする**

```bash
git add src/logic/update-logic.ts src/logic/update-logic.test.ts
git commit -m "feat: add update logic"
```

---

### Task 7: Repository — JPX (jpx.ts)

**Files:**
- Create: `src/repository/jpx.ts`

JPX ExcelのダウンロードとtoParsedTickers()呼び出しのI/Oラッパー。

- [ ] **Step 1: src/repository/jpx.tsを作成する**

```typescript
// src/repository/jpx.ts
import { writeFileSync } from 'fs';
import * as XLSX from 'xlsx';
import { parseJpxRows } from '../logic/ticker-parser.js';
import type { Ticker } from '../domain/types.js';

const JPX_URL =
  'https://www.jpx.co.jp/markets/statistics-equities/misc/tvdivq0000001vg2-att/data_j.xls';

export async function fetchAndSaveTickers(outputPath = 'tickers.json'): Promise<Ticker[]> {
  console.log('Downloading JPX ticker list...');
  const res = await fetch(JPX_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${JPX_URL}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];

  const tickers = parseJpxRows(rows);
  writeFileSync(outputPath, JSON.stringify(tickers, null, 2));
  console.log(`Saved ${tickers.length} tickers to ${outputPath}`);
  return tickers;
}
```

- [ ] **Step 2: コミットする**

```bash
git add src/repository/jpx.ts
git commit -m "feat: add JPX repository"
```

---

### Task 8: Repository — Yahoo Finance (yahoo.ts)

**Files:**
- Create: `src/repository/yahoo.ts`
- Create: `src/repository/yahoo.test.ts`

- [ ] **Step 1: テストを書く**

```typescript
// src/repository/yahoo.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchTickerYear, fetchTickerRange } from './yahoo.js';

vi.mock('yahoo-finance2', () => ({
  default: {
    setGlobalConfig: vi.fn(),
    historical: vi.fn(),
  },
}));

import yahooFinance from 'yahoo-finance2';

beforeEach(() => vi.clearAllMocks());

describe('fetchTickerYear', () => {
  it('maps historical rows to PriceRecord format', async () => {
    vi.mocked(yahooFinance.historical).mockResolvedValue([
      { date: new Date('2024-01-04T00:00:00Z'), open: 2500, high: 2550, low: 2490, close: 2530, adjClose: 2530, volume: 1000000 },
    ] as any);

    const result = await fetchTickerYear('7203.T', 2024);
    expect(result).toEqual([{
      date: '2024-01-04', ticker: '7203.T',
      open: 2500, high: 2550, low: 2490, close: 2530, adj_close: 2530, volume: 1000000,
    }]);
  });

  it('returns empty array when no data', async () => {
    vi.mocked(yahooFinance.historical).mockResolvedValue([]);
    expect(await fetchTickerYear('9999.T', 1999)).toEqual([]);
  });

  it('throws descriptive error on failure', async () => {
    vi.mocked(yahooFinance.historical).mockRejectedValue(new Error('Not Found'));
    await expect(fetchTickerYear('7203.T', 2024)).rejects.toThrow('Failed to fetch 7203.T for 2024');
  });
});

describe('fetchTickerRange', () => {
  it('fetches data for a specific date range', async () => {
    vi.mocked(yahooFinance.historical).mockResolvedValue([
      { date: new Date('2024-06-10T00:00:00Z'), open: 100, high: 110, low: 95, close: 105, adjClose: 105, volume: 100 },
    ] as any);

    const result = await fetchTickerRange('7203.T', '2024-06-01', '2024-06-12');
    expect(result[0].date).toBe('2024-06-10');
  });

  it('throws descriptive error on failure', async () => {
    vi.mocked(yahooFinance.historical).mockRejectedValue(new Error('timeout'));
    await expect(fetchTickerRange('7203.T', '2024-06-01', '2024-06-12'))
      .rejects.toThrow('Failed to fetch 7203.T [2024-06-01~2024-06-12]');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npx vitest run src/repository/yahoo.test.ts
```

Expected: FAIL — "Cannot find module './yahoo.js'"

- [ ] **Step 3: src/repository/yahoo.tsを実装する**

```typescript
// src/repository/yahoo.ts
import yahooFinance from 'yahoo-finance2';
import { mapRow } from '../logic/price-mapper.js';
import type { PriceRecord } from '../domain/types.js';

yahooFinance.setGlobalConfig({ validation: { logErrors: false } });

export async function fetchTickerYear(ticker: string, year: number): Promise<PriceRecord[]> {
  try {
    const rows = await yahooFinance.historical(ticker, {
      period1: `${year}-01-01`,
      period2: `${year}-12-31`,
      interval: '1d',
    });
    return rows.map(row => mapRow(row, ticker));
  } catch (err) {
    throw new Error(`Failed to fetch ${ticker} for ${year}: ${err}`);
  }
}

export async function fetchTickerRange(
  ticker: string,
  period1: string,
  period2: string
): Promise<PriceRecord[]> {
  try {
    const rows = await yahooFinance.historical(ticker, { period1, period2, interval: '1d' });
    return rows.map(row => mapRow(row, ticker));
  } catch (err) {
    throw new Error(`Failed to fetch ${ticker} [${period1}~${period2}]: ${err}`);
  }
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
npx vitest run src/repository/yahoo.test.ts
```

Expected: All 5 tests PASS

- [ ] **Step 5: コミットする**

```bash
git add src/repository/yahoo.ts src/repository/yahoo.test.ts
git commit -m "feat: add Yahoo Finance repository"
```

---

### Task 9: Repository — Parquet (parquet.ts)

**Files:**
- Create: `src/repository/parquet.ts`
- Create: `src/repository/parquet.test.ts`

DuckDBの`COPY TO`でParquetを書き込み、`read_parquet()`で読み込む。一時CSVファイル経由でDuckDBに渡す。

- [ ] **Step 1: テストを書く**

```typescript
// src/repository/parquet.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { writeParquet, readParquetMaxDate, readParquet } from './parquet.js';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const testPath = join(tmpdir(), `test-parquet-${process.pid}-${Date.now()}.parquet`);

afterEach(() => {
  if (existsSync(testPath)) rmSync(testPath);
});

const records = [
  { date: '2024-01-04', ticker: '7203.T', open: 2500, high: 2550, low: 2490, close: 2530, adj_close: 2530, volume: 1000000 },
  { date: '2024-01-05', ticker: '7203.T', open: 2530, high: 2560, low: 2510, close: 2540, adj_close: 2540, volume: 900000 },
];

describe('writeParquet + readParquetMaxDate', () => {
  it('writes parquet and reads correct max date', async () => {
    await writeParquet(testPath, records);
    expect(existsSync(testPath)).toBe(true);
    expect(await readParquetMaxDate(testPath)).toBe('2024-01-05');
  });

  it('does nothing when records array is empty', async () => {
    await writeParquet(testPath, []);
    expect(existsSync(testPath)).toBe(false);
  });
});

describe('readParquet', () => {
  it('reads all rows back from a written file', async () => {
    await writeParquet(testPath, records);
    const result = await readParquet(testPath);
    expect(result).toHaveLength(2);
    expect(result[0].ticker).toBe('7203.T');
    expect(Number(result[1].volume)).toBe(900000);
  });

  it('returns empty array for a non-existent file', async () => {
    expect(await readParquet('/nonexistent/path.parquet')).toEqual([]);
  });
});

describe('readParquetMaxDate', () => {
  it('returns null for a non-existent file', async () => {
    expect(await readParquetMaxDate('/nonexistent/path.parquet')).toBeNull();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npx vitest run src/repository/parquet.test.ts
```

Expected: FAIL — "Cannot find module './parquet.js'"

- [ ] **Step 3: src/repository/parquet.tsを実装する**

`duckdb-async`ではなく`@duckdb/node-api`を使用すること。APIパターン:
- `const inst = await DuckDBInstance.create(':memory:')`
- `const conn = await inst.connect()`
- `await conn.run(sql)` / `await conn.runAndReadAll(sql)`
- `result.getRowObjects()` でrow配列取得
- `conn.disconnectSync(); inst.closeSync()` でクローズ

```typescript
// src/repository/parquet.ts
import { DuckDBInstance } from '@duckdb/node-api';
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { tmpdir } from 'os';
import type { PriceRecord } from '../domain/types.js';

export async function writeParquet(outputPath: string, records: PriceRecord[]): Promise<void> {
  if (records.length === 0) return;

  const absOutput = resolve(outputPath);
  mkdirSync(dirname(absOutput), { recursive: true });

  const tempCsv = join(tmpdir(), `stock-${process.pid}-${Date.now()}.csv`);
  const header = 'date,ticker,open,high,low,close,adj_close,volume';
  const lines = records.map(
    r => `${r.date},${r.ticker},${r.open},${r.high},${r.low},${r.close},${r.adj_close},${r.volume}`
  );
  writeFileSync(tempCsv, `${header}\n${lines.join('\n')}`);

  const inst = await DuckDBInstance.create(':memory:');
  const conn = await inst.connect();
  try {
    await conn.run(`
      COPY (
        SELECT * FROM read_csv('${tempCsv}', header=true, columns={
          'date': 'DATE', 'ticker': 'VARCHAR',
          'open': 'DOUBLE', 'high': 'DOUBLE', 'low': 'DOUBLE',
          'close': 'DOUBLE', 'adj_close': 'DOUBLE', 'volume': 'BIGINT'
        })
      ) TO '${absOutput}' (FORMAT PARQUET, COMPRESSION ZSTD)
    `);
  } finally {
    conn.disconnectSync();
    inst.closeSync();
    unlinkSync(tempCsv);
  }
}

export async function readParquetMaxDate(parquetPath: string): Promise<string | null> {
  const absPath = resolve(parquetPath);
  if (!existsSync(absPath)) return null;
  const inst = await DuckDBInstance.create(':memory:');
  const conn = await inst.connect();
  try {
    const result = await conn.runAndReadAll(
      `SELECT max(date)::VARCHAR AS max_date FROM read_parquet('${absPath}')`
    );
    const rows = result.getRowObjects();
    return (rows[0] as any)?.max_date ?? null;
  } finally {
    conn.disconnectSync();
    inst.closeSync();
  }
}

export async function readParquet(parquetPath: string): Promise<PriceRecord[]> {
  const absPath = resolve(parquetPath);
  if (!existsSync(absPath)) return [];
  const inst = await DuckDBInstance.create(':memory:');
  const conn = await inst.connect();
  try {
    const result = await conn.runAndReadAll(`SELECT * FROM read_parquet('${absPath}')`);
    return result.getRowObjects() as unknown as PriceRecord[];
  } finally {
    conn.disconnectSync();
    inst.closeSync();
  }
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
npx vitest run src/repository/parquet.test.ts
```

Expected: All 5 tests PASS

- [ ] **Step 5: コミットする**

```bash
git add src/repository/parquet.ts src/repository/parquet.test.ts
git commit -m "feat: add parquet repository"
```

---

### Task 10: Repository — DuckDB (duckdb.ts)

**Files:**
- Create: `src/repository/duckdb.ts`
- Create: `src/repository/duckdb.test.ts`

- [ ] **Step 1: テストを書く**

```typescript
// src/repository/duckdb.test.ts
import { describe, it, expect, afterAll } from 'vitest';
import { buildDuckDb } from './duckdb.js';
import { writeParquet } from './parquet.js';
import { DuckDBInstance } from '@duckdb/node-api';
import { join } from 'path';
import { tmpdir } from 'os';
import { rmSync, existsSync, mkdirSync } from 'fs';

const testBase = join(tmpdir(), `duckdb-test-${process.pid}-${Date.now()}`);
const testDbPath = join(testBase, 'test.duckdb');

afterAll(() => {
  if (existsSync(testBase)) rmSync(testBase, { recursive: true });
});

describe('buildDuckDb', () => {
  it('creates prices table from monthly parquet files', async () => {
    const parquetDir = join(testBase, 'prices', '2024');
    mkdirSync(parquetDir, { recursive: true });
    await writeParquet(join(parquetDir, '01.parquet'), [
      { date: '2024-01-04', ticker: '7203.T', open: 2500, high: 2550, low: 2490, close: 2530, adj_close: 2530, volume: 1000000 },
      { date: '2024-01-04', ticker: '1234.T', open: 1000, high: 1010, low: 990, close: 1005, adj_close: 1005, volume: 50000 },
    ]);

    const parquetGlob = join(testBase, 'prices', '*', '*.parquet');
    await buildDuckDb(parquetGlob, testDbPath);

    const inst = await DuckDBInstance.create(testDbPath);
    const conn = await inst.connect();
    const countResult = await conn.runAndReadAll('SELECT COUNT(*) AS cnt FROM prices');
    const tickerResult = await conn.runAndReadAll('SELECT DISTINCT ticker FROM prices ORDER BY ticker');
    conn.disconnectSync();
    inst.closeSync();

    const countRows = countResult.getRowObjects();
    const tickerRows = tickerResult.getRowObjects();

    expect(Number((countRows[0] as any).cnt)).toBe(2);
    expect(tickerRows.map((r: any) => r.ticker)).toEqual(['1234.T', '7203.T']);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npx vitest run src/repository/duckdb.test.ts
```

Expected: FAIL — "Cannot find module './duckdb.js'"

- [ ] **Step 3: src/repository/duckdb.tsを実装する**

`duckdb-async`ではなく`@duckdb/node-api`を使用すること。

```typescript
// src/repository/duckdb.ts
import { DuckDBInstance } from '@duckdb/node-api';
import { resolve } from 'path';

export async function buildDuckDb(
  parquetGlob: string = 'data/prices/*/*.parquet',
  dbPath: string = 'stock.duckdb'
): Promise<void> {
  const absGlob = resolve(parquetGlob).replace(/\\/g, '/');
  const absDb = resolve(dbPath);

  const inst = await DuckDBInstance.create(absDb);
  const conn = await inst.connect();
  try {
    await conn.run(`
      CREATE OR REPLACE TABLE prices AS
      SELECT * FROM read_parquet('${absGlob}')
      ORDER BY date, ticker
    `);
    const result = await conn.runAndReadAll('SELECT COUNT(*) AS cnt FROM prices');
    const rows = result.getRowObjects();
    console.log(`stock.duckdb built: ${Number((rows[0] as any).cnt)} rows in prices table`);
  } finally {
    conn.disconnectSync();
    inst.closeSync();
  }
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
npx vitest run src/repository/duckdb.test.ts
```

Expected: PASS

- [ ] **Step 5: コミットする**

```bash
git add src/repository/duckdb.ts src/repository/duckdb.test.ts
git commit -m "feat: add duckdb repository"
```

---

### Task 11: エントリーポイント — fetch-tickers.ts

**Files:**
- Create: `src/fetch-tickers.ts`

- [ ] **Step 1: src/fetch-tickers.tsを作成する**

```typescript
// src/fetch-tickers.ts
import { fetchAndSaveTickers } from './repository/jpx.js';

fetchAndSaveTickers().catch(console.error);
```

- [ ] **Step 2: 動作確認する**

```bash
npm run fetch-tickers
```

Expected:
```
Downloading JPX ticker list...
Saved XXXX tickers to tickers.json
```

`tickers.json` の先頭数行を確認:
```bash
head -10 tickers.json
```

Expected: `[{"code":"1301.T","name":"極洋","market":"プライム（内国株式）"}, ...]` のようなJSON

- [ ] **Step 3: コミットする**

```bash
git add src/fetch-tickers.ts
git commit -m "feat: add fetch-tickers entry point"
```

---

### Task 12: エントリーポイント — fetch-initial.ts

**Files:**
- Create: `src/fetch-initial.ts`

年単位ループ、スキップ対応、進捗表示。

- [ ] **Step 1: src/fetch-initial.tsを作成する**

```typescript
// src/fetch-initial.ts
import { readFileSync, writeFileSync, existsSync } from 'fs';
import pLimit from 'p-limit';
import type { Ticker, PriceRecord, ErrorRecord } from './domain/types.js';
import { fetchTickerYear } from './repository/yahoo.js';
import { writeParquet } from './repository/parquet.js';
import { getMonthKey, monthParquetPath } from './logic/date-utils.js';

const CONCURRENCY = 10;
const START_YEAR = 2000;

async function main() {
  if (!existsSync('tickers.json')) {
    console.error('tickers.json not found. Run: npm run fetch-tickers');
    process.exit(1);
  }

  const tickers: Ticker[] = JSON.parse(readFileSync('tickers.json', 'utf-8'));
  const errors: ErrorRecord[] = [];
  const currentYear = new Date().getFullYear();
  const limit = pLimit(CONCURRENCY);

  for (let year = START_YEAR; year <= currentYear; year++) {
    if (year < currentYear) {
      const allExist = Array.from({ length: 12 }, (_, i) => i + 1)
        .every(m => existsSync(monthParquetPath(year, m)));
      if (allExist) {
        console.log(`[${year}] All 12 months exist, skipping.`);
        continue;
      }
    }

    console.log(`\n[${year}] Fetching ${tickers.length} tickers (concurrency=${CONCURRENCY})...`);

    const monthData = new Map<string, PriceRecord[]>();
    let done = 0;

    await Promise.all(
      tickers.map(ticker =>
        limit(async () => {
          try {
            const records = await fetchTickerYear(ticker.code, year);
            for (const record of records) {
              const key = getMonthKey(record.date);
              if (!monthData.has(key)) monthData.set(key, []);
              monthData.get(key)!.push(record);
            }
          } catch (err) {
            errors.push({ ticker: ticker.code, period: String(year), reason: String(err) });
          }
          done++;
          if (done % 500 === 0 || done === tickers.length) {
            process.stdout.write(`\r  ${done}/${tickers.length}`);
          }
        })
      )
    );

    console.log('');

    for (const [monthKey, records] of monthData) {
      const [y, m] = monthKey.split('-');
      const outputPath = monthParquetPath(Number(y), Number(m));
      records.sort((a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker));
      await writeParquet(outputPath, records);
      console.log(`  Written: ${outputPath} (${records.length} rows)`);
    }
  }

  if (errors.length > 0) {
    writeFileSync('errors.json', JSON.stringify(errors, null, 2));
    console.log(`\n${errors.length} errors saved to errors.json`);
  }

  console.log('\nInitial fetch complete!');
}

main().catch(console.error);
```

- [ ] **Step 2: スモークテスト（1銘柄で動作確認）**

```bash
# tickers.jsonを1銘柄だけにして確認
cp tickers.json tickers.json.bak
echo '[{"code":"7203.T","name":"トヨタ自動車","market":"プライム（内国株式）"}]' > tickers.json
npm run fetch-initial
ls data/prices/2024/
```

Expected: `01.parquet 02.parquet ... 12.parquet` など年ごとにparquetファイルが生成される

```bash
# 元に戻す
cp tickers.json.bak tickers.json && rm tickers.json.bak
```

- [ ] **Step 3: コミットする**

```bash
git add src/fetch-initial.ts
git commit -m "feat: add fetch-initial entry point"
```

---

### Task 13: エントリーポイント — build-duckdb.ts

**Files:**
- Create: `src/build-duckdb.ts`

- [ ] **Step 1: src/build-duckdb.tsを作成する**

```typescript
// src/build-duckdb.ts
import { buildDuckDb } from './repository/duckdb.js';

buildDuckDb().catch(console.error);
```

- [ ] **Step 2: 動作確認する（fetch-initialのスモークテスト後に実行）**

```bash
npm run build-duckdb
```

Expected:
```
stock.duckdb built: XXXX rows in prices table
```

- [ ] **Step 3: コミットする**

```bash
git add src/build-duckdb.ts
git commit -m "feat: add build-duckdb entry point"
```

---

### Task 14: エントリーポイント — fetch-update.ts

**Files:**
- Create: `src/fetch-update.ts`

- [ ] **Step 1: src/fetch-update.tsを作成する**

```typescript
// src/fetch-update.ts
import { readFileSync, writeFileSync } from 'fs';
import pLimit from 'p-limit';
import type { Ticker, PriceRecord, ErrorRecord } from './domain/types.js';
import { fetchTickerRange } from './repository/yahoo.js';
import { writeParquet, readParquet, readParquetMaxDate } from './repository/parquet.js';
import { buildDuckDb } from './repository/duckdb.js';
import { fetchAndSaveTickers } from './repository/jpx.js';
import { today, getCurrentYearMonth, monthParquetPath } from './logic/date-utils.js';
import { calcFetchRange, mergeRecords } from './logic/update-logic.js';

const CONCURRENCY = 10;

async function main() {
  // Step 1: tickers.jsonを最新のJPXリストで更新（新規上場・上場廃止を反映）
  const tickers: Ticker[] = await fetchAndSaveTickers();

  // Step 2: 当月Parquetの最終取得日を確認
  const { year, month } = getCurrentYearMonth();
  const parquetPath = monthParquetPath(year, month);
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDate = await readParquetMaxDate(parquetPath);
  const todayStr = today();

  const range = calcFetchRange(lastDate, todayStr, monthStart);
  if (!range) {
    console.log(`Already up to date (last date: ${lastDate ?? 'none'}).`);
    return;
  }

  console.log(`Fetching ${range.period1} ~ ${range.period2} for ${tickers.length} tickers...`);

  // Step 3: 差分を取得
  const errors: ErrorRecord[] = [];
  const newRecords: PriceRecord[] = [];
  const limit = pLimit(CONCURRENCY);
  let done = 0;

  await Promise.all(
    tickers.map(ticker =>
      limit(async () => {
        try {
          const records = await fetchTickerRange(ticker.code, range.period1, range.period2);
          newRecords.push(...records);
        } catch (err) {
          errors.push({
            ticker: ticker.code,
            period: `${range.period1}~${range.period2}`,
            reason: String(err),
          });
        }
        done++;
        if (done % 500 === 0 || done === tickers.length) {
          process.stdout.write(`\r  ${done}/${tickers.length}`);
        }
      })
    )
  );
  console.log('');

  // Step 4: 当月Parquetを既存データとマージして上書き
  const existing = await readParquet(parquetPath);
  const merged = mergeRecords(existing, newRecords);
  await writeParquet(parquetPath, merged);
  console.log(`Updated ${parquetPath} (${merged.length} rows total)`);

  if (errors.length > 0) {
    writeFileSync('errors.json', JSON.stringify(errors, null, 2));
    console.log(`${errors.length} errors saved to errors.json`);
  }

  // Step 5: DuckDB再構築
  await buildDuckDb();
  console.log('Done!');
}

main().catch(console.error);
```

- [ ] **Step 2: 全テストを実行して確認する**

```bash
npx vitest run
```

Expected: All tests PASS

- [ ] **Step 3: コミットする**

```bash
git add src/fetch-update.ts
git commit -m "feat: add fetch-update entry point"
```

---

## 実行手順まとめ

```bash
# 初回セットアップ
npm run fetch-tickers          # tickers.json生成（〜3900銘柄）
npm run fetch-initial          # 月別Parquet生成（2000年〜現在、数時間）
npm run build-duckdb           # stock.duckdb構築

# 毎日の差分更新（cron等で自動実行）
npm run fetch-update           # tickers更新 + 当月Parquet差分 + DuckDB再構築
```

```bash
# DuckDBでのクエリ例
duckdb stock.duckdb
D SELECT * FROM prices WHERE ticker = '7203.T' ORDER BY date DESC LIMIT 5;
D SELECT count(*) FROM prices;
D SELECT min(date), max(date) FROM prices;
D SELECT ticker, count(*) FROM prices GROUP BY ticker ORDER BY 2 DESC LIMIT 10;
```
