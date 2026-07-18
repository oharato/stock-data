import { DuckDBInstance } from '@duckdb/node-api';
import { resolve } from 'path';

const dbCache: Record<string, DuckDBInstance> = {};

export async function getCachedInstance(dbPath: string): Promise<DuckDBInstance> {
  const absPath = resolve(dbPath);
  if (!dbCache[absPath]) {
    dbCache[absPath] = await DuckDBInstance.create(absPath, { access_mode: 'READ_ONLY' });
  }
  return dbCache[absPath];
}

export async function closeCachedDbConnections(): Promise<void> {
  for (const path of Object.keys(dbCache)) {
    const inst = dbCache[path];
    try {
      inst.closeSync();
    } catch {}
    delete dbCache[path];
  }
}
