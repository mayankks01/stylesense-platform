# Deployment preparation

Prepared architecture: one Linux host with Node 24, a TLS reverse proxy serving `apps/web/dist`, and a private managed PostgreSQL database. No host, domain, paid service, or deployment has been created. Use a single API instance initially: login/provider rate limits are in-memory, and discovery runs synchronously (up to 90 seconds).

## Build and release

1. Provision PostgreSQL with TLS and backups; keep it off the public application network. Use a dedicated database role and preserve the full repository directory structure (runtime scoring reads `config/scoring.json`).
2. Copy the release to a new directory. Install from lockfile with `npm ci` including development dependencies: Prisma generation/migrations and bootstrap use them. Provide `apps/api/.env` privately with mode 600 owned by the service user. Never bake secrets into the frontend or commit them.
3. Run `npm run db:generate`, `npm run typecheck`, and `npm run build`. Back up the database, then run `npm run db:migrate` once as a release action. Do not use the local Docker database or its default password for public hosting.
4. Run `npm run user:create` once with private bootstrap variables; remove the bootstrap password afterwards. An existing account is never overwritten.
5. Run `npm run start -w @stylesense/api` under a service supervisor with repository root as working directory, automatic restart and SIGTERM shutdown. Bind the API to `127.0.0.1:4100`. The app start script reads `apps/api/.env` because npm changes into the workspace directory.
6. Configure your TLS proxy to serve `apps/web/dist` and forward **all `/api/*` paths unchanged** to port 4100, including public tracking/unsubscribe and raw webhook bodies. Use a response timeout above 90 seconds (120 seconds recommended). Do not use Vite's development server for public hosting.

## Production environment

Set these privately; placeholder values below are descriptions, not runnable credentials:

| Variable | Required value |
| --- | --- |
| NODE_ENV | production |
| HOST / PORT | 127.0.0.1 / 4100 behind a same-host proxy |
| DATABASE_URL | Private PostgreSQL connection URL with provider-required TLS settings |
| APP_ORIGIN | Exact public HTTPS origin, without trailing slash |
| PUBLIC_BASE_URL | Same public HTTPS origin, without trailing slash |
| ALLOW_SIMULATED_EVENTS | false |
| EMAIL_MODE / EMAIL_MOCK_FAILURE | resend / none |
| EMAIL_FROM / EMAIL_SENDER_NAME | Provider-authorized identity / actual demo sender name |
| RESEND_API_KEY / RESEND_WEBHOOK_SECRET | Private provider credentials |
| AI_MODE / AI_MODEL | openai / an enabled Responses function-calling model |
| OPENAI_API_KEY / TAVILY_API_KEY | Private provider credentials |

Production validation rejects mock providers. Reply simulation is disabled in production, so the complete assignment demo belongs in the local development environment. The email recipient restriction remains `delivered+UUID@resend.dev` even in production; this is still an assignment sandbox, not general outbound marketing software.

## Proxy requirements and release checks

- Serve UI and API on the same origin. Cookies are HttpOnly, Secure in production and SameSite=Strict; mutation requests must carry that exact Origin plus the CSRF token. Do not rewrite cookies or cache API responses.
- Preserve webhook signatures and raw bodies. Register `/api/webhooks/resend` with Resend, then verify a real signed delivery callback. Provider acceptance alone is not delivery.
- Do not trust arbitrary forwarded-IP headers. The current app does not enable proxy trust: behind a proxy, in-memory IP rate limits may be shared by all users. This is acceptable only for a small controlled demo; trusted-hop configuration and shared rate limits are deployment follow-up work for larger use.
- Check `/api/health`, `/api/ready`, login/logout, secure cookies, a protected endpoint without a session, preview, test-recipient send, signed delivery callback, explicit tracking pixel request, and unsubscribe confirmation/POST. Check static JS/CSS content types and HTTPS navigation.
- Confirm database backups can be restored before exposing the service. Retain the prior code release for rollback. Roll code back only if compatible with the migrated schema; do not delete tables or reset the database. Restore a backup to a separate database and validate before switching traffic if a data rollback is needed.

No production TLS/proxy/provider checks have been executed. Local tests and compiled builds do not certify a deployment. A hosting-specific configuration should be validated after a host and domain are chosen.

## Remaining operational limits

No password recovery or public registration, no inbound reply ingestion, no queued jobs, no automatic response sending, no centralized rate-limit store. Crashed discovery runs remain auditable RUNNING records and need a new run after the stale interval. Retention/deletion policy and access to source excerpts need review before using private customer data. See [email limits](EMAIL.md) and [AI limits](ASSISTANCE.md).
