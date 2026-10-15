# StyleSense AI — Lead Generation & Outreach Platform

StyleSense AI gives a salesperson one workflow to discover prospects, review source evidence, prepare grounded outreach, track engagement, classify replies, and prioritize leads. The application uses React, Node.js and PostgreSQL, with separate adapters for email delivery, LLM inference and web research.

> **Review status:** The complete local workflow is implemented and tested using explicit mock providers. OpenAI/Tavily and Resend adapters are included, but live discovery, live classification accuracy and a real sandbox delivery callback have not been verified. The default demo requires no external API keys.

## Features

- **Lead and campaign management:** sourced company/contact records, ICP criteria, campaign enrollment, pagination and filtering.
- **Protected workspace:** password authentication, database-backed sessions, CSRF protection and account-scoped data access.
- **Grounded outreach:** the Appendix A template, stored evidence for personalization, clean omission of unsupported sentences and persisted rejection logs.
- **Email lifecycle:** immutable message snapshots, explicit send confirmation, idempotent sending, separate acceptance/delivery events, tracking pixels and unsubscribe suppression.
- **Explainable ranking:** configurable fit and engagement scores from 0–100, immutable raw events and reproducible score history.
- **Research and reply assistance:** bounded search/fetch function calls, candidate evidence review, explicit import, simulated replies and editable response drafts for human approval.

Response approval records the reviewed wording; it does **not** send a response email.

## Architecture and design decisions

```text
React + TypeScript console
          │ same-origin REST API / session cookie
          ▼
Node.js + Express + TypeScript
          ├── Prisma + PostgreSQL
          ├── Email adapter: mock / Resend test recipients
          └── AI adapters: mock / OpenAI Responses + Tavily
```

TypeScript is used across the frontend and backend to keep implementation and contracts consistent. The API validates input, returns structured errors and paginates collection endpoints. Provider interfaces keep local verification deterministic while retaining explicit live integration paths.

The relational model connects users and sessions, companies and leads, campaigns and enrollments, message snapshots, raw email events, current scores and score history. Discovery runs, source evidence and reply analyses are persisted separately. Composite foreign keys enforce account consistency, and database constraints protect immutable events and history. Event ingestion and score updates commit atomically, with per-lead locking and transaction retries for concurrent writes.

Raw events are the audit trail; scores are derived state. Replay can recompute a current score, while saved inputs and configuration snapshots allow historical results to be reproduced. Provider acceptance is deliberately distinct from delivery, and duplicate callbacks cannot increase engagement scores.

The brief contains conflicting authentication instructions. This implementation follows the explicit requirement in Section 3.1 and secures business-data routes. Synchronous research is bounded by tool budgets and timeouts; a background queue is deferred, as permitted by the core scope.

### Repository layout

```text
apps/web/        React console and API client
apps/api/        Express API, authentication, scoring and provider adapters
prisma/          Relational schema and versioned migrations
config/          Scoring weights
examples/        Three researched emails and their source inputs
evaluation/      Labelled replies and recorded mock evaluation
docs/            API contracts, design details and verification notes
```

## Run locally

### Prerequisites

- Node.js 24 LTS, or Node.js 22.12+ within the 22 release line; npm.
- Docker Desktop with Linux containers for the supplied PostgreSQL service.
- PowerShell or a POSIX shell. On Windows, use `npm.cmd` if PowerShell blocks `npm.ps1`.

From a fresh clone, install dependencies and create local configuration files:

```sh
npm ci
```

**PowerShell:**

```powershell
Copy-Item .env.example .env
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/web/.env.example apps/web/.env
```

**macOS / Linux:**

