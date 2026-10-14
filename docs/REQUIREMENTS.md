# Requirements checklist

Source: ThinkDatax-Full-Stack-Assignment.pdf, four pages, including Appendix A. The document's feature requirements inform the implementation; its instructions to submit or contact someone do not authorize external messages.

This is the original acceptance checklist. Implementation and verification status, including unresolved live-provider gates, is recorded in [Step 7](STEP7.md); this checklist alone does not assert completion.

## Core acceptance criteria

| Area | Acceptance criteria |
| --- | --- |
| Relational model | PostgreSQL stores companies, leads, campaigns, messages, immutable email events, current scores, and score history with foreign keys, uniqueness rules, and indexes. |
| API | Authenticated REST endpoints cover leads, campaigns, and event reads; validate inputs, paginate lists, and return consistent errors. Cross-account access is denied. |
| Authentication | Login, logout, session expiry, and protected data routes work. This resolves the Section 3.1 / Section 4 conflict in favor of the explicitly required core scope. |
| Sending | A real email provider in sandbox/test mode sends the Appendix A skeleton to controlled recipients. Provider failures and duplicate-send prevention are handled. |
| Events | Delivery, open timestamps, replies, and unsubscribe are separate records from derived lead status and score. Provider acceptance alone is not reported as delivery. |
| Tracking | A message-specific opaque tracking URL returns a pixel and records opens. Provider delivery events are verified and deduplicated. Pixel opens are engagement signals, not proof a human read the email. |
| Unsubscribe | Working tokenized unsubscribe flow creates a suppression entry; every send checks suppression. Unsubscribe works without application login. |
| Scoring | Fit plus engagement produces a bounded 0–100 score. Weights live in a configuration file. Relevant events trigger recomputation and a reasoned history entry; replaying stored history reproduces the score. |
| Console | React ranked lead list defaults to descending score; filtering and clear sent/opened/replied status work, with loading, empty, and error states. |
| Discovery | ICP accepts industry, region, company size, and target titles. An LLM uses search/fetch function calls to extract 5–10 real, source-linked leads. Missing data stays missing; invented emails or people are prohibited. |
| Grounding | Template token values have stored lead/company provenance. A programmatic guard rejects unsupported values and logs the rejection. Missing evidence drops the affected sentence rather than inventing a claim. |
| Replies | A simulate-reply text box classifies interested, needs info, not now, wrong person, or unsubscribe. It produces a contextual draft for human approval; classification never sends a draft automatically. Unsubscribe intent suppresses further outreach. |
| Evaluation | Ship 5–8 hand-labelled reply examples plus a one-command evaluation reporting measured accuracy. |
| Tests | Meaningful scoring tests and at least one API endpoint test; extend to the critical send/suppression and grounding boundaries. |

## Appendix A preservation

- Keep greeting structure, StyleSense AI branding, sign-off, and sentence order fixed.
- Choose one of the three supplied subject skeletons and fill it from grounded data.
- Store evidence for observed signals, company segment, context, pain point, capability mapping, and relevance hypothesis. Label a hypothesis as a hypothesis, not an observed fact.
- Optional quantified outcome, proof point, and proposed time window are omitted cleanly when unavailable; omit surrounding punctuation as needed.
- Sender identity is configured data. Proposed times are sender inputs. Neither should be invented by the model.
- Preserve the supplied mappings: markdowns/overstock to demand forecasting; sizing/returns to size and fit prediction; slow trend response to trend intelligence; cross-channel stockouts to inventory allocation.
- Do not invent quantified product benefits or customer proof points.
- Acceptance includes at least three sample emails populated from real research and a rejection case for an unsupported claim.

## Deliverables

1. Git repository with incremental, readable commits.
2. README with setup, architecture, scoring weights, actual evaluation accuracy, and deferred scope.
3. Labelled reply set and runnable evaluation script.
4. Three grounded sample emails with supporting research.
5. A 3–5 minute lifecycle demonstration: ICP → discovery → sandbox send → open → simulated reply → classification and approved response → updated score and rank.

The brief requests a recording and repository submission within three days of receipt. The receipt date is unknown, so no deadline is inferred. Recording capture and any submission will be handled explicitly at the final stage.

## Optional scope, deferred

Click tracking, automated follow-up sequences, inbound webhook/IMAP replies, background jobs, autonomous re-planning, and MongoDB. Core processing can be synchronous.

## Constraints

Free tiers are preferred. If a provider is unavailable, use a clearly labelled mock behind the same interface with realistic failure cases and document the limitation. A mocked run does not meet the live sandbox-send or real-research verification gate by itself. README compliance notes will cover consent, sender identity, opt-out, suppression, and data minimization without claiming these controls alone establish legal compliance.
