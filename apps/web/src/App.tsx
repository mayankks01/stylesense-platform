import { useEffect, useState } from 'react';

type Status = 'checking' | 'connected' | 'unavailable';
async function check(path: string, signal: AbortSignal): Promise<Status> {
  try {
    const response = await fetch(path, { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
    const body: unknown = await response.json();
    return response.ok && typeof body === 'object' && body !== null && 'status' in body && body.status === 'ok' ? 'connected' : 'unavailable';
  } catch { return 'unavailable'; }
}

export function App() {
  const [attempt, setAttempt] = useState(0);
  const [api, setApi] = useState<Status>('checking');
  const [database, setDatabase] = useState<Status>('checking');
  useEffect(() => {
    const controller = new AbortController();
    setApi('checking'); setDatabase('checking');
    void Promise.all([check('/api/health', controller.signal), check('/api/ready', controller.signal)]).then(([a, d]) => {
      if (!controller.signal.aborted) { setApi(a); setDatabase(d); }
    });
    return () => controller.abort();
  }, [attempt]);
  const checking = api === 'checking' || database === 'checking';
  return (
    <div className="layout">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="StyleSense AI home"><span className="brand-mark">S</span><span>StyleSense <small>AI</small></span></a>
        <div className="sidebar-label">SALES WORKSPACE</div>
        <nav aria-label="Workspace"><a className="active" href="#overview" aria-current="page"><span>◈</span> Overview</a></nav>
        <div className="sidebar-foot"><span className="dot" /> Local workspace<small>Foundation · Step 2 of 7</small></div>
      </aside>
      <main id="overview">
        <header><span>Workspace <span className="slash">/</span> Overview</span><span className="badge">Development</span></header>
        <section className="intro"><p className="eyebrow">A MORE THOUGHTFUL WAY TO PROSPECT</p><h1>Your next conversation<br />starts here.</h1><p>Discover the right fashion brands. Reach out with context.<br className="desktop-break" /> Keep every opportunity in view.</p></section>
        <section className="connection" aria-labelledby="connection-title">
          <div><h2 id="connection-title">Workspace connection</h2><p>Live checks for your local services.</p></div>
          <div className="service-status" role="status" aria-live="polite"><StatusPill name="API" value={api} /><StatusPill name="Database" value={database} /></div>
          <button onClick={() => setAttempt(value => value + 1)} disabled={checking}>{checking ? 'Checking…' : 'Check again'}</button>
        </section>
        {(api === 'unavailable' || database === 'unavailable') && <p className="notice" role="alert">{api === 'unavailable' ? 'The API is not responding. Start the application services and check again.' : 'The API is online, but the database is unavailable. Start PostgreSQL and check the database configuration.'}</p>}
        <section className="pipeline" aria-labelledby="pipeline-title"><div className="section-heading"><h2 id="pipeline-title">From discovery to conversation</h2><span>Your workflow, taking shape</span></div><div className="cards">
          <Feature number="01" title="Find your fit" text="Discover prospects from your ideal customer profile, backed by research." tag="Discovery" />
          <Feature number="02" title="Make it relevant" text="Prepare grounded outreach and follow the signals that matter." tag="Campaigns" />
          <Feature number="03" title="Know who’s ready" text="Turn engagement into a ranked list of your next best conversations." tag="Lead scoring" />
        </div></section>
        <section className="empty"><div className="empty-icon" aria-hidden="true">↗</div><h2>A fresh start for your pipeline</h2><p>The workspace foundation is ready. Lead management and authentication<br className="desktop-break" /> arrive in Step 3; your connected sales console follows in Step 5.</p><span className="empty-tag">No lead data connected yet</span></section>
        <footer>STYLESENSE AI<span>Built for better fashion decisions.</span></footer>
      </main>
    </div>
  );
}
function StatusPill({ name, value }: { name: string; value: Status }) {
  return <span className={`status ${value}`}><span className="dot" />{name}: {value}</span>;
}
function Feature({ number, title, text, tag }: { number: string; title: string; text: string; tag: string }) {
  return <article className="card"><span className="step">{number}</span><span className="tag">{tag}</span><h3>{title}</h3><p>{text}</p><span className="planned">Planned for an upcoming step</span></article>;
}
