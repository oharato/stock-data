import { DuckDBConnection } from '@duckdb/node-api';

// Simple SQL String Escaper
export function escapeSql(str: string): string {
  return str.replace(/'/g, "''");
}

export interface TickerFilters {
  sector: string;
  search: string;
}

export interface TickerQueryParams extends TickerFilters {
  sort: string;
  page: number;
  limit: number;
}

// 1. Fetch unique sectors list for filter select input
export async function getSectors(conn: DuckDBConnection): Promise<string[]> {
  const sectorRes = await conn.runAndReadAll(
    "SELECT DISTINCT sector33::VARCHAR AS sector FROM tickers WHERE sector33 IS NOT NULL AND sector33 != '' ORDER BY sector ASC"
  );
  return sectorRes.getRowObjects().map((r: any) => r.sector);
}

// Helper to build SQL WHERE filter clause
function buildWhereClause(filters: TickerFilters): string {
  let whereClauses: string[] = [];
  if (filters.sector) {
    whereClauses.push(`sector33 = '${escapeSql(filters.sector)}'`);
  }
  if (filters.search) {
    const escapedSearch = escapeSql(filters.search);
    whereClauses.push(`(code LIKE '%${escapedSearch}%' OR name LIKE '%${escapedSearch}%')`);
  }
  return whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
}

// Helper to build SQL ORDER BY clause
function buildOrderByClause(sort: string): string {
  let orderSql = 'ORDER BY code ASC';
  if (sort === 'market_cap_desc') {
    orderSql = 'ORDER BY market_cap DESC NULLS LAST, code ASC';
  } else if (sort === 'market_cap_asc') {
    orderSql = 'ORDER BY market_cap ASC NULLS LAST, code ASC';
  } else if (sort === 'ipo_date_desc') {
    orderSql = 'ORDER BY ipo_date DESC NULLS LAST, code ASC';
  } else if (sort === 'ipo_date_asc') {
    orderSql = 'ORDER BY ipo_date ASC NULLS LAST, code ASC';
  }
  return orderSql;
}

// 2. Fetch total count of filtered rows for pagination
export async function getTickersCount(
  conn: DuckDBConnection,
  filters: TickerFilters
): Promise<number> {
  const whereSql = buildWhereClause(filters);
  const countRes = await conn.runAndReadAll(`SELECT COUNT(*)::BIGINT AS count FROM tickers ${whereSql}`);
  return Number(countRes.getRowObjects()[0].count);
}

// 3. Fetch tickers for current page
export async function getTickers(
  conn: DuckDBConnection,
  params: TickerQueryParams
): Promise<any[]> {
  const whereSql = buildWhereClause(params);
  const orderSql = buildOrderByClause(params.sort);
  const offset = (params.page - 1) * params.limit;

  const tickersRes = await conn.runAndReadAll(`
    SELECT 
      code::VARCHAR AS code,
      name::VARCHAR AS name,
      market::VARCHAR AS market,
      sector33::VARCHAR AS sector33,
      market_cap::BIGINT AS market_cap,
      ipo_date::VARCHAR AS ipo_date
    FROM tickers
    ${whereSql}
    ${orderSql}
    LIMIT ${params.limit} OFFSET ${offset}
  `);
  return tickersRes.getRowObjects() as any[];
}
