import assert from 'node:assert/strict';
import test from 'node:test';
import { checkIcp, discover, verifyCandidate } from '../src/ai/discovery.js';
import { fetchPublic, htmlText, publicIPv4, publicUrl, providerJson } from '../src/ai/network.js';
import { MockModel, MockResearch, OpenAIModel, TavilyResearch, mockCandidate, type AiOptions } from '../src/ai/providers.js';
import { classifyReply } from '../src/ai/replies.js';
const options: AiOptions = { model: new MockModel(), research: new MockResearch(), production: false };
const progress = () => ({ sources: [], trace: [], rejections: [], candidates: [] });
test('public fetch rejects local URLs, IP encodings, unsafe ports and private/reserved IPv4', async () => {
  for (const url of ['http://example.com', 'https://localhost', 'https://127.0.0.1', 'https://2130706433', 'https://0x7f000001', 'https://[::1]', 'https://example.com:444', 'https://user:pass@example.com', 'https://host.internal', 'https://example.com.']) assert.throws(() => publicUrl(url), url);
  for (const ip of ['0.0.0.0', '10.1.2.3', '127.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.1', '100.64.0.1', '192.0.2.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '::ffff:127.0.0.1']) assert.equal(publicIPv4(ip), false, ip);
  assert.equal(publicIPv4('93.184.216.34'), true);
  await assert.rejects(fetchPublic('https://example.com', AbortSignal.timeout(1000), (async () => [{ address: '127.0.0.1', family: 4 }]) as never), /Non-public/);
  assert.equal(htmlText('<script>secret</script><p>A &amp; B</p><style>hidden</style>'), 'A & B');
});
test('discovery fixtures call search/fetch and produce 5–10 explicitly synthetic candidates', async () => {
  const result = await discover({ industries: ['Apparel'], regions: [], titles: [] }, 10, options, AbortSignal.timeout(1000), progress());
  assert.equal(result.candidates.length, 10); assert.equal(result.sources.length, 10); assert.equal(result.sources.every(source => source.simulated), true);
  assert.equal(result.candidates.every(candidate => candidate.contact.email === null), true);
});
test('grounding rejects fabricated emails, borrowed identities, unsupported claims and partial numbers', async () => {
  const candidate = mockCandidate(1); const source = await options.research.fetch(candidate.facts[0]!.sourceUrl, AbortSignal.timeout(1000));
  assert.equal(verifyCandidate(candidate, [source]).verifiedFacts.length, 6);
  assert.throws(() => verifyCandidate({ ...candidate, contact: { ...candidate.contact, email: 'guessed@example.test' } }, [source]), /contact.email/);
  assert.throws(() => verifyCandidate({ ...candidate, company: { ...candidate.company, domain: 'other.example' } }, [source]), /company domain/);
  assert.throws(() => verifyCandidate({ ...candidate, outreach: [{ ...candidate.outreach[0], value: '80% improvement' }] }, [source]), /Unsupported/);
  assert.throws(() => verifyCandidate({ ...candidate, company: { ...candidate.company, size: 10 } }, [source]), /exact sourced number/);
  assert.throws(() => verifyCandidate(candidate, []), /Unsupported/);
});
test('live ICP checks reject known mismatches without inventing missing attributes', () => {
  const candidate = mockCandidate(1);
  assert.throws(() => checkIcp(candidate, { industries: ['Software'], regions: [], titles: [] }), /industry/);
  assert.throws(() => checkIcp(candidate, { industries: [], regions: [], titles: [], minCompanySize: 200 }), /size/);
  checkIcp({ ...candidate, company: { ...candidate.company, industry: null } }, { industries: ['Apparel'], regions: ['India'], titles: ['Buyer'] });
});
test('tool arguments, invented fetch URLs and runaway models fail closed', async () => {
  for (const [name, args] of [['delete_records', '{}'], ['search', '{bad'], ['fetch', '{"url":"https://example.com"}']]) {
    const model = { ...options.model, name: 'fixture', model: 'bad', simulated: true, async turn() { return [{ type: 'function_call', name, arguments: args, call_id: 'one' }]; } };
    await assert.rejects(discover({ industries: [], regions: [], titles: [] }, 5, { ...options, model }, AbortSignal.timeout(1000), progress()));
  }
  let i = 0;
  const model = { name: 'fixture', model: 'loop', simulated: true, async turn() { return [{ type: 'function_call', name: 'search', arguments: '{"query":"apparel"}', call_id: String(++i) }]; } };
  await assert.rejects(discover({ industries: [], regions: [], titles: [] }, 5, { ...options, model }, AbortSignal.timeout(1000), progress()), /budget/);
});
test('provider adapters send tool definitions without storage, and validate provider failures', async () => {
  const model = new OpenAIModel('test-key', 'configured-model', (async (url, init) => { assert.equal(url, 'https://api.openai.com/v1/responses'); const body = JSON.parse(String(init?.body)); assert.equal(body.store, false); assert.equal(body.parallel_tool_calls, false); assert.equal(body.model, 'configured-model'); return Response.json({ status: 'completed', output: [] }); }) as typeof fetch);
  assert.deepEqual(await model.turn('test', [], [], AbortSignal.timeout(1000)), []);
  const search = new TavilyResearch('test-key', options.research.fetch.bind(options.research), (async (_url, init) => { assert.equal(JSON.parse(String(init?.body)).include_raw_content, false); return Response.json({ results: [{ url: 'https://example.com/team', title: 'Team' }] }); }) as typeof fetch);
  assert.equal((await search.search('query', AbortSignal.timeout(1000))).length, 1);
  await assert.rejects(providerJson('https://example.com', 'key', {}, AbortSignal.timeout(1000), (async () => new Response('private provider details', { status: 429 })) as typeof fetch), /Provider request failed/);
  await assert.rejects(providerJson('https://example.com', 'key', {}, AbortSignal.timeout(1000), (async () => new Response('x'.repeat(524289))) as typeof fetch), /size limit/);
});
test('reply validation rejects malformed model output; explicit opt-outs bypass unavailable models', async () => {
  let calls = 0;
  const model = { name: 'fixture', model: 'bad', simulated: false, async turn() { calls++; return [{ type: 'function_call', name: 'classify_reply', arguments: '{"intent":"BUY_NOW"}', call_id: 'bad' }]; } };
  await assert.rejects(classifyReply('Tell me more', { firstName: 'A', company: 'B' }, { ...options, model }));
  const result = await classifyReply('Unsubscribe me now', { firstName: 'A', company: 'B' }, { ...options, model }); assert.equal(result.intent, 'UNSUBSCRIBE'); assert.equal(result.draft, null); assert.equal(calls, 1);
});
