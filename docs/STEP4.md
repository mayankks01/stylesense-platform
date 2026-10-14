# Step 4: grounded outreach, tracking and unsubscribe

## Implementation

- Fixed Appendix A subject/body renderer with stored-field provenance, clean optional omissions, unsupported-claim rejection and grounding logs.
- Immutable prepared messages with separate preview, prepare and explicit send actions.
- Real Resend adapter restricted to provider test recipients; explicit mock mode with rejection/timeout scenarios.
- Stable provider idempotency, persisted attempts/leases, uncertain-outcome handling and a bounded retry window.
- Separate accepted, delivered, opened and unsubscribed records, with score recomputation.
- Signed raw-body webhook verification, timestamp protection and event deduplication.
- Uncached pixel tracking, inert unsubscribe confirmation GET, idempotent opt-out POST, and suppression checks on every send.
- Additive migration for evidence, grounding logs and message lifecycle fields; no reset of prior data is required.

Read [EMAIL.md](EMAIL.md) for endpoints, configuration, provenance limits and provider setup. The frontend remains the initial shell; Step 5 builds the connected console. Step 4 does not include live inbound reply ingestion or automated follow-up sequences.

## Run and verify

Keep existing `.env` files. New settings have safe defaults; optional settings are documented in `apps/api/.env.example`.

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

The migration is additive. Integration suites apply all checked-in migrations to their own disposable schemas and use mock/injected HTTP transports; they do not send real email or touch application lead records.

## Verification status

On 14 October 2026, after Docker Desktop recovered, the additive migration applied successfully. All 14 unit/API tests, 17 database integration scenarios (19 passing tests including the two parent tests), TypeScript checks and both builds passed. Integration verification caught and resolved strict evidence parsing of database rows and parsing the webhook payload after signature verification.

The integration runner emits a PostgreSQL driver deprecation warning about overlapping queries on one client. It does not fail the checks with the installed driver; compatibility with a future pg 9 upgrade remains to be checked.

No Resend API key or webhook signing secret was configured. A live Resend test send and externally delivered callback are unverified. Local signed-webhook fixtures passed signature, timestamp, tampering and deduplication checks but do not replace that live check.

## Push this step to GitHub

The repository remains in its existing location even though this chat now belongs to the StyleSense project. An unrelated pre-existing untracked file is left untouched and is excluded by this explicit file list.

```powershell
Set-Location -LiteralPath 'C:\Users\Mayank Singh\.codex\.chatgpt-projects\g-p-6aca42ae5fb881919def5c0720d937c4\stylesense-platform'
git status --short
git add README.md docs/ apps/api/ prisma/ package-lock.json
git diff --cached --stat
git diff --cached --name-only
git commit -m "feat: add grounded outreach tracking and unsubscribe"
git push origin main
```

Actual `.env` files, generated Prisma code and dependencies remain ignored. No commit or push is performed automatically. Keep the live-provider limitation in this document until that check is completed.
