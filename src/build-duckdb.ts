import { buildDuckDb } from './repository/duckdb.js';

buildDuckDb().catch(console.error);
