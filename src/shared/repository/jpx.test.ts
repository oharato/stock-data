// src/repository/jpx.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('xlsx', () => ({
  read: vi.fn(),
  utils: {
    sheet_to_json: vi.fn(),
  },
}));

import * as XLSX from 'xlsx';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchJpxTickers', () => {
  it('downloads and parses tickers', async () => {
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

    const { fetchJpxTickers } = await import('./jpx.js');
    const result = await fetchJpxTickers();

    expect(result).toHaveLength(2);
    expect(result[0].code).toBe('7203.T');
    expect(result[1].code).toBe('1234.T');
  });

  it('throws on HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }));

    const { fetchJpxTickers } = await import('./jpx.js');
    await expect(fetchJpxTickers()).rejects.toThrow('HTTP 404');
  });
});
