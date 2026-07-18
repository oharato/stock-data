import { promises as fs, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { DuckDBInstance } from '@duckdb/node-api';
import { Viewer } from '../chart-viewer/views/Viewer.js';

// Helper: Recursively copy a directory
async function copyDir(src: string, dest: string) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

async function exportDataJson(dbPath: string, outputPath: string) {
  const absDb = resolve(dbPath);
  if (!existsSync(absDb)) {
    throw new Error(`Database file not found at ${absDb}`);
  }

  const inst = await DuckDBInstance.create(absDb, { access_mode: 'READ_ONLY' });
  const conn = await inst.connect();
  try {
    console.log('Querying stock tickers for JSON export...');
    const result = await conn.runAndReadAll(`
      SELECT 
        code::VARCHAR AS code,
        name::VARCHAR AS name,
        market::VARCHAR AS market,
        sector33::VARCHAR AS sector33,
        market_cap::BIGINT AS market_cap,
        ipo_date::VARCHAR AS ipo_date
      FROM tickers
      ORDER BY code ASC
    `);
    const rows = result.getRowObjects() as any[];
    
    // Convert BigInt to Number for JSON serialization
    const serializedRows = rows.map(r => {
      const newRow: any = {};
      for (const key of Object.keys(r)) {
        const val = r[key];
        newRow[key] = typeof val === 'bigint' ? Number(val) : val;
      }
      return newRow;
    });
    
    // Write out to data.json
    await fs.writeFile(outputPath, JSON.stringify(serializedRows, null, 2), 'utf-8');
    console.log(`Successfully exported ${rows.length} tickers to ${outputPath}`);
  } finally {
    conn.disconnectSync();
    inst.closeSync();
  }
}

async function main() {
  console.log('Starting static site build process...');

  const distDir = resolve('dist');
  const distPublicDir = join(distDir, 'public');
  const distChartsDir = join(distDir, 'charts');

  // Clean and recreate dist directories
  try {
    await fs.rm(distDir, { recursive: true, force: true });
  } catch {}
  await fs.mkdir(distDir, { recursive: true });
  await fs.mkdir(distPublicDir, { recursive: true });
  await fs.mkdir(distChartsDir, { recursive: true });

  // 1. Export database metadata to data.json
  const dbPath = 'stock.duckdb';
  const dataJsonDest = join(distPublicDir, 'data.json');
  await exportDataJson(dbPath, dataJsonDest);

  // 2. Render static index.html from Viewer component
  console.log('Rendering Viewer component to static index.html...');
  // Resolving JSX directly in Hono JSX setup returns an HtmlEscapedString which resolves to string
  const renderedHtml = '<!DOCTYPE html>\n' + (Viewer() as any).toString();
  const indexHtmlDest = join(distDir, 'index.html');
  await fs.writeFile(indexHtmlDest, renderedHtml, 'utf-8');
  console.log(`Rendered index.html saved to ${indexHtmlDest}`);

  // 3. Copy static CSS and JS assets
  console.log('Copying public assets (CSS/JS)...');
  await fs.copyFile(resolve('public/viewer.css'), join(distPublicDir, 'viewer.css'));
  await fs.copyFile(resolve('public/viewer.js'), join(distPublicDir, 'viewer.js'));
  console.log('Assets copied successfully.');

  // 4. Copy generated chart images
  const srcChartsDir = resolve('data/charts');
  if (existsSync(srcChartsDir)) {
    console.log('Copying chart images to dist/charts...');
    await copyDir(srcChartsDir, distChartsDir);
    console.log('Images copied successfully.');
  } else {
    console.warn(`Charts directory not found at ${srcChartsDir}, skipping image copy.`);
  }

  console.log('\n🎉 Static site build complete! Output folder: dist/');
}

main().catch(err => {
  console.error('Fatal error during static build:', err);
  process.exit(1);
});
