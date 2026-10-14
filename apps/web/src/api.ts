import { useEffect, useState } from 'react';

export type Session = { user: { id: string; name: string; email: string }; csrfToken: string; expiresAt: string };
export type Page<T> = { data: T[]; pagination: { page: number; pages: number; total: number; limit: number } };
export type Icp = { industries: string[]; regions: string[]; titles: string[]; minCompanySize?: number; maxCompanySize?: number };
export type Company = { id: string; name: string; domain: string; industry: string | null; region: string | null; size: number | null; sourceUrl: string | null };
export type Score = { total: number; fit: number; engagement: number; status: string };
export type Lead = { id: string; firstName: string; lastName: string; email: string | null; title: string | null; sourceUrl: string; company: Company; score: Score | null; icp: Icp };
export type Campaign = { id: string; name: string; description: string; icp: Icp; _count?: { leads: number } };
export type Evidence = { token: string; value: string; sourceUrl: string; excerpt: string };
export type Preview = { subject: string | null; body: string; sendable: boolean; issues: { token: string; reason: string; action: string }[]; provenance: Record<string, unknown> };
export type Message = { id: string; leadId: string; campaignId: string; subject: string; body: string; recipient: string; from: string; status: string; provider: string; simulated: boolean; attempts: number; lastError: string | null; createdAt: string; grounding?: Preview };
export type Event = { id: string; type: string; intent: string | null; source: string; occurredAt: string; payload: unknown };
export type History = Score & { id: string; previousTotal: number | null; reason: string; createdAt: string; config: unknown; inputs: unknown };

let csrf = '';
export const setSessionToken = (token: string) => { csrf = token; };
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function api<T>(path: string, options: { method?: string; body?: unknown; key?: string; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? 'GET', credentials: 'same-origin', cache: 'no-store',
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs ?? 30000)]) : AbortSignal.timeout(options.timeoutMs ?? 30000),
      headers: { ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...(options.key ? { 'Idempotency-Key': options.key } : {}) },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new Error('The server could not be reached. Check your connection and retry. A write may have completed; refresh before repeating it.');
  }
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/login') window.dispatchEvent(new window.Event('session-expired'));
    const fields = body?.error?.fields;
    const details = fields ? ` ${JSON.stringify(fields)}` : '';
    throw new ApiError(response.status, (body?.error?.message ?? `Request failed (${response.status}).`) + details);
  }
  if (!body) throw new Error('The server returned an unexpected response. Please retry.');
  return body as T;
}
// Clear old data immediately on a resource change and ignore late responses.
export function useResource<T>(path: string, revision = 0) {
  const [state, setState] = useState<{ key: string; data?: T; error?: string }>({ key: '' });
  const [attempt, retry] = useState(0);
  const key = `${path}:${revision}:${attempt}`;
  useEffect(() => {
    const controller = new AbortController();
    void api<T>(path, { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setState({ key, data }); }).catch((error: Error) => { if (!controller.signal.aborted) setState({ key, error: error.message }); });
    return () => controller.abort();
  }, [path, key]);
  return { data: state.key === key ? state.data : undefined, error: state.key === key ? state.error : undefined, retry: () => retry(n => n + 1) };
}
export const date = (value: string) => new Date(value).toLocaleString();
