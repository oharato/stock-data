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
