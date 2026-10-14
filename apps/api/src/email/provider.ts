import { createHash } from 'node:crypto';

export type SendPayload = { id: string; from: string; to: string; subject: string; text: string; html: string; unsubscribeUrl: string };
export interface EmailProvider { readonly name: 'mock' | 'resend'; send(payload: SendPayload): Promise<{ id: string }> }
export class ProviderError extends Error {
  constructor(public code: string, public uncertain = false) { super(code); }
}
export const isTestRecipient = (address: string) => /^delivered(?:\+[a-z0-9-]+)?@resend\.dev$/.test(address);

export class ResendProvider implements EmailProvider {
  readonly name = 'resend' as const;
  constructor(private apiKey: string, private request: typeof fetch = fetch) {}
  async send(payload: SendPayload) {
    if (!isTestRecipient(payload.to)) throw new ProviderError('SANDBOX_RECIPIENT_REQUIRED');
    let response: Response;
    try {
      response = await this.request('https://api.resend.com/emails', {
        method: 'POST', signal: AbortSignal.timeout(8000),
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `stylesense/${payload.id}` },
        body: JSON.stringify({ from: payload.from, to: [payload.to], subject: payload.subject, text: payload.text, html: payload.html, headers: { 'List-Unsubscribe': `<${payload.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }),
      });
    } catch { throw new ProviderError('PROVIDER_TIMEOUT_OR_NETWORK', true); }
    if (!response.ok) throw new ProviderError(`PROVIDER_HTTP_${response.status}`, response.status >= 500 || response.status === 409);
    try {
      const data = await response.json() as { id?: unknown };
      if (typeof data.id !== 'string' || data.id.length > 128 || !data.id) throw new Error('Invalid provider ID');
      return { id: data.id };
    } catch { throw new ProviderError('PROVIDER_INVALID_RESPONSE', true); }
  }
}

export class MockProvider implements EmailProvider {
  readonly name = 'mock' as const;
  constructor(private failure: 'none' | 'reject' | 'timeout' = 'none') {}
  async send(payload: SendPayload) {
    if (!isTestRecipient(payload.to)) throw new ProviderError('SANDBOX_RECIPIENT_REQUIRED');
    if (this.failure === 'reject') throw new ProviderError('MOCK_REJECTED');
    if (this.failure === 'timeout') throw new ProviderError('MOCK_TIMEOUT', true);
    return { id: `mock-${createHash('sha256').update(payload.id).digest('hex').slice(0, 32)}` };
  }
}
