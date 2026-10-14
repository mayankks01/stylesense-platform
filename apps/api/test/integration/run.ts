import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { applyTestMigrations } from './migrations.js';
import test from 'node:test';
import pg from 'pg';
import { createApp } from '../../src/app.js';
import { createDatabase } from '../../src/db.js';
import { hashPassword } from '../../src/auth.js';
import { readConfig } from '../../src/config.js';
import { calculateScore, type FitInput, type ScoreEvent, scoringConfig } from '../../src/scoring.js';

test('PostgreSQL lifecycle: sessions, tenant boundaries, constraints, events, scoring and replay', { timeout: 90000 }, async t => {
  const baseUrl = readConfig().DATABASE_URL;
  // Every run owns a newly created, unguessable schema; no existing application records are touched.
  const schema = `stylesense_test_${randomUUID().replaceAll('-', '')}`;
  assert.match(schema, /^stylesense_test_[a-f0-9]{32}$/);
  const connection = new pg.Client({ connectionString: baseUrl });
  await connection.connect();
  const dbUrl = new URL(baseUrl); dbUrl.searchParams.set('schema', schema);
  const db = createDatabase(dbUrl.toString());
  let server: ReturnType<ReturnType<typeof createApp>['listen']> | undefined;
  try {
    await connection.query(`CREATE SCHEMA "${schema}"`);
    await connection.query(`SET search_path TO "${schema}"`);
    await applyTestMigrations(connection, schema);
    const password = 'local-integration-password-123';
    const passwordHash = await hashPassword(password);
    const a = await db.user.create({ data: { email: 'one@example.test', name: 'One', passwordHash } });
    const b = await db.user.create({ data: { email: 'two@example.test', name: 'Two', passwordHash } });
    server = createApp(async () => { await db.$queryRaw`SELECT 1`; }, db, { appOrigin: 'http://127.0.0.1:5180', production: false, allowSimulatedEvents: true }).listen(0, '127.0.0.1');
    await once(server, 'listening'); const address = server.address(); assert(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    type Session = { cookie: string; csrf: string };
    async function request(path: string, method = 'GET', body?: unknown, session?: Session, headers: Record<string, string> = {}) {
      const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:5180', ...(session ? { cookie: session.cookie, 'x-csrf-token': session.csrf } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      return { response, body: response.status === 204 ? null : await response.json() };
    }
    async function login(email: string) {
      const result = await request('/api/auth/login', 'POST', { email, password });
      assert.equal(result.response.status, 200);
      const cookie = result.response.headers.get('set-cookie')!; assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/i);
      return { cookie: cookie.split(';')[0]!, csrf: result.body.csrfToken };
    }
    await t.test('unauthenticated data, invalid login and cross-origin login are rejected', async () => {
      assert.equal((await request('/api/leads')).response.status, 401);
      assert.equal((await request('/api/auth/login', 'POST', { email: a.email, password: 'wrong' })).response.status, 401);
      assert.equal((await request('/api/auth/login', 'POST', { email: a.email, password }, undefined, { origin: 'https://other.example' })).response.status, 403);
    });
    const sa = await login(a.email); const sb = await login(b.email);
    const icp = { industries: ['Apparel'], regions: ['India'], titles: ['Head of Merchandising'], minCompanySize: 50, maxCompanySize: 500 };
    let companyId = ''; let leadId = ''; let campaignId = '';
    await t.test('CSRF, validation, company uniqueness and baseline lead score', async () => {
      assert.equal((await request('/api/companies', 'POST', {}, { ...sa, csrf: '' })).response.status, 403);
      assert.equal((await request('/api/companies', 'POST', {}, sa)).response.status, 400);
      assert.equal((await request('/api/leads?page=0', 'GET', undefined, sa)).response.status, 400);
      const data = { name: 'Test Apparel', domain: 'apparel.example', industry: 'Apparel', region: 'India', size: 200 };
      const company = await request('/api/companies', 'POST', data, sa); assert.equal(company.response.status, 201); companyId = company.body.data.id;
      assert.equal((await request('/api/companies', 'POST', data, sa)).response.status, 409);
      const lead = await request('/api/leads', 'POST', { companyId, firstName: 'Test', lastName: 'Buyer', email: 'buyer@example.test', title: 'Head of Merchandising', sourceUrl: 'https://example.com/team', icp }, sa);
      assert.equal(lead.response.status, 201); leadId = lead.body.data.id; assert.equal(lead.body.data.score.total, 60);
      assert.equal((await request('/api/leads', 'POST', { companyId, firstName: 'Other', lastName: 'Buyer', sourceUrl: 'https://example.com', icp, ownerId: a.id }, sa)).response.status, 400);
    });
    await t.test('cross-account reads, updates, relationships, and raw database ownership constraints', async () => {
      assert.equal((await request(`/api/leads/${leadId}`, 'GET', undefined, sb)).response.status, 404);
      assert.equal((await request(`/api/leads/${leadId}`, 'PATCH', { firstName: 'Changed' }, sb)).response.status, 404);
      assert.equal((await request(`/api/events?leadId=${leadId}`, 'GET', undefined, sb)).response.status, 404);
      assert.equal((await request('/api/leads', 'GET', undefined, sb)).body.pagination.total, 0);
      await assert.rejects(db.lead.create({ data: { ownerId: b.id, companyId, firstName: 'Forbidden', lastName: 'Link', sourceUrl: 'https://example.com', icp } }));
      const campaign = await request('/api/campaigns', 'POST', { name: 'Apparel buyers', icp }, sa); assert.equal(campaign.response.status, 201); campaignId = campaign.body.data.id;
      assert.equal((await request(`/api/campaigns/${campaignId}/leads`, 'POST', { leadId }, sb)).response.status, 404);
      assert.equal((await request(`/api/campaigns/${campaignId}/leads`, 'POST', { leadId }, sa)).response.status, 200);
      assert.equal((await request(`/api/campaigns/${campaignId}/leads`, 'POST', { leadId }, sa)).response.status, 200);
      assert.equal((await request(`/api/campaigns/${campaignId}/leads`, 'GET', undefined, sa)).body.pagination.total, 1);
    });
    await t.test('concurrent duplicate events are idempotent; changed input conflicts; opens are capped', async () => {
      const body = { type: 'OPENED', dedupeKey: 'open-key-0001' };
      const results = await Promise.all([request(`/api/leads/${leadId}/simulated-events`, 'POST', body, sa), request(`/api/leads/${leadId}/simulated-events`, 'POST', body, sa)]);
      assert.deepEqual(results.map(r => r.response.status).sort(), [200, 201]);
      assert.equal((await request(`/api/leads/${leadId}/simulated-events`, 'POST', { ...body, type: 'SENT' }, sa)).response.status, 409);
      assert.equal((await request(`/api/leads/${leadId}/simulated-events`, 'POST', { ...body, dedupeKey: 'open-key-0002' }, sa)).response.status, 201);
      assert.equal((await request(`/api/leads/${leadId}`, 'GET', undefined, sa)).body.data.score.total, 70);
      const events = await request(`/api/events?leadId=${leadId}&limit=1`, 'GET', undefined, sa); assert.equal(events.body.data.length, 1); assert.equal(events.body.pagination.total, 2);
    });
    await t.test('reply score, company edits, replay snapshots, filtering and immutable history', async () => {
      const reply = await request(`/api/leads/${leadId}/simulated-events`, 'POST', { type: 'REPLIED', intent: 'INTERESTED', text: 'Please tell me more', dedupeKey: 'reply-key-0001' }, sa); assert.equal(reply.response.status, 201);
      assert.equal((await request(`/api/leads/${leadId}`, 'GET', undefined, sa)).body.data.score.total, 100);
      assert.equal((await request(`/api/companies/${companyId}`, 'PATCH', { industry: 'Other' }, sa)).response.status, 200);
      assert.equal((await request(`/api/leads/${leadId}`, 'GET', undefined, sa)).body.data.score.total, 80);
      const replay = await request(`/api/leads/${leadId}/recompute`, 'POST', {}, sa); assert.equal(replay.body.data.total, 80);
      const ranked = await request('/api/leads?status=REPLIED&minScore=80&search=Buyer', 'GET', undefined, sa); assert.equal(ranked.body.data[0].id, leadId);
      const history = await db.scoreHistory.findMany({ where: { leadId } });
      for (const row of history) {
        const inputs = row.inputs as unknown as { fit: FitInput; eventIds: string[]; suppressed: boolean };
        const events = await db.emailEvent.findMany({ where: { id: { in: inputs.eventIds } } });
        const recomputed = calculateScore(inputs.fit, events as ScoreEvent[], inputs.suppressed, row.config as typeof scoringConfig);
        assert.equal(recomputed.total, row.total);
      }
      await assert.rejects(db.emailEvent.update({ where: { id: reply.body.data.id }, data: { source: 'forged' } }));
      await assert.rejects(db.scoreHistory.delete({ where: { id: history[0]!.id } }));
      await assert.rejects(db.leadScore.update({ where: { leadId }, data: { total: 101 } }));
    });
    await t.test('unsubscribe suppression is durable and invalid events do not mutate history', async () => {
      assert.equal((await request(`/api/leads/${leadId}/simulated-events`, 'POST', { type: 'REPLIED', dedupeKey: 'invalid-key-0001' }, sa)).response.status, 400);
      assert.equal((await request(`/api/leads/${leadId}/simulated-events`, 'POST', { type: 'UNSUBSCRIBED', dedupeKey: 'unsubscribe-key-0001' }, sa)).response.status, 201);
      assert.equal((await request(`/api/leads/${leadId}`, 'GET', undefined, sa)).body.data.score.total, 0);
      assert.equal(await db.suppression.count({ where: { ownerId: a.id } }), 1);
      await request(`/api/leads/${leadId}`, 'PATCH', { email: 'corrected@example.test' }, sa);
      assert.equal(await db.suppression.count({ where: { ownerId: a.id } }), 2);
    });
    await t.test('session rotation, logout revocation and absolute expiry', async () => {
      const again = await request('/api/auth/login', 'POST', { email: a.email, password }, sa);
      assert.equal(again.response.status, 200);
      assert.equal((await request('/api/auth/me', 'GET', undefined, sa)).response.status, 401);
      const renewed = { cookie: again.response.headers.get('set-cookie')!.split(';')[0]!, csrf: again.body.csrfToken };
      assert.equal((await request('/api/auth/logout', 'POST', {}, renewed)).response.status, 204);
      assert.equal((await request('/api/auth/me', 'GET', undefined, renewed)).response.status, 401);
      await db.session.updateMany({ where: { userId: b.id }, data: { expiresAt: new Date(0) } });
      assert.equal((await request('/api/leads', 'GET', undefined, sb)).response.status, 401);
    });
    await t.test('sign-in attempts are rate limited with a structured response', async () => {
      let status = 0;
      for (let attempt = 0; attempt < 11; attempt++) {
        const result = await request('/api/auth/login', 'POST', { email: a.email, password: 'incorrect' });
        status = result.response.status;
        if (status === 429) { assert.equal(result.body.error.code, 'RATE_LIMITED'); break; }
      }
      assert.equal(status, 429);
    });
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    await db.$disconnect();
    await connection.query('SET search_path TO public');
    await connection.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await connection.end();
  }
});
