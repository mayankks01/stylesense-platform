import pg from 'pg';
import { createApp } from './app.js';
import { readConfig } from './config.js';

const config = readConfig();
const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 5, connectionTimeoutMillis: 2000, query_timeout: 2000 });
pool.on('error', () => console.error('An idle database connection failed.'));
const app = createApp(async () => { await pool.query('SELECT 1'); });
const server = app.listen(config.PORT, config.HOST, () => {
  console.log(`StyleSense API listening at http://${config.HOST}:${config.PORT}`);
});
server.on('error', () => {
  console.error('API listener failed. Check the configured host and port.');
  void pool.end().finally(() => process.exit(1));
});
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 10_000);
  deadline.unref();
  server.close(() => { void pool.end().finally(() => { clearTimeout(deadline); process.exit(0); }); });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
