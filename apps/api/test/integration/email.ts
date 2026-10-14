import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import pg from 'pg';
import { Webhook } from 'svix';
import { createApp } from '../../src/app.js';
import { createDatabase } from '../../src/db.js';
import { hashPassword } from '../../src/auth.js';
import { readConfig } from '../../src/config.js';
import { MockProvider, ResendProvider, type EmailProvider } from '../../src/email/provider.js';
import { applyTestMigrations } from './migrations.js';

test('Email lifecycle on PostgreSQL with mock transport and signed provider fixtures', { timeout: 90000 }, async t => {
  const schema = `stylesense_test_${randomUUID().replaceAll('-', '')}`;
  assert.match(schema, /^stylesense_test_[a-f0-9]{32}$/);
  const connection = new pg.Client({ connectionString: readConfig().DATABASE_URL });
  await connection.connect();
  const dbUrl = new URL(readConfig().DATABASE_URL); dbUrl.searchParams.set('schema', schema);
  const db = createDatabase(dbUrl.toString());
  const servers: ReturnType<ReturnType<typeof createApp>['listen']>[] = [];
  const secret = `whsec_${randomBytes(32).toString('base64')}`;
  let calls = 0; let failure: 'none' | 'reject' | 'timeout' = 'none';
  let beforeSend: (() => Promise<void>) | undefined;
  const provider: EmailProvider = { name: 'mock', async send(payload) { calls++; await beforeSend?.(); return new MockProvider(failure).send(payload); } };
  const authOptions = { appOrigin: 'http://127.0.0.1:5180', production: false, allowSimulatedEvents: false };
  const emailOptions = { provider, publicBaseUrl: 'http://127.0.0.1:4100', from: 'StyleSense AI <onboarding@resend.dev>', senderName: 'Example sender', webhookSecret: secret, production: false };
  try {
    await connection.query(`CREATE SCHEMA "${schema}"`); await connection.query(`SET search_path TO "${schema}"`);
    await applyTestMigrations(connection, schema);
    const user = await db.user.create({ data: { email: 'email-test@example.test', name: 'Email Test', passwordHash: await hashPassword('email-test-password-123') } });
    const company = await db.company.create({ data: { ownerId: user.id, name: 'Example Apparel', domain: 'example.com', sourceUrl: 'https://example.com/about' } });
    const lead = await db.lead.create({ data: { ownerId: user.id, companyId: company.id, firstName: 'Avery', lastName: 'Example', email: 'never-send-to-this@example.test', sourceUrl: 'https://example.com/team', icp: { industries: [], regions: [], titles: [] } } });
    const campaign = await db.campaign.create({ data: { ownerId: user.id, name: 'Email test', icp: {} } });
    await db.campaignLead.create({ data: { ownerId: user.id, campaignId: campaign.id, leadId: lead.id } });
    async function start(p: EmailProvider) {
      const server = createApp(async () => {}, db, authOptions, { ...emailOptions, provider: p }).listen(0, '127.0.0.1');
      servers.push(server); await once(server, 'listening'); const address = server.address(); assert(address && typeof address !== 'string');
      return `http://127.0.0.1:${address.port}`;
    }
    const base = await start(provider);
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: authOptions.appOrigin }, body: JSON.stringify({ email: user.email, password: 'email-test-password-123' }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!; const csrf = (await login.json()).csrfToken as string;
    async function request(path: string, method = 'GET', body?: unknown, extra: Record<string, string> = {}, baseOverride = base) {
      const response = await fetch(baseOverride + path, { method, headers: { 'content-type': 'application/json', origin: authOptions.appOrigin, cookie, 'x-csrf-token': csrf, ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { response, body: await response.json() };
    }
    const endpoint = `/api/campaigns/${campaign.id}/leads/${lead.id}`;
    async function draft(key: string, baseOverride = base) {
      const result = await request(`${endpoint}/messages`, 'POST', { subjectVariant: 2 }, { 'idempotency-key': key }, baseOverride);
      assert.equal(result.response.status, 201, JSON.stringify(result.body)); return result.body.data as { id: string; html: string; body: string; recipient: string; status: string };
    }
    const evidence = { token: 'pain_point_category', value: 'overstock', sourceUrl: 'https://example.com/news', excerpt: 'We are reducing overstock.' };
    let acceptedId = ''; let unsubPath = ''; let pixelPath = '';
    await t.test('email endpoints require sessions and CSRF; evidence is isolated by account', async () => {
      assert.equal((await fetch(`${base}/api/messages`)).status, 401);
      assert.equal((await request(`${endpoint}/email-preview`, 'POST', {}, { 'x-csrf-token': '' })).response.status, 403);
      const other = await db.user.create({ data: { email: 'other-email-test@example.test', name: 'Other', passwordHash: await hashPassword('other-email-password-123') } });
      const otherCompany = await db.company.create({ data: { ownerId: other.id, name: 'Other', domain: 'other.example' } });
      const otherLead = await db.lead.create({ data: { ownerId: other.id, companyId: otherCompany.id, firstName: 'Other', lastName: 'Person', sourceUrl: 'https://example.com', icp: {} } });
      assert.equal((await request(`/api/leads/${otherLead.id}/outreach-evidence`, 'PUT', evidence)).response.status, 404);
      assert.equal((await request(`/api/leads/${otherLead.id}/grounding-logs`)).response.status, 404);
    });
    await t.test('grounding guard logs unsupported claims; drafts require a grounded subject', async () => {
      assert.equal((await request(`/api/leads/${lead.id}/outreach-evidence`, 'PUT', { ...evidence, value: 'cut costs by 80%' })).response.status, 422);
      assert.equal(await db.groundingLog.count({ where: { leadId: lead.id, action: 'blocked' } }), 1);
      assert.equal((await request(`${endpoint}/messages`, 'POST', {}, { 'idempotency-key': 'missing-grounding' })).response.status, 422);
      assert.equal((await request(`/api/leads/${lead.id}/outreach-evidence`, 'PUT', evidence)).response.status, 200);
      const preview = await request(`${endpoint}/email-preview`, 'POST', {});
      assert.equal(preview.body.data.sendable, true); assert(!preview.body.data.body.includes('80%'));
      assert.equal((await request(`${endpoint}/email-preview`, 'POST', { tokens: { pain_point_category: 'invented' } })).response.status, 400);
    });
    await t.test('draft snapshot, idempotency, immutable content and safe recipient routing', async () => {
      const message = await draft('main-message-key'); acceptedId = message.id;
      assert.equal((await draft('main-message-key')).id, acceptedId);
      assert.equal(message.recipient, `delivered+${acceptedId}@resend.dev`);
      assert.notEqual(message.recipient, lead.email);
      assert.equal((await request(`${endpoint}/messages`, 'POST', { subjectVariant: 1 }, { 'idempotency-key': 'main-message-key' })).response.status, 409);
      await assert.rejects(db.emailMessage.update({ where: { id: acceptedId }, data: { subject: 'tampered' } }));
      pixelPath = new URL(message.html.match(/src="([^"]+)"/)![1]!).pathname;
      unsubPath = new URL(message.html.match(/href="([^"]+)"/)![1]!).pathname;
      assert.equal((await fetch(base + pixelPath)).status, 200);
      assert.equal(await db.emailEvent.count({ where: { type: 'OPENED' } }), 0, 'Previewing an unsent draft must not create an open');
    });
    await t.test('concurrent sends submit once; acceptance is not delivery', async () => {
      let release!: () => void; let entered!: () => void;
      const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
      const wait = new Promise<void>(resolve => { release = resolve; });
      beforeSend = async () => { entered(); await wait; };
      const first = request(`/api/messages/${acceptedId}/send`, 'POST', {});
      await enteredPromise;
      const second = request(`/api/messages/${acceptedId}/send`, 'POST', {});
      release();
      const results = await Promise.all([first, second]); beforeSend = undefined;
      assert(results.every(result => [200, 409].includes(result.response.status)));
      assert.equal(calls, 1);
      assert.equal(await db.emailEvent.count({ where: { messageId: acceptedId, type: 'SENT' } }), 1);
      assert.equal(await db.emailEvent.count({ where: { messageId: acceptedId, type: 'DELIVERED' } }), 0);
      assert.equal((await request(`/api/messages/${acceptedId}/send`, 'POST', {})).response.status, 200); assert.equal(calls, 1);
    });
    await t.test('mock delivery and pixel events are separate, timestamped, and scored', async () => {
      assert.equal((await request(`/api/messages/${acceptedId}/simulate-delivery`, 'POST', {})).response.status, 200);
      await request(`/api/messages/${acceptedId}/simulate-delivery`, 'POST', {});
      assert.equal(await db.emailEvent.count({ where: { type: 'DELIVERED' } }), 1);
      const open = await fetch(base + pixelPath); assert.equal(open.headers.get('content-type'), 'image/gif'); assert.match(open.headers.get('cache-control')!, /no-store/);
      await fetch(base + pixelPath);
      assert.equal(await db.emailEvent.count({ where: { type: 'OPENED' } }), 2);
      assert.equal((await db.leadScore.findUniqueOrThrow({ where: { leadId: lead.id } })).total, 10);
      const before = await db.emailEvent.count();
      await fetch(base + pixelPath, { method: 'HEAD' }); await fetch(`${base}/api/public/open/${'0'.repeat(64)}.gif`);
      assert.equal(await db.emailEvent.count(), before);
    });
    await t.test('provider rejection and uncertain outcomes persist; retries reuse the same message', async () => {
      const rejected = await draft('failure-message-key'); failure = 'reject';
      assert.equal((await request(`/api/messages/${rejected.id}/send`, 'POST', {})).response.status, 502);
      assert.equal((await db.emailMessage.findUniqueOrThrow({ where: { id: rejected.id } })).sendStatus, 'FAILED');
      assert.equal(await db.emailEvent.count({ where: { messageId: rejected.id, type: 'SENT' } }), 0);
      failure = 'timeout';
      assert.equal((await request(`/api/messages/${rejected.id}/send`, 'POST', {})).response.status, 502);
      assert.equal((await db.emailMessage.findUniqueOrThrow({ where: { id: rejected.id } })).sendStatus, 'UNCERTAIN');
      failure = 'none';
      assert.equal((await request(`/api/messages/${rejected.id}/send`, 'POST', {})).response.status, 200);
      assert.equal(await db.emailEvent.count({ where: { messageId: rejected.id, type: 'SENT' } }), 1);
    });
    await t.test('old uncertain attempts cannot be resent after provider idempotency expires', async () => {
      const old = await draft('old-attempt-message');
      await db.emailMessage.update({ where: { id: old.id }, data: { firstAttemptAt: new Date(Date.now() - 24 * 60 * 60 * 1000), sendStatus: 'UNCERTAIN', attemptCount: 1 } });
      const before = calls;
      const result = await request(`/api/messages/${old.id}/send`, 'POST', {});
      assert.equal(result.response.status, 409); assert.equal(result.body.error.code, 'RECONCILIATION_REQUIRED'); assert.equal(calls, before);
    });
    await t.test('signed webhook fixture rejects tampering and stale signatures, and deduplicates delivery', async () => {
      const resend = new ResendProvider('fixture-key-no-network', (async (_url: unknown, init?: RequestInit) => {
        const payload = JSON.parse(init!.body as string) as { to: string[] };
        assert.match(payload.to[0]!, /^delivered\+/);
        return new Response(JSON.stringify({ id: 'resend-fixture-id' }), { status: 200 });
      }) as typeof fetch);
      const resendBase = await start(resend);
      const message = await draft('resend-fixture-message', resendBase);
      assert.equal((await request(`/api/messages/${message.id}/send`, 'POST', {}, {}, resendBase)).response.status, 200);
      assert.equal((await request(`/api/messages/${message.id}/simulate-delivery`, 'POST', {}, {}, resendBase)).response.status, 404);
      const raw = JSON.stringify({ type: 'email.delivered', created_at: new Date().toISOString(), data: { email_id: 'resend-fixture-id' } });
      const id = 'evt_test_verified'; const now = new Date();
      const signature = new Webhook(secret).sign(id, now, raw);
      const headers = { 'content-type': 'application/json', 'svix-id': id, 'svix-timestamp': String(Math.floor(now.getTime() / 1000)), 'svix-signature': signature };
      assert.equal((await fetch(`${resendBase}/api/webhooks/resend`, { method: 'POST', headers, body: raw + ' ' })).status, 400);
      for (let i = 0; i < 2; i++) {
        const response = await fetch(`${resendBase}/api/webhooks/resend`, { method: 'POST', headers, body: raw });
        assert.equal(response.status, 200, await response.text());
      }
      assert.equal(await db.emailEvent.count({ where: { messageId: message.id, type: 'DELIVERED' } }), 1);
      const old = new Date(Date.now() - 10 * 60 * 1000);
      assert.equal((await fetch(`${resendBase}/api/webhooks/resend`, { method: 'POST', headers: { ...headers, 'svix-timestamp': String(Math.floor(old.getTime() / 1000)), 'svix-signature': new Webhook(secret).sign(id, old, raw) }, body: raw })).status, 400);
    });
    await t.test('unsubscribe GET is inert, POST is repeatable, and blocks prepared/future sends', async () => {
      const pending = await draft('before-unsubscribe-key');
      assert.equal((await fetch(base + unsubPath)).status, 200);
      assert.equal(await db.suppression.count(), 0);
      for (let i = 0; i < 2; i++) assert.equal((await fetch(base + unsubPath, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' })).status, 200);
      assert.equal(await db.emailEvent.count({ where: { messageId: acceptedId, type: 'UNSUBSCRIBED' } }), 1);
      assert(await db.suppression.findUnique({ where: { ownerId_email: { ownerId: user.id, email: lead.email! } } }));
      const before = calls;
      assert.equal((await request(`/api/messages/${pending.id}/send`, 'POST', {})).response.status, 409);
      const future = await draft('after-unsubscribe-key'); assert.equal((await request(`/api/messages/${future.id}/send`, 'POST', {})).response.status, 409);
      assert.equal(calls, before); assert.equal((await db.leadScore.findUniqueOrThrow({ where: { leadId: lead.id } })).total, 0);
    });
  } finally {
    for (const server of servers) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await db.$disconnect(); await connection.query('SET search_path TO public');
    await connection.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await connection.end();
  }
});
