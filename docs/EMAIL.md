# Email sending and tracking

## Local mode and provider boundary

The default `EMAIL_MODE=mock` performs no external email request. Mock acceptance, simulated delivery, and pixel requests carry explicit simulation metadata. Mock send failures can be selected with `EMAIL_MOCK_FAILURE=reject` or `timeout`; restart after changing configuration. The original prospect address remains separate from the actual sandbox recipient.

`EMAIL_MODE=resend` uses Resend's real HTTPS API with its documented [test recipient addresses](https://resend.com/docs/dashboard/emails/send-test-emails). Every prepared message is sent only to `delivered+<message UUID>@resend.dev`. Both adapters reject other recipients, and the API does not accept a caller-supplied destination. These are provider simulations, not delivery to a person's inbox.

Set the following privately in `apps/api/.env` to enable Resend:

```dotenv
EMAIL_MODE=resend
EMAIL_FROM=StyleSense AI <onboarding@resend.dev>
EMAIL_SENDER_NAME=Your configured sender name
PUBLIC_BASE_URL=https://YOUR_REACHABLE_API_ORIGIN
RESEND_API_KEY=YOUR_PRIVATE_KEY
RESEND_WEBHOOK_SECRET=YOUR_PRIVATE_WEBHOOK_SIGNING_SECRET
```

Use a sender permitted by your Resend account. Configure `email.delivered` callbacks to `https://YOUR_REACHABLE_API_ORIGIN/api/webhooks/resend`. Localhost is not reachable by the provider; arranging public HTTPS hosting/tunnelling is an external setup step, not something this build enables automatically. The same public origin serves tracking and unsubscribe links. The provider's test sink does not represent a human reader; open tracking can be verified by opening the generated pixel URL explicitly.

No provider credentials were configured during development. Resend request formatting and signature handling are tested with local fixtures; a real sandbox send and externally delivered webhook still require verification after configuration. Switching from mock to Resend requires preparing a new message: existing immutable drafts keep their provider.

## Grounded Appendix A rendering

The API renders a fixed template, not arbitrary LLM-written copy. First name, company name, and sender identity come from stored lead/company/configuration fields. Lead and company source URLs must be available for identity provenance. Sender name and an optional proposed time window are configured values. Subject variants map to the three options in Appendix A.

Store researched tokens with `PUT /api/leads/:id/outreach-evidence`:

```json
{
  "token":"pain_point_category",
  "value":"overstock",
  "sourceUrl":"https://example.com/research-page",
  "excerpt":"This is a format example mentioning overstock, not real research."
}
```

Allowed evidence tokens are `observed_signal_short`, `observed_signal_sentence`, `company_segment`, `pain_point_category`, `specific_context_detail`, `one_line_relevance_hypothesis`, `quantified_outcome_optional`, and `optional_soft_proof_point`. Values must occur exactly in their stored excerpt and have a valid HTTP(S) source URL. Header control characters and template braces are rejected. Unsupported values are not stored and create a grounding log entry.

The renderer rechecks stored evidence. Missing/invalid sentence tokens drop the affected sentence; optional outcome/proof/time tokens are omitted with their punctuation. Required identity or subject-token failures block preparation. Unknown pain categories do not create a new capability claim. The supported categories are `overstock`, `heavy markdowns`, `high return rates`, `sizing complaints`, `slow reaction to trends`, and `stockouts`, mapped to Appendix A capabilities.

This guard enforces field and citation traceability, not independent verification that a manually pasted webpage excerpt is true. Automated research/fetch validation is Step 6. Prepared messages retain a complete token/provenance/omission snapshot so later evidence edits cannot silently change previously approved content. Three emails from real research remain a Step 7 deliverable.

## Authenticated workflow

All routes below use the existing session, Origin and CSRF rules from [API.md](API.md). A lead must first be enrolled in the campaign. POST preview/prepare bodies are `{ "subjectVariant": 2 }` (1–3); no arbitrary token overrides are accepted.

