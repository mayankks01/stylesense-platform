# Step 3 API

Base URL: `http://127.0.0.1:4100/api`. The Vite development proxy exposes the same `/api` paths on port 5180.

## Authentication

Create an account with the local `npm run user:create` command, after setting the three `BOOTSTRAP_` variables in `apps/api/.env`. There is no public registration endpoint or default password. Passwords are hashed with salted scrypt (N=32768, r=8, p=1). Account provisioning refuses to overwrite existing users.

| Method | Path | Behavior |
| --- | --- | --- |
| POST | `/auth/login` | JSON `{email,password}`. Returns user, CSRF token and expiry; sets an HttpOnly, SameSite=Strict session cookie. |
| GET | `/auth/me` | Returns current user, CSRF token and expiry; requires the session cookie. |
| POST | `/auth/logout` | Revokes the current session and clears the cookie. |

All writes, including login, require `Origin: http://127.0.0.1:5180`, matching `APP_ORIGIN`. Authenticated writes additionally require `X-CSRF-Token` from login or `/auth/me`. Browser clients should use same-origin `/api` requests and cookie credentials. Read endpoints cannot modify business records. Session expiration cleanup may run during authentication.

Sessions expire after eight hours and contain only a SHA-256 token digest in the database; the random raw token lives in the cookie. Successful login rotates the incoming session. Logout and expiration revoke it. Production uses Secure cookies and requires an HTTPS app origin; simulation is rejected in production configuration. The login limit is 10 attempts per IP per 15 minutes, held in memory for this single-process assignment. Distributed rate limiting is deferred to deployment design.

## Business resources

Every route below requires a session. IDs are UUIDs. Resources belonging to another account return 404, and submitted `ownerId` fields are rejected. Lists return `{data, pagination: {page,limit,total,pages}}`; default page size is 25, maximum 100. Each page is read with a consistent transaction snapshot. Ordering has a stable ID tie-breaker, but offset pages can shift if data changes between requests.

| Method | Path | Behavior |
| --- | --- | --- |
| GET / POST | `/companies` | Paginated companies / create a company. |
| PATCH | `/companies/:id` | Update known fields; recompute scores for related leads in the same transaction. |
| GET / POST | `/leads` | Ranked leads / create a sourced lead with ICP and initial score. |
| GET / PATCH | `/leads/:id` | Inspect / update lead attributes and recompute. Company association is immutable in this stage. |
| GET | `/leads/:id/score-history` | Paginated append-only score explanations, configuration and input snapshots. |
| POST | `/leads/:id/recompute` | Replay all recorded events with current attributes and current scoring configuration. Body `{}`. |
| GET | `/events` | Paginated raw events; optional `leadId` and `type` filters. |
| GET / POST | `/campaigns` | Paginate / create campaign. |
| GET / PATCH | `/campaigns/:id` | Inspect / update name, description, or campaign ICP. |
| GET / POST | `/campaigns/:id/leads` | Paginate enrolled leads / idempotently enroll with `{leadId}`. |

`GET /leads` accepts `search` (name/email/title), `status`, `minScore`, and `companyId` as well as `page` and `limit`. Ordering is score descending, ID ascending. Status is `NEW`, `SENT`, `DELIVERED`, `OPENED`, `REPLIED`, or `UNSUBSCRIBED`.

Company input:

```json
{"name":"Example Apparel","domain":"example.com","industry":"Apparel","region":"India","size":200,"sourceUrl":"https://example.com/about"}
```

Lead input (replace `companyId` with the created company's UUID):

```json
{
  "companyId":"REPLACE_WITH_COMPANY_UUID",
  "firstName":"Example",
  "lastName":"Buyer",
  "email":null,
  "title":"Head of Merchandising",
  "sourceUrl":"https://example.com/team",
  "icp":{"industries":["Apparel"],"regions":["India"],"titles":["Head of Merchandising"],"minCompanySize":50,"maxCompanySize":500}
}
```

These are format examples, not researched prospects. Missing emails remain null. Campaign input is `{name, description?, icp}`. Company size is a positive integer; ICP min/max are validated. Source URLs must use HTTP(S). Emails are trimmed/lowercased and unique per account when present. Company domains are normalized and unique per account.

## Explicit event simulations

For local API testing only, set `ALLOW_SIMULATED_EVENTS=true` in `apps/api/.env` and restart. This enables `POST /leads/:id/simulated-events` with normal session, CSRF and origin requirements:

```json
{"type":"REPLIED","intent":"INTERESTED","dedupeKey":"manual-reply-0001","text":"Please send more information."}
```

`type` is SENT, DELIVERED, OPENED, REPLIED, or UNSUBSCRIBED. Only REPLIED requires/allows `intent`: INTERESTED, NEEDS_INFO, NOT_NOW, WRONG_PERSON, or UNSUBSCRIBE. `occurredAt` is an optional ISO timestamp; timestamps more than one minute in the future are rejected. Deduplication keys are 8–128 characters and unique within the account and source. Same key and same input return the original event; changed input returns 409. Duplicate retries do not create score history. All simulated events have `source: simulation` and `payload.simulated: true`, appear in raw history, and affect the local score. Use disposable test leads. No provider delivery is claimed and no email is sent.

Step 4 adds provider delivery ingestion, tracking URLs, unsubscribe links and sandbox sending; see [EMAIL.md](EMAIL.md). A simulated unsubscribe also adds the normalized email to suppression. Correcting the email of an unsubscribed lead also suppresses the new address.

## Errors

Errors use `{error: {code,message,requestId,fields?}}`. Validation errors return 400; missing/expired sessions 401; origin/CSRF denial 403; hidden/missing resources 404; duplicate/conflicting records 409; oversized bodies 413; sign-in throttling 429; unavailable database readiness 503. Unexpected failures return a generic 500. Stack traces, SQL, hashes, session tokens and database credentials are never part of error bodies.

Deletes are intentionally absent: campaign membership, outreach evidence, event history and score history remain available for audit. Account retention and deletion workflows are not implemented yet.
