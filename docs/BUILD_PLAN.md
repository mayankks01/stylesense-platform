# Staged build plan

Steps 1 through 6 are implemented and locally verified. See [Step 6](STEP6.md) for discovery, reply review and evaluation. Live real-lead discovery, LLM evaluation, and Resend send/public callback checks remain pending provider configuration. Stop after each step, report verification and limitations, provide GitHub commands, and await the user's instruction to continue. Do not deploy during an intermediate stage.

| Step | Deliverable | Verification before pausing | Suggested commit |
| --- | --- | --- | --- |
| 1 | Requirements, architecture proposal, and GitHub guide | Cross-check all four PDF pages, distinguish core from stretch, record ambiguity | docs: define assignment scope and phased build plan |
| 2 | Frontend/backend workspace, environment examples, PostgreSQL development setup, health endpoint, initial app shell | Dependencies install, TypeScript checks and builds pass, API health works; report any missing local services | chore: scaffold frontend backend and database setup |
| 3 | Database migrations, authentication, validated leads/campaigns/events APIs, pagination, scoring and history | Apply migrations; test authentication, isolation, API errors, scoring limits and replay | feat: add secured lead management and scoring |
| 4 | Appendix A renderer and grounding guard, sandbox email integration, delivery/open tracking and suppression | Verify template omissions, unsupported-claim rejection, duplicate events, provider failure and suppression; distinguish live from mock evidence | feat: add grounded outreach tracking and unsubscribe |
| 5 | React sales console wired to APIs: login, filters, ranked leads, campaign composition and event/score history | Exercise loading, empty and error states; confirm ranking changes from real API data; mobile layout review | feat: build connected prospecting console |
| 6 | Tool-based lead discovery, evidence persistence, reply simulation, classification and human-review drafts, labelled evaluation | Find 5–10 sourced leads when service credentials are available; test malformed tool/model responses; run labelled evaluation and report accuracy | feat: add grounded discovery and reply assistance |
| 7 | Full lifecycle validation, three researched sample emails, finished README, demo recording guide and deployment preparation | Run full tests/build, reproduce lifecycle, document remaining blockers and actual provider configuration | docs: complete verification and submission package |

## Architecture proposal

React console → authenticated Node/Express API → PostgreSQL.

The API calls provider interfaces for email delivery, LLM inference, and web search/fetch. Tracking and unsubscribe routes expose only narrow token-based operations. Provider callbacks validate signatures. Application data routes always require authentication.

Planned layout:

```text
apps/web/             React + TypeScript console
apps/api/             Express API and integration adapters
packages/shared/      Shared schemas and types where useful
prisma/               PostgreSQL schema and migrations
config/               Versioned scoring weights
evaluation/           Hand-labelled replies and evaluation runner
examples/             Research-grounded sample email deliverables
docs/                 Architecture, verification, and GitHub guides
```

Use secure, HttpOnly session cookies, server-side session storage, password hashing, and CSRF protection for state-changing requests. Account ownership scopes business records. Public tracking tokens must be unguessable and must not expose email addresses.

## Proposed data relationships

| Record | Purpose and relationships |
| --- | --- |
| User / Session | Account and revocable, expiring sessions; private records belong to an account. |
| Company | Company identity, domain, industry, geography, size, and researched attributes. |
| Lead | Prospect linked to company and owner; optional verified email, title, source URL, and grounded attributes. Discovery does not require guessing an email. |
| Evidence | Source URL, extracted supporting text, retrieval time, field association, and provenance for lead/company claims. |
| Campaign / CampaignLead | Campaign ICP/template settings and explicit unique enrollment per lead. |
| Message | Rendered subject/body snapshot, recipient used for testing, campaign/lead reference, provider ID, send state, idempotency key. Preserve researched contact separately from sandbox delivery address. |
| EmailEvent | Append-only event type, occurrence/receipt timestamps, message/lead reference, provider deduplication key, and raw JSON payload. |
| LeadScore / ScoreHistory | Current score and its versioned configuration; immutable changes include component breakdown, reason, and triggering event. |
| Suppression | Normalized email and account scope, reason, timestamp; checked immediately before every outbound send. |
| ReplyAnalysis | Simulated reply event, intent, model metadata, response draft, and human approval status. |

Use transactions to keep event ingestion and derived state consistent. Repeated webhook events do not increase scores. Repeat pixel hits can remain raw events while open engagement is capped. Fit uses known ICP matches; unknown attributes do not earn full-match points. Configure explicit treatment of negative reply intent and suppression. Exact weights will be introduced and tested in Step 3.

## Planned API groups

- Authentication: login, logout, current user.
- Leads: list/filter/sort, create, inspect, update; score history and events.
- Campaigns: create/list/update, enroll leads, preview grounded emails, explicit sandbox send.
- Discovery: accept ICP, invoke bounded search/fetch tools, validate and persist results.
- Replies: simulate, classify, review draft, approve an explicit response action.
- Public narrow routes: pixel, unsubscribe, signed provider callback.

Use bounded pagination and stable ordering, schema validation, structured errors, request size limits, and rate limits on sensitive endpoints. Fetch tools must reject private-network URLs, unsafe redirects, oversized bodies, and unsupported content types. Treat web text as untrusted evidence, never tool instructions.

## Provider and deployment decisions

Select exact SDK versions and provider APIs against current official documentation when implementing each integration. A provider account, sandbox configuration, and LLM/search credentials may be needed for live checks; never request secrets in chat. Add them locally through environment variables.

The required PostgreSQL/Node architecture determines deployment needs. Choose a compatible host at the final stage; do not replace durable PostgreSQL storage with a browser-only demo to accommodate a hosting tool.
