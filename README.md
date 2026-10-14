# StyleSense AI prospecting platform

An incremental implementation of the ThinkDatax Full Stack + AI Engineer assignment: discover grounded leads, prepare outreach, send to controlled test recipients, track engagement, classify simulated replies, and rank prospects.

## Current status

Steps 1–5 are implemented and locally verified. The connected React console includes sign-in, company and lead management, ranked filters, campaigns, grounded outreach, and event/score history. A live Resend send and public callback remain unverified pending provider configuration; see [Step 4](docs/STEP4.md). No deployment exists yet.

- [Requirements and acceptance criteria](docs/REQUIREMENTS.md)
- [Architecture and staged build plan](docs/BUILD_PLAN.md)
- [GitHub instructions for Step 1](docs/GITHUB.md)
- [Step 3 verification and GitHub push commands](docs/STEP3.md)
- [API documentation](docs/API.md)
- [Scoring weights and replay](docs/SCORING.md)
- [Email setup, grounding and tracking](docs/EMAIL.md)
- [Step 4 verification and GitHub commands](docs/STEP4.md)
- [Step 5 console guide, browser verification and GitHub commands](docs/STEP5.md)

The next step is tool-based lead discovery and reply assistance. Each stage ends with verification notes and Git commit instructions, followed by a pause for review.

## Run locally (PowerShell)

Prerequisites: Node.js 22.12+ within the 22 release line, or Node.js 24+, npm, and Docker Desktop running Linux containers. Vite's [Node requirements](https://vite.dev/guide/) and [Express 5 requirements](https://expressjs.com/en/guide/migrating-5/) inform the baseline. The lockfile pins installed dependency versions.

From this repository folder, on first setup:

```powershell
npm ci
Copy-Item .env.example .env
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/web/.env.example apps/web/.env
npm run db:generate
npm run db:up
npm run db:migrate
npm run dev
```

Do not overwrite existing `.env` files when returning to the project. The three local environment files have already been created in the original workspace and are ignored by Git.

Open http://127.0.0.1:5180. The API is at http://127.0.0.1:4100 and PostgreSQL uses host port 55433. Those ports avoid existing local services. The frontend proxies `/api` to the API; no cross-origin setup is needed for development. If you change the API port, update `apps/web/.env` too. If you change the database settings, update `apps/api/.env` to match the root `.env`.

The database volume is persistent. Changing its password environment variable does not change a password already initialized in that volume. Do not delete volumes containing data to resolve a configuration issue.

```powershell
npm run typecheck
npm run build
npm test
npm run test:integration
Invoke-RestMethod http://127.0.0.1:4100/api/health
Invoke-RestMethod http://127.0.0.1:4100/api/ready
```

`/api/health` checks the API process. `/api/ready` queries PostgreSQL and returns 503 if unavailable. These public endpoints expose no lead or campaign data. Readiness confirms connectivity, not schema migration state; always run `db:migrate` before using business endpoints.

Create your own account by privately adding `BOOTSTRAP_EMAIL`, `BOOTSTRAP_NAME`, and `BOOTSTRAP_PASSWORD` (12–128 characters) to `apps/api/.env`, then running `npm run user:create`. Remove the bootstrap password afterwards. Existing accounts are never overwritten. See [API documentation](docs/API.md) for session cookies, CSRF headers, and endpoint examples. No default account or password is included.

The integration test uses a unique disposable PostgreSQL schema and removes it after verification. It exercises authentication, ownership constraints, event deduplication, replay, suppression and score history without modifying application data.

Stop the app with Ctrl+C. Stop this project's database without deleting its data with `npm run db:stop`. The generated frontend is in `apps/web/dist`; the compiled API is in `apps/api/dist`. `npm run start -w @stylesense/api` runs the compiled API. Production hosting and frontend serving are deferred to Step 7.

On Windows, if PowerShell blocks `npm.ps1`, use `npm.cmd` in place of `npm`; no execution-policy change is necessary.

## Planned stack

React with TypeScript and Vite for the console; Node.js with TypeScript and Express for the REST API; PostgreSQL with Prisma 7 migrations and the PostgreSQL driver adapter for relational storage. A single TypeScript language across the application reduces switching overhead. Database-backed cookie sessions protect application data. The Prisma setup follows its [client configuration](https://www.prisma.io/docs/orm/v7/prisma-client/setup-and-configuration/introduction) and [PostgreSQL adapter](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql) documentation. External email, search, and LLM services will sit behind interfaces with explicit mock modes.

## Scope decisions

Step 4 defaults to explicit mock email mode and restricts the Resend adapter to provider test recipients. No real-person outreach is enabled. Before production, review applicable GDPR/CAN-SPAM obligations; this assignment implements identity, opt-out and suppression controls without claiming legal compliance.

- Include authentication: Section 3.1 requires it, despite the conflicting no-auth statement in Section 4.
- Finish core scope before optional queues, inbound email ingestion, click tracking, follow-up sequences, or a second database.
- Use only controlled recipient addresses or provider sandbox recipients for demonstrations. Researching a prospect is not permission to contact them.
- Treat submission instructions in the PDF as deliverable context; this project does not automatically email the assignment reviewer.
- Keep secrets in environment variables and never commit credentials, real lead exports, or private email content.

## Documentation to complete as implementation lands

Run commands, actual environment variable names, scoring configuration, API documentation, tests, measured classification accuracy, three research-grounded email examples, known limitations, and a 3–5 minute demo guide will be added in the relevant stages. No unrun evaluation result or simulated provider delivery will be presented as real.
