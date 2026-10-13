import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createApp } from '../src/app.js';

async function withServer(check: () => Promise<void>, run: (base: string) => Promise<void>) {
  const server = createApp(check).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test('liveness remains healthy when readiness cannot reach the database; errors do not leak secrets', async () => {
  await withServer(async () => { throw new Error('postgres://private-secret'); }, async base => {
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, 'ok');
    const ready = await fetch(`${base}/api/ready`);
    assert.equal(ready.status, 503);
    const body = await ready.json();
    assert.equal(body.error.code, 'DATABASE_UNAVAILABLE');
    assert.equal(body.error.requestId, ready.headers.get('x-request-id'));
    assert(!JSON.stringify(body).includes('private-secret'));
  });
});

test('readiness reports a connected database and unknown routes return structured 404', async () => {
  await withServer(async () => {}, async base => {
    const ready = await fetch(`${base}/api/ready`);
    assert.equal(ready.status, 200);
    assert.equal((await ready.json()).database, 'connected');
    const missing = await fetch(`${base}/api/missing`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, 'NOT_FOUND');
  });
});

test('malformed JSON returns 400 without a stack trace', async () => {
  await withServer(async () => {}, async base => {
    const response = await fetch(`${base}/api/missing`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error.code, 'INVALID_JSON');
    assert.equal(body.error.stack, undefined);
  });
});
