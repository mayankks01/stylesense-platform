import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import pg from 'pg';
import { chromium, type Browser } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { createApp } from '../../src/app.js';
import { createDatabase } from '../../src/db.js';
import { hashPassword } from '../../src/auth.js';
import { readConfig } from '../../src/config.js';
import { MockProvider } from '../../src/email/provider.js';
import { MockModel, MockResearch } from '../../src/ai/providers.js';
import { applyTestMigrations } from './migrations.js';

test('Connected console on a disposable PostgreSQL schema', { timeout: 180000 }, async t => {
  const schema = `stylesense_test_${randomUUID().replaceAll('-', '')}`;
  assert.match(schema, /^stylesense_test_[a-f0-9]{32}$/);
  const connection = new pg.Client({ connectionString: readConfig().DATABASE_URL });
  await connection.connect();
  const dbUrl = new URL(readConfig().DATABASE_URL); dbUrl.searchParams.set('schema', schema);
  const db = createDatabase(dbUrl.toString());
  let browser: Browser | undefined; let vite: ViteDevServer | undefined; let server: ReturnType<ReturnType<typeof createApp>['listen']> | undefined;
  const origin = 'http://127.0.0.1:5187';
  const screenshots = fileURLToPath(new URL('../../../../tmp/step5/', import.meta.url));
  try {
    await connection.query(`CREATE SCHEMA "${schema}"`); await connection.query(`SET search_path TO "${schema}"`); await applyTestMigrations(connection, schema);
    await db.user.create({ data: { email: 'console@example.test', name: 'Console Test', passwordHash: await hashPassword('console-test-password') } });
    server = createApp(async () => {}, db, { appOrigin: origin, production: false, allowSimulatedEvents: false }, { provider: new MockProvider(), publicBaseUrl: origin, from: 'StyleSense <onboarding@resend.dev>', senderName: 'Test sender', production: false }, { model: new MockModel(), research: new MockResearch(), production: false }).listen(0, '127.0.0.1');
    await once(server, 'listening'); const address = server.address(); assert(address && typeof address !== 'string');
    vite = await createServer({ configFile: false, root: fileURLToPath(new URL('../../../web/', import.meta.url)), server: { host: '127.0.0.1', port: 5187, strictPort: true, proxy: { '/api': `http://127.0.0.1:${address.port}` } } });
    await vite.listen();
    browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(12000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const button = (name: string) => page.getByRole('button', { name, exact: true });
    const nav = (name: string) => page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name });
    await mkdir(screenshots, { recursive: true });
    await t.test('login errors, empty state, session restoration and request recovery', async () => {
      await page.goto(origin); await page.getByLabel('Email address').fill('console@example.test'); await page.getByLabel('Password', { exact: true }).fill('wrong'); await button('Sign in').click();
      await page.getByRole('alert').filter({ hasText: 'Email or password is incorrect' }).waitFor();
      await page.getByLabel('Password', { exact: true }).fill('console-test-password'); await button('Sign in').click(); await page.getByText('Your pipeline starts with a person').waitFor();
      await page.reload(); await page.getByText('Your pipeline starts with a person').waitFor();
      await page.route('**/api/leads?*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Test database temporarily unavailable.' } }) }));
      await button('Refresh leads').click(); await page.getByRole('alert').filter({ hasText: 'temporarily unavailable' }).waitFor();
      await page.unroute('**/api/leads?*'); await button('Try again').click(); await page.getByText('Your pipeline starts with a person').waitFor();
      let release!: () => void; const paused = new Promise<void>(resolve => { release = resolve; });
      await page.route('**/api/leads?*', async route => { await paused; await route.continue(); });
      await button('Refresh leads').click(); await page.getByText('Loading workspace data…', { exact: true }).waitFor();
      release(); await page.getByText('Your pipeline starts with a person').waitFor(); await page.unroute('**/api/leads?*');
    });
    await t.test('create a sourced company and ranked leads through browser forms', async () => {
      await nav('Companies').click(); await button('+ Add company').click();
      for (const [label, value] of [['Company name', 'QA Apparel'], ['Domain', 'qa.example'], ['Industry', 'Apparel'], ['Region', 'India'], ['Company size', '100'], ['Company source URL', 'https://example.com/about']]) await page.getByLabel(label!, { exact: true }).fill(value!);
      await button('Save').click(); await page.getByRole('heading', { name: 'QA Apparel', exact: true }).waitFor();
      await nav('Leads').click();
      for (const [firstName, industry, region] of [['Avery', 'Apparel', ''], ['Blair', 'Apparel', 'India']]) {
        await button('+ Add lead').click(); await button('QA Apparel').click();
        await page.getByLabel('First name', { exact: true }).fill(firstName!); await page.getByLabel('Last name', { exact: true }).fill('Example'); await page.getByLabel('Job title', { exact: true }).fill('Buyer'); await page.getByLabel('Lead source URL', { exact: true }).fill('https://example.com/team');
        await page.getByText('Ideal customer profile · optional', { exact: true }).click(); await page.getByLabel('Target industries').fill(industry!); await page.getByLabel('Target regions').fill(region!);
        await button('Save').click(); await button(`${firstName} Example`).waitFor();
      }
      assert.match(await page.locator('tbody tr').first().innerText(), /Blair Example/);
      await page.getByLabel('Search contacts').fill('Missing'); await button('Apply filters').click(); await page.getByText('No leads match these filters').waitFor();
      await button('Reset').click(); await button('Avery Example').waitFor();
      await page.screenshot({ path: `${screenshots}/leads-desktop.png`, fullPage: true });
    });
    await t.test('campaign enrollment, blocked preview, evidence and explicit mock send', async () => {
      await nav('Campaigns').click(); await button('+ New campaign').click(); await page.getByLabel('Campaign name', { exact: true }).fill('QA outreach'); await button('Save').click(); await page.getByRole('heading', { name: 'QA outreach', exact: true }).waitFor();
      await nav('Leads').click(); await button('Avery Example').click(); await button('Outreach').click(); await button('QA outreach').click(); await button('Enroll lead in this campaign').click(); await page.getByText('Lead enrolled.', { exact: true }).waitFor();
      await button('Preview email').click(); await page.getByText('Subject requires evidence', { exact: true }).waitFor(); assert(await button('Prepare immutable draft').isDisabled());
      await button('Evidence').click(); await page.getByLabel('Evidence token').selectOption('pain_point_category'); await page.getByLabel('Claim value (must appear exactly in excerpt)').fill('overstock'); await page.getByLabel('Evidence source URL').fill('https://example.com/news'); await page.getByLabel('Supporting excerpt').fill('We are reducing overstock.'); await button('Save').click(); await page.getByRole('heading', { name: 'Saved evidence · 1' }).waitFor();
      await button('Outreach').click(); await button('QA outreach').click(); await button('Preview email').click(); await button('Prepare immutable draft').click(); await button('Review & send').waitFor();
      assert.equal(await db.emailEvent.count({ where: { type: 'SENT' } }), 0);
      await button('Review & send').click(); await button('Confirm mock send').click(); await page.getByText('ACCEPTED', { exact: true }).waitFor();
      assert.equal(await db.emailEvent.count({ where: { type: 'SENT' } }), 1); assert.equal(await db.emailEvent.count({ where: { type: 'OPENED' } }), 0, 'Preview must never load the tracking pixel');
      await button('Simulate mock delivery').click();
      await button('Activity').click(); await page.getByText('DELIVERED', { exact: true }).last().waitFor();
      await button('Score history').click(); await page.getByText(/^mock: delivered; fit/).waitFor();
    });
    await t.test('real API updates reorder the ranked list and evidence is visible in history', async () => {
      // Edit an actual sourced fit attribute through the UI: Avery gains title fit (20 -> 35), above Blair (30).
      await button('Overview').click(); await page.getByText('Ideal customer profile · optional', { exact: true }).click(); await page.getByLabel('Target job titles').fill('Buyer'); await button('Save').click();
      await page.locator('.score-large strong').filter({ hasText: '35' }).waitFor();
      await button('← All leads').click(); await button('Avery Example').waitFor(); assert.match(await page.locator('tbody tr').first().innerText(), /Avery Example/);
      await button('Avery Example').click(); await button('Score history').click(); await page.getByText(/^Lead attributes updated; fit/).waitFor();
      await page.screenshot({ path: `${screenshots}/history-desktop.png`, fullPage: true });
    });
    await t.test('pagination and combined filters use server results', async () => {
      const company = await db.company.findFirstOrThrow();
      for (let i = 0; i < 10; i++) await db.lead.create({ data: { ownerId: company.ownerId, companyId: company.id, firstName: `Fixture${i}`, lastName: 'Pagination', sourceUrl: 'https://example.com/fixture', icp: { industries: [], regions: [], titles: [] }, score: { create: { total: 0, fit: 0, engagement: 0, status: 'NEW', configVersion: 'pagination-fixture' } } } });
      await button('← All leads').click(); await page.getByText('12 records · Page 1 of 2', { exact: true }).waitFor(); assert.equal(await page.locator('tbody tr').count(), 10);
      await button('Next').click(); await page.getByText('12 records · Page 2 of 2', { exact: true }).waitFor(); assert.equal(await page.locator('tbody tr').count(), 2);
      await page.getByLabel('Status', { exact: true }).selectOption('DELIVERED'); await page.getByLabel('Minimum score').fill('35'); await button('Apply filters').click();
      await page.getByText('1 records · Page 1 of 1', { exact: true }).waitFor(); assert.match(await page.locator('tbody').innerText(), /Avery Example/);
      await button('Reset').click(); await button('Avery Example').click();
    });
    await t.test('full mock lifecycle: discovery, import, send, delivery, open, reply, approval, ranking and opt-out', async () => {
      await nav('Discovery').click(); await button('Run synthetic discovery').click(); await page.getByRole('heading', { name: 'Review discovered candidates', exact: true }).waitFor();
      assert.equal(await button('Import synthetic lead').count(), 5);
      await button('Import synthetic lead').first().click(); await button('Open imported lead').click();
      await button('Evidence').click(); await page.getByRole('heading', { name: 'Imported research provenance', exact: true }).waitFor(); await page.getByText('Review field evidence · 6 facts', { exact: true }).click(); await page.getByText('Synthetic fixture ·', { exact: false }).first().waitFor();
      await page.screenshot({ path: `${screenshots}/research-desktop.png`, fullPage: true });
      const imported = await db.lead.findFirstOrThrow({ where: { discoveryKey: { not: null } } });
      await button('Outreach').click(); await button('QA outreach').click(); await button('Enroll lead in this campaign').click(); await page.getByText('Lead enrolled.', { exact: true }).waitFor();
      await button('Preview email').click(); await button('Prepare immutable draft').click(); await button('Review & send').click(); await button('Confirm mock send').click(); await page.getByText('ACCEPTED', { exact: true }).waitFor();
      await button('Simulate mock delivery').click(); await button('Activity').click(); await page.getByText('DELIVERED', { exact: true }).last().waitFor();
      const sent = await db.emailMessage.findFirstOrThrow({ where: { leadId: imported.id } });
      const pixel = new URL(sent.html.match(/src="([^"]+)"/)![1]!);
      assert.equal((await page.request.get(origin + pixel.pathname)).status(), 200);
      assert.equal(await db.emailEvent.count({ where: { leadId: imported.id, type: 'OPENED' } }), 1);
      await button('Replies').click(); await page.getByLabel('Simulated reply text').fill("Interested. Let's schedule a call."); await button('Classify simulated reply').click(); await button('Approve draft without sending').waitFor();
      const messagesBefore = await db.emailMessage.count(); await page.getByLabel('Response draft for human review').fill('Thank you. What time works for a conversation?'); await button('Approve draft without sending').click(); await page.getByText('APPROVED', { exact: true }).waitFor(); assert.equal(await db.emailMessage.count(), messagesBefore);
      const scored = await db.leadScore.findUniqueOrThrow({ where: { leadId: imported.id } });
      assert.equal(scored.total, scored.fit + 40);
      await button('← All leads').click(); assert.match(await page.locator('tbody tr').first().innerText(), new RegExp(imported.firstName));
      await button(`${imported.firstName} ${imported.lastName}`).click(); await button('Replies').click(); await page.getByText('APPROVED', { exact: true }).waitFor();
      await page.screenshot({ path: `${screenshots}/reply-desktop.png`, fullPage: true });
      await page.getByLabel('Simulated reply text').fill('Please unsubscribe me.'); await button('Classify simulated reply').click(); await page.locator('.score-strip').getByText('UNSUBSCRIBED', { exact: true }).waitFor(); assert.equal(await button('Approve draft without sending').count(), 0);
      await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: `${screenshots}/reply-mobile.png`, fullPage: true }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      await button('← All leads').click(); await button('Avery Example').click();
    });
    await t.test('mobile layout, logout and expiry remove private workspace', async () => {
      await page.setViewportSize({ width: 390, height: 844 }); await button('← All leads').click(); await button('Avery Example').waitFor();
      await page.screenshot({ path: `${screenshots}/leads-mobile.png`, fullPage: true });
      const overflow = await page.evaluate(() => ({ width: window.innerWidth, scroll: document.documentElement.scrollWidth, elements: [...document.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > window.innerWidth).map(el => `${el.tagName}.${el.className}`).slice(0, 15) }));
      assert(overflow.scroll <= overflow.width, `Mobile overflow: ${JSON.stringify(overflow)}`);
      await button('Sign out').click(); await button('Sign in').waitFor(); assert.equal(await page.getByRole('navigation', { name: 'Workspace', exact: true }).count(), 0);
      await page.getByLabel('Email address').fill('console@example.test'); await page.getByLabel('Password', { exact: true }).fill('console-test-password'); await button('Sign in').click(); await button('Avery Example').waitFor();
      await db.session.deleteMany(); await button('Refresh leads').click(); await button('Sign in').waitFor(); assert.equal(await page.getByRole('navigation', { name: 'Workspace', exact: true }).count(), 0);
      await page.screenshot({ path: `${screenshots}/login-mobile.png`, fullPage: true });
      assert.deepEqual(errors, []);
    });
  } finally {
    await browser?.close(); await vite?.close();
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    await db.$disconnect(); await connection.query(`DROP SCHEMA "${schema}" CASCADE`); await connection.end();
  }
});
