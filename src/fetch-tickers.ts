import { fetchAndSaveTickers } from './repository/jpx.js';

fetchAndSaveTickers().catch(console.error);
