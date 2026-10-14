# Discovery and reply assistance

## Modes and setup

`AI_MODE=mock` is the default. It runs deterministic search/fetch fixtures and a rule-based reply classifier. Discovery yields clearly labelled `Demo` contacts at non-routable `.test` domains with no email addresses. Fixture content is fixed and does not represent the requested industry or geography. Importing a fixture is explicit and stores synthetic provenance. These records are not real prospects.

For the live adapters, configure these privately in `apps/api/.env` and restart:

```dotenv
AI_MODE=openai
OPENAI_API_KEY=YOUR_PRIVATE_KEY
TAVILY_API_KEY=YOUR_PRIVATE_KEY
AI_MODEL=YOUR_ENABLED_RESPONSES_FUNCTION_CALLING_MODEL
```

Choose a model available to your account that supports Responses function calling. There is no hard-coded model selection or claim about current free-tier availability. Live research sends ICP queries to Tavily and public fetched text to OpenAI; reply analysis sends the simulated text and limited lead/previous-message context to OpenAI. Credentials and tracking/unsubscribe capabilities are excluded from model context. The OpenAI request sets `store:false`; provider-side data handling still follows the account's provider settings.

The adapters follow the official [OpenAI function-calling protocol](https://developers.openai.com/api/docs/guides/function-calling) and [Tavily search API](https://docs.tavily.com/documentation/api-reference/endpoint/search). HTTP adapters are tested with injected responses. No live OpenAI/Tavily credentials were configured for this stage, so live discovery and live LLM classification remain unverified. The public fetch transport was exercised successfully against `https://example.com/`; that is not a real-lead discovery run.

## Research workflow and bounds

Use **Discovery** in the console, expand the ideal customer profile, enter industry/region/title lists and company-size bounds, and request 5–10 candidates. The model may call only `search`, `fetch`, and `finish_discovery`.

- Up to 18 model turns, three searches, and 12 fetch calls per run, with one tool call per turn and a 90-second overall deadline.
- Fetch URLs must come from this run's search results. Only public HTTPS domain URLs on port 443 are allowed; credentials, literal IPs and local names are rejected.
- All resolved IPv4 answers must be public. The HTTPS connection pins a validated address through its lookup callback, preserving the original host for TLS. IPv6-only sites are not supported.
- Each redirect is revalidated, with at most three redirects. Redirect bodies are closed immediately. Requests accept bounded HTML/plain text only, without executing scripts or following page links.
- Fetches are limited to 256 KiB, with at most 20,000 normalized text characters retained per source. Compressed responses, PDFs, login-protected pages, JavaScript-only content and oversized pages are not supported.
- Provider JSON responses are limited to 512 KiB. Unknown tools, malformed JSON, malformed arguments, repeated call IDs and exhausted budgets fail closed. Tool failures are recorded in a bounded trace.
- Each account has a shared 20/hour research/reply request limit. Only one fresh discovery run per account runs at a time. Limits are in-memory for this single-server assignment.

Runs store the requested ICP, provider/model, mode, source excerpts with fetch timestamps and SHA-256 hashes, tool trace, rejected claims and accepted candidates. A run can finish COMPLETE, PARTIAL (including zero candidates), or FAILED. Missing evidence never causes fabricated people to fill the requested quota.

All non-null identity and company/contact attributes must match excerpts in fetched company-owned pages. Contact excerpts must contain the full name and company together. Email addresses are accepted only with direct supporting text; otherwise they remain null. Outreach evidence must contain the exact value and identify the company. Known live-candidate ICP mismatches are rejected using the same case-insensitive exact-match convention as scoring; unknown attributes remain unknown and require review. Mock fixture mode deliberately bypasses ICP matching.

These checks establish traceability, not independent truth or semantic entailment. A page can be outdated, misleading, or mention a number in another context. Review the person, role, company, source and ICP fit before import. Unsupported candidates are retained only as rejection explanations, not imported leads.

Import is a separate explicit action. It stores company/lead records, field-level research snapshots, outreach evidence, and the initial score. Repeated imports reuse the lead; matching existing company/person records are preserved rather than overwritten. Conflicting company names on an existing domain require review. Original import snapshots remain distinct from subsequent manual edits.

Discovery is synchronous, not a background queue. A lost browser connection may leave a server run progressing; refresh history before retrying. Idempotency keys return the original run, including failures. After a process crash, a stale RUNNING record remains visible for audit; the console labels it as interrupted after two minutes and allows a new run. There is no automatic restart or hidden retry of paid provider calls.

## Reply simulation and review

In a lead's **Replies** tab, submit a simulated reply. The classifier returns INTERESTED, NEEDS_INFO, NOT_NOW, WRONG_PERSON, or UNSUBSCRIBE and a contextual response draft. Output is schema-validated. A classification failure records no new reply event and changes no score.

A successful simulation creates an immutable REPLIED event with `source: reply-simulation`, `payload.simulated: true`, and classifier metadata. Score/history recomputation happens in the same transaction. Duplicate keys do not create duplicate events; changed text under the same key returns 409.

Literal opt-out phrases are checked before invoking the model, so provider failure does not prevent those opt-outs. This conservative phrase guard is not a language-understanding model and can over-trigger on quoted or negated phrases. Model-returned UNSUBSCRIBE also suppresses the lead. Opt-out events permanently block further email submission even for contacts with no known email, set score to zero, and prevent approval of further response drafts. A simulated positive reply cannot undo an opt-out.

Non-suppressed drafts begin PENDING_REVIEW. The owner can edit and approve the wording or dismiss the draft. Approval records the reviewed text and timestamp; it does not create or send an email. Decisions cannot be silently edited afterwards. No inbound-mail integration or automated reply sending is included in this stage. Reply simulation is disabled in production.

## Authenticated endpoints

All endpoints use the session, origin, CSRF, validation and account-ownership rules in [API.md](API.md).

| Method | Path under `/api` | Input / behavior |
| --- | --- | --- |
| GET | `/ai/settings` | Provider/model labels and simulation capability; never keys. |
| POST | `/discovery` | `{icp,count}` plus `Idempotency-Key`; bounded synchronous run. |
| GET | `/discovery` | Paginated run summaries. |
| GET | `/discovery/:id` | Source snapshots, trace, rejections and candidates. |
| POST | `/discovery/:id/import` | `{candidateId}`; idempotent reviewed import. |
| GET | `/leads/:id/research-facts` | Import-time field provenance. |
| POST | `/leads/:id/replies` | `{text}` plus `Idempotency-Key`; simulated classification/event. |
| GET | `/leads/:id/replies` | Paginated analysis/review records. |
| POST | `/replies/:id/review` | `{decision:"approve",draft}` or `{decision:"dismiss"}`; no send. |

Read endpoints do not mutate business records. New relational tables use same-owner foreign keys. The additive migration does not reset existing records.
