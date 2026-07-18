import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { copyFileSync, existsSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import { DuckDBInstance } from '@duckdb/node-api';
import { Viewer, TickerCard } from './views/Viewer.js';

// Helper functions for TickerCard SSR
const formatMarketCap = (val: any) => {
  if (val === null || val === undefined) return '---';
  const numVal = Number(val);
  const oku = numVal / 100000000;
  if (oku >= 10000) {
    return `${(oku / 10000).toFixed(2)}兆円`;
  }
  return `${Math.round(oku).toLocaleString()}億円`;
};

const formatIpoDate = (val: string | null) => {
  if (!val) return '---';
  return val;
};

const app = new Hono();

// Serve charts dynamic images statically
app.use('/charts/*', serveStatic({
  root: './data' // /charts/daily/7203.T.webp -> ./data/charts/daily/7203.T.webp
}));

const DB_PATH = resolve('stock.duckdb');
const TEMP_DB_PATH = resolve('stock.duckdb.tmp-viewer');

// Copy database to avoid lock conflict with other tasks (fetch/batch)
if (existsSync(DB_PATH)) {
  console.log('Copying database for viewer to avoid lock conflicts...');
  copyFileSync(DB_PATH, TEMP_DB_PATH);
} else {
  console.error(`Database not found at ${DB_PATH}. Run DB build first.`);
  process.exit(1);
}

let dbInstance: DuckDBInstance;

async function getDbInstance() {
  if (!dbInstance) {
    dbInstance = await DuckDBInstance.create(TEMP_DB_PATH, { access_mode: 'READ_ONLY' });
  }
  return dbInstance;
}

// Graceful cleanup on server stop
function cleanup() {
  console.log('\nShutting down server and cleaning up...');
  if (dbInstance) {
    try {
      dbInstance.closeSync();
    } catch {}
  }
  if (existsSync(TEMP_DB_PATH)) {
    try {
      unlinkSync(TEMP_DB_PATH);
    } catch {}
  }
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Simple SQL String Escaper
function escapeSql(str: string): string {
  return str.replace(/'/g, "''");
}

app.get('/', async (c) => {
  const sector = c.req.query('sector') || '';
  const sort = c.req.query('sort') || 'code_asc';
  const search = c.req.query('search') || '';
  const page = parseInt(c.req.query('page') || '1', 10);
  const limit = 10;
  const offset = (page - 1) * limit;

  const inst = await getDbInstance();
  const conn = await inst.connect();

  try {
    // 1. Fetch unique sectors list for select input
    const sectorRes = await conn.runAndReadAll(
      "SELECT DISTINCT sector33::VARCHAR AS sector FROM tickers WHERE sector33 IS NOT NULL AND sector33 != '' ORDER BY sector ASC"
    );
    const sectors = sectorRes.getRowObjects().map((r: any) => r.sector);

    // 2. Build WHERE filter queries
    let whereClauses: string[] = [];
    if (sector) {
      whereClauses.push(`sector33 = '${escapeSql(sector)}'`);
    }
    if (search) {
      const escapedSearch = escapeSql(search);
      whereClauses.push(`(code LIKE '%${escapedSearch}%' OR name LIKE '%${escapedSearch}%')`);
    }
    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // 3. Build ORDER BY sorting queries
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

    // 4. Fetch total count of filtered rows for pagination
    const countRes = await conn.runAndReadAll(`SELECT COUNT(*)::BIGINT AS count FROM tickers ${whereSql}`);
    const totalCount = Number(countRes.getRowObjects()[0].count);
    const totalPages = Math.ceil(totalCount / limit);

    // 5. Fetch tickers for current page
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
      LIMIT ${limit} OFFSET ${offset}
    `);
    const tickers = tickersRes.getRowObjects() as any[];

    // Render HTML JSX component page
    return c.html(
      <Viewer
        tickers={tickers}
        sectors={sectors}
        currentSector={sector}
        currentSort={sort}
        currentSearch={search}
        currentPage={page}
        totalPages={totalPages}
      />
    );
  } catch (err) {
    console.error('Database query error:', err);
    return c.text(`Internal Server Error: ${err}`, 500);
  } finally {
    conn.disconnectSync();
  }
});

// API Endpoint to render HTML fragments of ticker cards for infinite scroll
app.get('/api/tickers/html', async (c) => {
  const sector = c.req.query('sector') || '';
  const sort = c.req.query('sort') || 'code_asc';
  const search = c.req.query('search') || '';
  const page = parseInt(c.req.query('page') || '1', 10);
  const limit = 10;
  const offset = (page - 1) * limit;

  const inst = await getDbInstance();
  const conn = await inst.connect();

  try {
    let whereClauses: string[] = [];
    if (sector) {
      whereClauses.push(`sector33 = '${escapeSql(sector)}'`);
    }
    if (search) {
      const escapedSearch = escapeSql(search);
      whereClauses.push(`(code LIKE '%${escapedSearch}%' OR name LIKE '%${escapedSearch}%')`);
    }
    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

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
      LIMIT ${limit} OFFSET ${offset}
    `);
    const tickers = tickersRes.getRowObjects() as any[];

    if (tickers.length === 0) {
      return c.text('');
    }

    // Render components array and convert to HTML string fragment
    const cards = tickers.map(t => (
      <TickerCard t={t} formatMarketCap={formatMarketCap} formatIpoDate={formatIpoDate} />
    ));

    return c.html(<>{cards}</>);
  } catch (err) {
    console.error('API query error:', err);
    return c.text(`Error: ${err}`, 500);
  } finally {
    conn.disconnectSync();
  }
});

import { createServer } from 'net';

function getFreePort(startPort: number): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(startPort, () => {
      const port = (srv.address() as any).port;
      srv.close(() => resolve(port));
    });
    srv.on('error', () => {
      resolve(getFreePort(startPort + 1));
    });
  });
}

async function startServer() {
  const defaultPort = parseInt(process.env.PORT || '3000', 10);
  const port = await getFreePort(defaultPort);
  console.log(`\n🚀 Stock Chart Viewer starting on http://localhost:${port}`);
  serve({
    fetch: app.fetch,
    port
  });
}

startServer().catch(console.error);
