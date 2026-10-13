# Step 3: authenticated backend and scoring

## Implemented

- Prisma 7 client, PostgreSQL schema and checked-in migration for users, sessions, companies, leads, campaigns, enrollment, message snapshots, raw events, current scores, score history, and suppression.
- Scrypt password hashing; account creation CLI; database-backed, expiring and revocable cookie sessions; origin/CSRF checks; login throttling.
- Validated, account-scoped company/lead/campaign APIs with filtering, bounded pagination, stable ranking and structured errors.
- Configurable fit/engagement scoring, atomic event ingestion and recomputation, persisted explanations, historical replay and durable suppression.
- Explicit opt-in development simulations to verify event behavior before real email integrations are built.

The frontend remains the Step 2 shell. Login screens and the sales console are scheduled for Step 5; authentication is available through the API now. No emails are sent in Step 3.

## Run this step

From the repository root, keep your existing `.env` files:

```powershell
npm ci
npm run db:generate
npm run db:up
npm run db:migrate
npm run typecheck
npm test
npm run test:integration
npm run build
npm run dev
```

Migration is additive to the empty Step 2 database; no reset is required. Re-running `db:migrate` is safe. `db:generate` must run after a fresh install because generated Prisma code is ignored by Git. The root `config/scoring.json` is a runtime asset: keep the monorepo layout when running the compiled API.

To create your account, privately add `BOOTSTRAP_EMAIL`, `BOOTSTRAP_NAME` and a unique `BOOTSTRAP_PASSWORD` (12–128 characters) to `apps/api/.env`, run `npm run user:create`, then remove the bootstrap password from that file. There is no seeded/default account. Do not paste credentials into chat or commit `.env`.

See [API usage](API.md) for endpoints and payloads and [scoring rules](SCORING.md) for weights and replay semantics. `APP_ORIGIN` defaults to `http://127.0.0.1:5180`; simulations default to off, so existing Step 2 environment files continue to work.

## Verification

Completed on 13 October 2026: Prisma generation, migration deployment (including a second no-op run), TypeScript checks, API/frontend builds, eight unit/API tests, and eight PostgreSQL integration scenarios all passed. The dependency installation audit reported zero vulnerabilities after the overrides were applied. A compiled API smoke check confirmed liveness, database readiness and rejection of unauthenticated lead access.

The Step 3 checks use real PostgreSQL, not an in-memory database. Integration tests create a randomly named `stylesense_test_...` schema, run the migration there, then remove only that test schema. The configured database role needs permission to create schemas for this local test command. Application records in the public schema are untouched.

Coverage includes: unauthenticated access, wrong passwords, hostile origin, missing CSRF, login throttling, rotation/logout/expiry, validation and uniqueness, cross-account reads/writes and foreign keys, duplicate campaign enrollment, concurrent event retries, conflicting deduplication keys, capped opens, reply intent scoring, company updates, score filtering, replay of every history snapshot, database score bounds, immutable events/history, and unsubscribe suppression after email correction.

Initial integration testing caught a raw-query schema-selection issue in isolated test schemas. The PostgreSQL pool now sets the validated schema as its search path, so raw row locks and generated queries use the same schema.

Prisma dependencies required patched transitive versions of `deepmerge-ts` and `mysql2`; root overrides pin those patched versions. Keep the overrides until the upstream tooling resolves them. The PostgreSQL driver currently emits an upstream query-queuing deprecation notice in integration tests; it does not fail tests, and pg remains on major version 8.

## GitHub push

```powershell
Set-Location -LiteralPath 'C:\Users\Mayank Singh\.codex\.chatgpt-projects\g-p-6aca42ae5fb881919def5c0720d937c4\stylesense-platform'
git status --short
git add .gitignore README.md package.json package-lock.json apps/api/ prisma/ config/ docs/
git diff --cached --stat
git diff --cached --name-only
git commit -m "feat: add secured lead management and scoring"
git push origin main
```

Only `.env.example` belongs in the commit. Actual `.env` files, generated Prisma output, build output and `node_modules` are ignored. No automatic commit or push is performed.
