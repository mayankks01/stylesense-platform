import { cloneElement, useId, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from 'react';
import type { Page } from './api';

export function Empty({ title, children }: { title: string; children?: ReactNode }) { return <div className="empty"><span className="empty-icon" aria-hidden="true">↗</span><h3>{title}</h3><p>{children}</p></div>; }
export function Feedback({ error, retry }: { error?: string; retry?: () => void }) { return error ? <div className="notice error" role="alert">{error} {retry && <button onClick={retry}>Try again</button>}</div> : <p className="loading" role="status">Loading workspace data…</p>; }
export function Pager({ pagination, change }: { pagination: Page<unknown>['pagination']; change: (page: number) => void }) { return <div className="pager"><span>{pagination.total} records · Page {pagination.page} of {Math.max(1, pagination.pages)}</span><div className="actions"><button disabled={pagination.page <= 1} onClick={() => change(pagination.page - 1)}>Previous</button><button disabled={pagination.page >= pagination.pages} onClick={() => change(pagination.page + 1)}>Next</button></div></div>; }
export function Badge({ value }: { value: string }) { return <span className={`badge ${value.toLowerCase()}`}>{value.replaceAll('_', ' ')}</span>; }
export function Source({ url }: { url?: string | null }) { return url && /^https?:\/\//i.test(url) ? <a className="text-link" href={url} target="_blank" rel="noreferrer">View source ↗</a> : <span className="muted">No source recorded</span>; }
export function Json({ value, label = 'View recorded details' }: { value: unknown; label?: string }) { return <details><summary>{label}</summary><pre className="json">{JSON.stringify(value, null, 2)}</pre></details>; }
export function Field({ label, children }: { label: string; children: ReactElement<{ 'aria-labelledby'?: string }> }) {
  const id = useId();
  return <label className="field"><span id={id}>{label}</span>{cloneElement(children, { 'aria-labelledby': id })}</label>;
}
export function ActionForm({ action, children, submit = 'Save', done }: { action: (data: FormData) => Promise<unknown>; children: ReactNode; submit?: string; done?: () => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [success, setSuccess] = useState(false); const lock = useRef(false);
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (lock.current) return; lock.current = true; setBusy(true); setError(''); setSuccess(false);
    try { await action(new FormData(event.currentTarget)); setSuccess(true); done?.(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); lock.current = false; }
  }
  return <form onSubmit={onSubmit}><fieldset disabled={busy}>{children}<div className="actions form-actions"><button className="primary" type="submit">{busy ? 'Saving…' : submit}</button>{success && <span role="status">Saved successfully.</span>}</div></fieldset>{error && <div className="notice error" role="alert">{error}</div>}</form>;
}
export function Action({ run, children, disabled = false }: { run: () => Promise<unknown>; children: ReactNode; disabled?: boolean }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const lock = useRef(false);
  return <div className="action"><button disabled={disabled || busy} onClick={async () => { if (lock.current) return; lock.current = true; setBusy(true); setError(''); try { await run(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); lock.current = false; } }}>{busy ? 'Working…' : children}</button>{error && <p className="notice error" role="alert">{error}</p>}</div>;
}
export const text = (data: FormData, name: string) => String(data.get(name) ?? '').trim();
export const nullable = (data: FormData, name: string) => text(data, name) || null;
