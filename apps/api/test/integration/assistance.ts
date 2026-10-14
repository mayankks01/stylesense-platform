import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import pg from 'pg';
import { createApp } from '../../src/app.js';
import { createDatabase } from '../../src/db.js';
import { hashPassword } from '../../src/auth.js';
import { readConfig } from '../../src/config.js';
import { MockProvider } from '../../src/email/provider.js';
import { MockModel, MockResearch, type ModelProvider } from '../../src/ai/providers.js';
import { applyTestMigrations } from './migrations.js';

test('Discovery and reply assistance on PostgreSQL', { timeout: 90000 }, async t => {
  const schema = `stylesense_test_${randomUUID().replaceAll('-', '')}`; assert.match(schema, /^stylesense_test_[a-f0-9]{32}$/);
  const connection = new pg.Client({ connectionString: readConfig().DATABASE_URL }); await connection.connect();
  const url = new URL(readConfig().DATABASE_URL); url.searchParams.set('schema', schema); const db = createDatabase(url.toString());
  let server: ReturnType<ReturnType<typeof createApp>['listen']> | undefined;
  const mock = new MockModel(); let mode: 'normal' | 'partial' | 'invalid' = 'normal';
  const model: ModelProvider = { name: 'mock', model: mock.model, simulated: true, async turn(instructions, input, _tools, _signal) {
    if (mode === 'invalid') return [{ type: 'function_call', name: 'unexpected', arguments: '{}', call_id: 'invalid' }];
    const result = await mock.turn(instructions, input);
    if (mode === 'partial' && result[0]?.name === 'finish_discovery') { const args = JSON.parse(String(result[0].arguments)); args.candidates[0].contact.email = 'invented@example.test'; result[0].arguments = JSON.stringify(args); }
    return result;
  } };
  try {
    await connection.query(`CREATE SCHEMA "${schema}"`); await connection.query(`SET search_path TO "${schema}"`); await applyTestMigrations(connection, schema);
    const owner = await db.user.create({ data: { email: 'ai@example.test', name: 'AI test', passwordHash: await hashPassword('ai-test-password-123') } });
    const other = await db.user.create({ data: { email: 'other-ai@example.test', name: 'Other', passwordHash: await hashPassword('ai-test-password-123') } });
    server = createApp(async () => {}, db, { appOrigin: 'http://127.0.0.1:5180', production: false, allowSimulatedEvents: false }, { provider: new MockProvider(), publicBaseUrl: 'http://127.0.0.1:4100', from: 'Test <onboarding@resend.dev>', senderName: 'Test sender', production: false }, { model, research: new MockResearch(), production: false }).listen(0, '127.0.0.1');
    await once(server, 'listening'); const address = server.address(); assert(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}/api`;
    async function login(email: string) { const response = await fetch(base + '/auth/login', { method: 'POST', headers: { Origin: 'http://127.0.0.1:5180', 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'ai-test-password-123' }) }); assert.equal(response.status, 200); return { cookie: response.headers.get('set-cookie')!.split(';')[0]!, csrf: (await response.json()).csrfToken as string }; }
    const session = await login(owner.email); const otherSession = await login(other.email);
    async function request(path: string, method = 'GET', body?: unknown, key?: string, auth = session) {
      const response = await fetch(base + path, { method, headers: { Origin: 'http://127.0.0.1:5180', cookie: auth.cookie, 'X-CSRF-Token': auth.csrf, 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() };
    }
    const input = { icp: { industries: ['Apparel'], regions: ['India'], titles: ['Buyer'], minCompanySize: 50, maxCompanySize: 500 }, count: 5 };
    let runId = ''; let candidateId = ''; let leadId = ''; let replyId = ''; let draftId = '';
    await t.test('authentication, CSRF and discovery input validation', async () => {
      assert.equal((await fetch(base + '/discovery')).status, 401);
      assert.equal((await request('/discovery', 'POST', input, 'csrf-test-0001', { ...session, csrf: '' })).status, 403);
      assert.equal((await request('/discovery', 'POST', { ...input, count: 100 }, 'count-test-0001')).status, 400);
      const settings = await request('/ai/settings'); assert.equal(settings.body.data.simulated, true);
    });
    await t.test('bounded discovery stores synthetic sources, candidates and idempotency', async () => {
      const first = await request('/discovery', 'POST', input, 'discovery-main-0001'); assert.equal(first.status, 201, JSON.stringify(first.body)); runId = first.body.data.id;
      assert.equal(first.body.data.status, 'COMPLETE'); assert.equal(first.body.data.sources.length, 5); assert.equal(first.body.data.simulated, true);
      const detail = await request(`/discovery/${runId}`); assert.equal(detail.body.data.candidates.length, 5); candidateId = detail.body.data.candidates[0].id;
      assert.equal((await request('/discovery', 'POST', input, 'discovery-main-0001')).body.data.id, runId);
      assert.equal((await request('/discovery', 'POST', { ...input, count: 6 }, 'discovery-main-0001')).status, 409);
      assert.equal(await db.discoveryRun.count({ where: { ownerId: owner.id } }), 1);
    });
    await t.test('reviewed import persists provenance and duplicate imports reuse the same lead', async () => {
      const first = await request(`/discovery/${runId}/import`, 'POST', { candidateId }); assert.equal(first.status, 200, JSON.stringify(first.body)); leadId = first.body.data.leadId;
      assert.equal((await request(`/discovery/${runId}/import`, 'POST', { candidateId })).body.data.leadId, leadId);
      const facts = await request(`/leads/${leadId}/research-facts`); assert.equal(facts.body.data.length, 6); assert(facts.body.data.every((fact: { simulated: boolean }) => fact.simulated));
      const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId }, include: { score: true } }); assert.equal(lead.email, null); assert.equal(lead.score?.total, 60);
      const again = await request('/discovery', 'POST', input, 'discovery-second-0001');
      const second = await db.discoveryCandidate.findFirstOrThrow({ where: { runId: again.body.data.id, fingerprint: lead.discoveryKey! } });
      assert.equal((await request(`/discovery/${again.body.data.id}/import`, 'POST', { candidateId: second.id })).body.data.leadId, leadId);
      assert.equal(await db.lead.count({ where: { ownerId: owner.id } }), 1);
    });
    await t.test('other accounts cannot access runs, import candidates or read evidence', async () => {
      assert.equal((await request(`/discovery/${runId}`, 'GET', undefined, undefined, otherSession)).status, 404);
      assert.equal((await request(`/discovery/${runId}/import`, 'POST', { candidateId }, undefined, otherSession)).status, 404);
      assert.equal((await request(`/leads/${leadId}/research-facts`, 'GET', undefined, undefined, otherSession)).status, 404);
      await assert.rejects(db.researchFact.create({ data: { ownerId: other.id, leadId, field: 'fake', value: 'fake', sourceUrl: 'https://example.com', excerpt: 'fake', fetchedAt: new Date(), contentHash: 'a'.repeat(64), simulated: false } }));
    });
    await t.test('unsupported model claims yield partial results; malformed tools fail without importing', async () => {
      mode = 'partial'; const partial = await request('/discovery', 'POST', input, 'discovery-partial-0001'); assert.equal(partial.body.data.status, 'PARTIAL'); assert.equal(partial.body.data.rejections.length, 1);
      assert.equal(await db.discoveryCandidate.count({ where: { runId: partial.body.data.id } }), 4);
      mode = 'invalid'; const failed = await request('/discovery', 'POST', input, 'discovery-failed-0001'); assert.equal(failed.body.data.status, 'FAILED'); assert.equal(await db.discoveryCandidate.count({ where: { runId: failed.body.data.id } }), 0); mode = 'normal';
    });
    await t.test('simulated replies are idempotent and update scored history without sending', async () => {
      const reply = await request(`/leads/${leadId}/replies`, 'POST', { text: "Interested. Let's schedule a call." }, 'reply-interested-0001'); assert.equal(reply.status, 201, JSON.stringify(reply.body)); replyId = reply.body.data.id;
      assert.equal(reply.body.data.intent, 'INTERESTED'); assert.equal(reply.body.data.status, 'PENDING_REVIEW');
      assert.equal((await request(`/leads/${leadId}/replies`, 'POST', { text: "Interested. Let's schedule a call." }, 'reply-interested-0001')).body.data.id, replyId);
      assert.equal((await request(`/leads/${leadId}/replies`, 'POST', { text: 'Different input' }, 'reply-interested-0001')).status, 409);
      assert.equal((await db.leadScore.findUniqueOrThrow({ where: { leadId } })).total, 90); assert.equal(await db.emailEvent.count({ where: { leadId, type: 'REPLIED' } }), 1);
      assert.equal(await db.emailMessage.count(), 0);
    });
    await t.test('human review is account scoped, immutable after decision and never sends', async () => {
      assert.equal((await request(`/replies/${replyId}/review`, 'POST', { decision: 'approve', draft: 'Reviewed wording.' }, undefined, otherSession)).status, 404);
      assert.equal((await request(`/replies/${replyId}/review`, 'POST', { decision: 'approve', draft: 'Reviewed wording.' })).body.data.status, 'APPROVED');
      assert.equal((await request(`/replies/${replyId}/review`, 'POST', { decision: 'approve', draft: 'Changed after approval.' })).status, 409);
      assert.equal(await db.emailMessage.count(), 0);
      const reply = await request(`/leads/${leadId}/replies`, 'POST', { text: 'Please send details.' }, 'reply-details-0001');
      assert.equal((await request(`/replies/${reply.body.data.id}/review`, 'POST', { decision: 'dismiss' })).body.data.status, 'DISMISSED');
    });
    await t.test('classification failure is non-mutating; opt-out bypasses failure and blocks prepared sends', async () => {
      const campaign = await db.campaign.create({ data: { ownerId: owner.id, name: 'Suppression test', icp: {} } }); await db.campaignLead.create({ data: { ownerId: owner.id, leadId, campaignId: campaign.id } });
      const draft = await request(`/campaigns/${campaign.id}/leads/${leadId}/messages`, 'POST', { subjectVariant: 2 }, 'before-optout-draft'); assert.equal(draft.status, 201, JSON.stringify(draft.body)); draftId = draft.body.data.id;
      const count = await db.emailEvent.count({ where: { leadId } }); mode = 'invalid';
      assert.equal((await request(`/leads/${leadId}/replies`, 'POST', { text: 'Tell me more.' }, 'bad-model-reply-0001')).status, 502); assert.equal(await db.emailEvent.count({ where: { leadId } }), count);
      const optout = await request(`/leads/${leadId}/replies`, 'POST', { text: 'Please unsubscribe me.' }, 'optout-reply-0001'); assert.equal(optout.body.data.status, 'SUPPRESSED'); assert.equal(optout.body.data.provider, 'opt-out-guard');
      assert.equal((await db.leadScore.findUniqueOrThrow({ where: { leadId } })).total, 0); assert.equal((await request(`/messages/${draftId}/send`, 'POST', {})).status, 409);
      assert.equal((await request(`/replies/${replyId}/review`, 'POST', { decision: 'approve', draft: 'Reviewed wording.' })).status, 409);
      assert.equal(await db.emailEvent.count({ where: { type: 'SENT' } }), 0);
      mode = 'normal'; const later = await request(`/leads/${leadId}/replies`, 'POST', { text: 'Interested now.' }, 'after-optout-reply'); assert.equal(later.body.data.status, 'SUPPRESSED'); assert.equal(later.body.data.draft, null);
    });
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    await db.$disconnect(); await connection.query(`DROP SCHEMA "${schema}" CASCADE`); await connection.end();
  }
});