| Method | Endpoint | Behavior |
| --- | --- | --- |
| GET / PUT | `/api/leads/:id/outreach-evidence` | Read / upsert one sourced token. |
| GET | `/api/leads/:id/grounding-logs` | Paginated omissions and blocked-value explanations. |
| POST | `/api/campaigns/:campaignId/leads/:leadId/email-preview` | Render plaintext, subject, provenance and issues without sending or tracking. |
| POST | `/api/campaigns/:campaignId/leads/:leadId/messages` | Prepare immutable message. Requires `Idempotency-Key` (8–128 letters, digits, hyphens or underscores). |
| GET | `/api/messages` | Paginated messages; optional leadId/campaignId filters. |
| GET | `/api/messages/:id` | Inspect the exact stored message and grounding snapshot. |
| POST | `/api/messages/:id/send` | Explicitly approve submission of this message; body `{}`. |
| POST | `/api/messages/:id/simulate-delivery` | Local mock mode only; record one clearly labelled delivery simulation. |

Preview returns plaintext without a pixel. Message HTML contains functional tracking/unsubscribe capabilities; keep it private to the owner. The connected console renders previews and stored message bodies as text, without executing stored HTML or loading tracking pixels. Public capability tokens are not authentication sessions and reveal no unrelated lead data.

## Idempotency and failures

Message creation keys are scoped to account and request inputs; a changed lead/campaign/subject variant with the same key returns 409. Each message freezes the provider, sender, recipient, content, token hashes and provenance in PostgreSQL. Snapshot mutation is blocked by a database trigger.

Send status is separate from lead engagement: DRAFT → SENDING → ACCEPTED, FAILED, UNCERTAIN, or BLOCKED. Acceptance records a SENT event only; delivery requires the signed callback or an explicitly simulated mock delivery. Re-sending an accepted message returns its existing result without contacting the provider again.

The sender takes a per-lead lock, checks current/snapshot/sandbox addresses against suppression, and checks permanent unsubscribe history. A short claim lease prevents overlapping submissions. The final check and provider call hold the lead lock so a committed unsubscribe cannot slip between them. External I/O is limited to eight seconds, inside a 20-second transaction; this deliberately favors correctness over throughput for the bounded assignment. The transaction containing network I/O is never retried automatically.

Failures store sanitized codes, never provider response bodies or credentials. Network timeouts/5xx/uncertain database commits use UNCERTAIN. Retry the same message, which uses the same provider idempotency key and unchanged payload. [Resend retains keys for 24 hours](https://resend.com/docs/dashboard/emails/idempotency-keys); retries are therefore blocked at 23 hours after the first attempt. Old uncertain attempts require manual provider reconciliation before any new message is sent. A worker/reconciliation service is deferred; there is no claim of exactly-once delivery across arbitrary failures.

## Public tracking and unsubscribe

- `GET /api/public/open/:token.gif` returns a transparent 1×1 GIF with no-cache headers. Only accepted messages record timestamped raw OPENED events. HEAD and invalid-token requests do not record opens. Repeated requests remain raw events, but scoring caps their contribution.
- `GET /api/public/unsubscribe/:token` displays a confirmation form and does not change subscriptions. `POST` confirms opt-out without login, records an immutable UNSUBSCRIBED event and suppresses the original, current and actual sandbox recipient addresses. Repeated confirmation is idempotent. Both stored drafts and future messages are blocked at send time.
- List-Unsubscribe headers point to the same capability route, including one-click POST support. No external assets or private recipient details appear on the confirmation page.
- `POST /api/webhooks/resend` verifies the raw body with the official Svix library using the [Resend signature protocol](https://resend.com/docs/webhooks/verify-webhooks-requests), including timestamp tolerance. It rejects forged/stale requests and deduplicates deliveries by signed event ID. A callback arriving before local acceptance is recorded returns 503 so the provider can retry.

Pixels can be loaded by security scanners, image proxies or the owner, and can be blocked by mail clients; an open event is not proof a human read the email. Unsubscribe tokens are separate random 256-bit capabilities; hashes support lookup, while the actual URLs remain in the private sent-message snapshot. Revoking old tokens is not implemented because unsubscribe must remain available.

Before production, review applicable GDPR/CAN-SPAM obligations; this assignment restricts sends to sandbox recipients and implements identity, opt-out and suppression controls without claiming legal compliance.
