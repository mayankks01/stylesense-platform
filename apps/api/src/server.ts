import { createDatabase } from './db.js';
import { createApp } from './app.js';
import { readConfig } from './config.js';
import { MockProvider, ResendProvider } from './email/provider.js';

const config = readConfig();
const db = createDatabase(config.DATABASE_URL);
const app = createApp(async () => { await db.$queryRaw`SELECT 1`; }, db, {
  appOrigin: config.APP_ORIGIN,
  production: config.NODE_ENV === 'production',
  allowSimulatedEvents: config.ALLOW_SIMULATED_EVENTS === 'true',
}, {
  provider: config.EMAIL_MODE === 'resend' ? new ResendProvider(config.RESEND_API_KEY!) : new MockProvider(config.EMAIL_MOCK_FAILURE),
  publicBaseUrl: config.PUBLIC_BASE_URL.replace(/\/$/, ''), from: config.EMAIL_FROM, senderName: config.EMAIL_SENDER_NAME,
  proposedTimeWindow: config.EMAIL_PROPOSED_TIME_WINDOW, webhookSecret: config.RESEND_WEBHOOK_SECRET,
  production: config.NODE_ENV === 'production',
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
