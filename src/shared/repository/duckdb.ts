// src/repository/duckdb.ts
export { buildDuckDb } from './duckdb/admin.js';
export { closeCachedDbConnections } from './duckdb/connection.js';
export {
  readDbMaxDate,
  fetchDailyPrices,
  fetchWeeklyPrices,
  fetchMonthlyPrices,
} from './duckdb/queries.js';
export type { StockPriceRow } from './duckdb/queries.js';