```sh
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

Copy the examples only on first setup; preserve existing environment files on subsequent runs. Then initialize the database:

```sh
npm run db:generate
npm run db:up
npm run db:migrate
```

### Create a login

There is no shared default account or public registration. In the ignored `apps/api/.env`, set `BOOTSTRAP_EMAIL`, `BOOTSTRAP_NAME` and a unique `BOOTSTRAP_PASSWORD` of 12–128 characters, then run:

```sh
npm run user:create
```

Remove the bootstrap password from the environment file after creation. Existing accounts are never overwritten. Start the application and sign in with the account just created:

```sh
npm run dev
```

| Service | Local address |
| --- | --- |
| Console | http://127.0.0.1:5180 |
| API | http://127.0.0.1:4100/api |
| PostgreSQL | 127.0.0.1:55433 |

The frontend proxies `/api` to the backend. Keep `APP_ORIGIN`, frontend proxy settings and database credentials consistent if changing ports. `/api/health` checks the process; `/api/ready` checks database connectivity. Apply migrations before using business endpoints.

Stop the app with Ctrl+C and stop PostgreSQL with `npm run db:stop`. Database storage persists between runs; stopping the container does not delete records.

## Suggested review workflow

1. Sign in and create a campaign.
2. Open **Discovery**, enter an ICP and run synthetic discovery. Inspect a candidate's source/excerpt and synthetic label before importing it.
3. Open the lead's **Evidence** and **Outreach** tabs, enroll it in the campaign, preview subject variant 2, and review the grounding omissions.
4. Prepare the immutable draft, confirm the mock send and simulate mock delivery. Inspect the separate events in **Activity**.
5. In **Replies**, enter an interested response, inspect the classification, edit the draft and approve it without sending. Return to the ranked list and inspect the changed score and history.
6. Simulate an unsubscribe reply and verify suppression and a zero score.

## Scoring

Weights are centralized in [`config/scoring.json`](config/scoring.json).

| Component | Points |
| --- | ---: |
| Industry match | +20 |
| Region match | +10 |
| Company size within supplied bounds | +15 |
| Job title match | +15 |
| At least one open | +10 |
| Latest reply: interested | +30 |
| Latest reply: needs info | +20 |
| Latest reply: not now | 0 |
| Latest reply: wrong person | −20 |
| Unsubscribe or suppression | Final score = 0 |

Totals are clamped to 0–100. Unknown attributes earn no fit points; repeated opens contribute only once. The latest reply determines reply points, while unsubscribe remains dominant even after later positive replies. For example, full fit (60), an open (10) and an interested reply (30) produce 100. See [scoring and replay](docs/SCORING.md) for ordering, snapshots and concurrency behavior.

## Verification and evaluation

The latest full local verification passed:

| Check | Result |
| --- | --- |
| Unit/API tests | 21 passed |
| PostgreSQL integration | 25 scenarios passed; 28 tests including parents |
| Browser integration | 7 scenarios passed; 8 tests including parent |
| TypeScript checks and production builds | Passed |
| Compiled API readiness | Database connected |
| Researched email generation | 3 examples verified, including unsupported-claim omissions |

To reproduce, complete local setup and install the browser used by the tests:

```sh
npx playwright install chromium
npm run verify
```

On Windows, an existing Microsoft Edge installation can be used instead:

```powershell
$env:BROWSER_CHANNEL = 'msedge'
npm run verify
Remove-Item Env:BROWSER_CHANNEL
```

The verification command stops at the first failure. It runs typechecks, unit/API tests, database integration, browser integration, builds, sample-email freshness checks and mock reply evaluation. Database suites create and remove disposable schemas without modifying application records; the configured database role must be able to create schemas. Tests cover account isolation, validation, grounding rejection, malformed model output, duplicate events, provider failures, suppression, replay and console loading/error states.

### Classification result

The [eight hand-labelled replies](evaluation/replies.json) produced **8/8 correct (100%) with the deterministic mock classifier**, including the opt-out guard. The [recorded predictions and confusion matrix](evaluation/mock-results.json) identify the provider and model. This is a small smoke set, not a held-out benchmark or a live LLM accuracy result.

```sh
npm run evaluate:replies
# Requires privately configured OpenAI credentials and model:
npm run evaluate:replies -- --live
```

### Research-grounded email examples

[Three sample emails](examples/EMAILS.md) use public research for NIKE, adidas and Inditex. Each includes source links, a review date and omission notes. They are rendered through the actual Appendix A implementation from [stored research inputs](examples/research.json), rather than hand-written substitutes. Unsupported capability/relevance sentences and optional claims are omitted; the Inditex source is explicitly historical.

```sh
npm run examples:emails
```

The generator checks that an unsupported quantified benefit is omitted. API integration tests separately verify rejection and a persisted grounding log for unsupported evidence. No sample email is sent by this command.

## Provider configuration and safety

Default settings are `AI_MODE=mock` and `EMAIL_MODE=mock`. Live adapters require these private environment variables in `apps/api/.env`:

| Integration | Configuration |
| --- | --- |
| OpenAI + Tavily | `AI_MODE=openai`, `OPENAI_API_KEY`, `TAVILY_API_KEY`, `AI_MODEL` |
| Resend | `EMAIL_MODE=resend`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, public HTTPS `PUBLIC_BASE_URL`, provider-authorized `EMAIL_FROM` |

Restart the API after configuration changes. See [AI setup and limits](docs/ASSISTANCE.md) and [email setup and tracking](docs/EMAIL.md) for full instructions.

- Email recipients are restricted to `delivered+UUID@resend.dev`; researched contact addresses are never used for sending.
- Unsubscribe uses an inert confirmation GET and a suppression-writing POST. Future sends check suppression.
- Search/fetch tools reject private-network destinations and enforce response-size, redirect and time limits. Source text is treated as untrusted data.
- Grounding checks establish traceability to stored excerpts, not independent proof that a source is truthful; candidates require human review.
- Secrets remain outside Git and frontend bundles. Session cookies are HttpOnly and SameSite=Strict, with Secure enabled in production.

GDPR/CAN-SPAM considerations include consent, sender identity, opt-out, suppression and data minimization; these controls alone do not establish legal compliance. Tracking-pixel requests are engagement signals, not proof that a human read an email.

## Known limitations and next steps

- **Live verification remains pending:** no verified 5–10 lead OpenAI/Tavily discovery run, live classification evaluation, or real Resend sandbox send/public callback is included. Mock behavior and results are labelled explicitly.
- **Deployment:** a [deployment runbook](docs/DEPLOYMENT.md) is provided; public hosting has not been performed. The compiled frontend is in `apps/web/dist`, and `npm run start -w @stylesense/api` runs the compiled API.
- **Reply handling:** approval stores reviewed text only. Inbound email ingestion and sending approved response drafts are not implemented. Reply simulation is available in development and disabled in production.
- **Operational scope:** rate limits are in memory; no password recovery, shared rate-limit store or background job queue is included. A pg overlapping-query deprecation warning remains, although current tests pass.

With more time, the priority would be live-provider verification and the recorded demo, followed by queued jobs with retry/reconciliation, inbound reply ingestion, shared rate limiting and recovery flows. Optional click tracking and consent-aware follow-up rules would build on the existing event model. PostgreSQL JSONB already holds research/provider payloads, so a second database is unnecessary for this scope.

## Further documentation

- [API contracts and authentication](docs/API.md)
- [Scoring, event ordering and replay](docs/SCORING.md)
- [Email rendering, delivery and suppression](docs/EMAIL.md)
- [Discovery, provenance and reply review](docs/ASSISTANCE.md)
