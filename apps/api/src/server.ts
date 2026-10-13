import { createDatabase } from './db.js';
import { createApp } from './app.js';
import { readConfig } from './config.js';

const config = readConfig();
const db = createDatabase(config.DATABASE_URL);
const app = createApp(async () => { await db.$queryRaw`SELECT 1`; }, db, {
  appOrigin: config.APP_ORIGIN,
  production: config.NODE_ENV === 'production',
  allowSimulatedEvents: config.ALLOW_SIMULATED_EVENTS === 'true',
});
const server = app.listen(config.PORT, config.HOST, () => {
  console.log(`StyleSense API listening at http://${config.HOST}:${config.PORT}`);
});
server.on('error', () => {
  console.error('API listener failed. Check the configured host and port.');
  void db.$disconnect().finally(() => process.exit(1));
});
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 10_000);
  deadline.unref();
  server.close(() => { void db.$disconnect().finally(() => { clearTimeout(deadline); process.exit(0); }); });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
