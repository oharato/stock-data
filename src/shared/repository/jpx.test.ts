// src/repository/jpx.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { existsSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('xlsx', () => ({
  read: vi.fn(),
  utils: {
    sheet_to_json: vi.fn(),
  },
}));

import * as XLSX from 'xlsx';

const outputPath = join(tmpdir(), `jpx-test-${process.pid}-${Date.now()}.json`);

afterEach(() => {
  vi.restoreAllMocks();
  if (existsSync(outputPath)) rmSync(outputPath);
});

describe('fetchAndSaveTickers', () => {
  it('downloads, parses and saves tickers to JSON', async () => {
    const mockRows = [
      ['日付', 'コード', '銘柄名', '市場・商品区分'],
      [20260531, 7203, 'トヨタ自動車', 'プライム（内国株式）'],
      [20260531, 1234, 'テスト銘柄', 'スタンダード（内国株式）'],
    ];

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    }));

    vi.mocked(XLSX.read).mockReturnValue({
      SheetNames: ['Sheet1'],
      Sheets: { Sheet1: {} },
    } as any);

    vi.mocked(XLSX.utils.sheet_to_json).mockReturnValue(mockRows as any);

    const { fetchAndSaveTickers } = await import('./jpx.js');
    const result = await fetchAndSaveTickers(outputPath);

    expect(result).toHaveLength(2);
    expect(result[0].code).toBe('7203.T');
    expect(result[1].code).toBe('1234.T');
    expect(existsSync(outputPath)).toBe(true);

    const saved = JSON.parse(readFileSync(outputPath, 'utf-8'));
    expect(saved).toHaveLength(2);
  });

  it('throws on HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }));

    const { fetchAndSaveTickers } = await import('./jpx.js');
    await expect(fetchAndSaveTickers(outputPath)).rejects.toThrow('HTTP 404');
  });
});
