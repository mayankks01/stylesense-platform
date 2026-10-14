import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { createHash } from 'node:crypto';

export const fingerprint = (text: string) => createHash('sha256').update(text).digest('hex');
export const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
export function publicUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || isIP(url.hostname) || !url.hostname.includes('.') || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname) || url.hostname.endsWith('.')) throw new Error('Only public HTTPS domain URLs are supported.');
  url.hash = ''; return url;
}
// Fetch is deliberately IPv4-only. Reject every non-public answer, then pin one address
// in the TLS request lookup so a second DNS lookup cannot rebind to a private network.
export function publicIPv4(address: string) {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number) as [number, number, number, number];
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
}
export function htmlText(html: string) {
  return normalize(html.replace(/<(script|style|noscript)[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&(?:nbsp|amp|lt|gt|quot|apos);/g, entity => ({ '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" })[entity]!).replace(/&#(x[\da-f]+|\d+);/gi, (_, code: string) => { const value = code.startsWith('x') ? parseInt(code.slice(1), 16) : Number(code); return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : ' '; }));
}
export type SourcePage = { url: string; text: string; fetchedAt: string; contentHash: string; simulated: boolean };
export async function fetchPublic(raw: string, signal: AbortSignal, resolve = lookup): Promise<SourcePage> {
  let url = publicUrl(raw);
  for (let redirects = 0; redirects <= 3; redirects++) {
    signal.throwIfAborted();
    const records = await Promise.race([resolve(url.hostname, { all: true, family: 4 }), new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error('DNS timeout')), 4000); timer.unref(); })]);
    if (!records.length || records.some(record => !publicIPv4(record.address))) throw new Error('Non-public source address rejected.');
    const address = records[0]!.address;
    const response = await new Promise<{ redirect?: string; text?: string }>((resolveResponse, reject) => {
      const req = request(url, { signal, timeout: 7000, family: 4, headers: { Accept: 'text/html,text/plain,application/xhtml+xml', 'Accept-Encoding': 'identity', 'User-Agent': 'StyleSenseResearch/1.0' }, lookup: (_hostname, _options, callback) => callback(null, address, 4) }, res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode ?? 0) && res.headers.location) { res.destroy(); resolveResponse({ redirect: res.headers.location }); return; }
        const type = res.headers['content-type']?.split(';')[0]?.trim();
        if (res.statusCode !== 200 || !['text/html', 'text/plain', 'application/xhtml+xml'].includes(type ?? '') || (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity')) { res.destroy(); reject(new Error('Source is not supported text content.')); return; }
        let size = 0; const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 262144) { res.destroy(); reject(new Error('Source exceeds size limit.')); } else chunks.push(chunk); });
        res.on('end', () => resolveResponse({ text: htmlText(Buffer.concat(chunks).toString('utf8')).slice(0, 20000) }));
        res.on('error', reject);
      });
      req.on('timeout', () => req.destroy(new Error('Source request timed out.'))); req.on('error', reject); req.end();
    });
    if (response.redirect) { url = publicUrl(new URL(response.redirect, url).toString()); continue; }
    const text = response.text ?? '';
    return { url: url.toString(), text, fetchedAt: new Date().toISOString(), contentHash: fingerprint(text), simulated: false };
  }
  throw new Error('Too many source redirects.');
}
export async function providerJson(url: string, key: string, body: unknown, signal: AbortSignal, transport: typeof fetch = fetch): Promise<unknown> {
  const response = await transport(url, { method: 'POST', redirect: 'error', signal, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok || !response.body) throw new Error('Provider request failed. Check credentials, quota and model availability.');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const item = await reader.read(); if (item.done) break; size += item.value.length; if (size > 524288) throw new Error('Provider response exceeds size limit.'); chunks.push(item.value); }
  } finally { await reader.cancel(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
