import test from 'node:test';
import assert from 'node:assert/strict';
import { emailHtml, renderTemplate, type TemplateInput } from '../src/email/template.js';
import { MockProvider, ProviderError, ResendProvider, type SendPayload } from '../src/email/provider.js';

const input: TemplateInput = {
  firstName: 'Avery', leadSourceUrl: 'https://example.com/team', companyName: 'Example Apparel', companySourceUrl: 'https://example.com/about', senderName: 'Jordan',
  evidence: [
    { token: 'observed_signal_short', value: 'new collection', sourceUrl: 'https://example.com/news', excerpt: 'Our new collection is available.' },
    { token: 'observed_signal_sentence', value: 'your new collection is available', sourceUrl: 'https://example.com/news', excerpt: 'your new collection is available' },
    { token: 'company_segment', value: 'retail', sourceUrl: 'https://example.com/about', excerpt: 'Our retail team' },
    { token: 'pain_point_category', value: 'overstock', sourceUrl: 'https://example.com/news', excerpt: 'We are reducing overstock.' },
  ],
};
test('Appendix A skeleton, three subject variants, omissions and configured time window', () => {
  const result = renderTemplate(input, 2);
  assert.equal(result.subject, 'Cutting overstock at Example Apparel');
  assert.match(result.body, /^Hi Avery,/); assert.match(result.body, /I noticed your new collection is available\./);
  assert.match(result.body, /At StyleSense AI, we help apparel and fashion retail teams improve planning with AI demand forecasting\./);
  assert.match(result.body, /Would you be open to a 15-minute call to see if it’s a fit\?/);
  assert.match(result.body, /Best,\nJordan\nStyleSense AI$/);
  assert(!result.body.includes('P.S.')); assert(!result.body.includes('Given')); assert(!result.body.includes('{{'));
  assert.equal(renderTemplate(input, 1).subject, 'Example Apparel’s new collection - quick question');
  assert.equal(renderTemplate(input, 3).subject, 'Avery, saw new collection');
  assert.match(renderTemplate({ ...input, proposedTimeWindow: 'next week' }, 2).body, /call next week to see/);
});
test('unverifiable claims cannot enter the rendered email, and unsupported subjects block sending', () => {
  const bad = renderTemplate({ ...input, evidence: [...input.evidence, { token: 'quantified_outcome_optional', value: 'cut costs by 80%', sourceUrl: 'https://example.com', excerpt: 'No quantified outcome is available.' }] }, 2);
  assert(!bad.body.includes('80%')); assert(bad.issues.some(issue => issue.token === 'quantified_outcome_optional'));
  assert.equal(renderTemplate({ ...input, evidence: [] }, 2).sendable, false);
  assert.equal(renderTemplate({ ...input, firstName: 'Avery\r\nBcc: other@example.com' }, 2).sendable, false);
});
test('HTML escapes researched text and uses separate capability links', () => {
  const html = emailHtml('Hi <script>alert(1)</script>,\n\nBest,\nA & B', 'https://example.com/unsubscribe/token', 'https://example.com/open/token.gif');
  assert(!html.includes('<script>')); assert(html.includes('&lt;script&gt;')); assert(html.includes('A &amp; B'));
  assert.match(html, /width="1" height="1"/); assert.match(html, /Unsubscribe from StyleSense AI/);
});
const payload: SendPayload = { id: 'example-message', from: 'onboarding@resend.dev', to: 'delivered+test@resend.dev', subject: 'Example', text: 'Example', html: '<p>Example</p>', unsubscribeUrl: 'https://example.com/unsubscribe' };
test('mock is deterministic and exposes realistic rejection/uncertain failure modes', async () => {
  const provider = new MockProvider();
  assert.deepEqual(await provider.send(payload), await provider.send(payload));
  await assert.rejects(new MockProvider('reject').send(payload), (error: unknown) => error instanceof ProviderError && !error.uncertain);
  await assert.rejects(new MockProvider('timeout').send(payload), (error: unknown) => error instanceof ProviderError && error.uncertain);
});
test('Resend adapter uses stable idempotency and never accepts a real-person recipient', async () => {
  let calls = 0;
  const request = (async (url: string | URL | Request, options?: RequestInit) => {
    calls++; assert.equal(url, 'https://api.resend.com/emails');
    assert.equal((options!.headers as Record<string, string>)['Idempotency-Key'], 'stylesense/example-message');
    const body = JSON.parse(options!.body as string); assert.deepEqual(body.to, [payload.to]); assert.equal(body.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    return new Response(JSON.stringify({ id: 'provider-id' }), { status: 200 });
  }) as typeof fetch;
  const provider = new ResendProvider('test-key-not-real', request);
  assert.deepEqual(await provider.send(payload), { id: 'provider-id' });
  await assert.rejects(provider.send({ ...payload, to: 'person@example.com' })); assert.equal(calls, 1);
});
test('Resend adapter distinguishes rejection from ambiguous network/provider failure', async () => {
  const rejected = new ResendProvider('test', (async () => new Response('{}', { status: 422 })) as typeof fetch);
  await assert.rejects(rejected.send(payload), (error: unknown) => error instanceof ProviderError && error.code === 'PROVIDER_HTTP_422' && !error.uncertain);
  const unavailable = new ResendProvider('test', (async () => { throw new Error('secret network detail'); }) as typeof fetch);
  await assert.rejects(unavailable.send(payload), (error: unknown) => error instanceof ProviderError && error.uncertain && !error.message.includes('secret'));
});
