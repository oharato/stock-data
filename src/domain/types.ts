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
