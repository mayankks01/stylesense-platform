# Scoring version 1

Weights live in `config/scoring.json`; restart the API after editing. Configurations are validated on startup. The current score includes the config's named version plus a content hash. Every history entry stores the full configuration and fit inputs, event IDs and suppression state, so old results can be reproduced even when company attributes or weights change.

| Component | Points |
| --- | ---: |
| Industry matches a supplied ICP industry | 20 |
| Region matches a supplied ICP region | 10 |
| Known company size is inside supplied inclusive bounds | 15 |
| Job title matches a supplied ICP title | 15 |
| At least one open | 10 |
| Latest reply: interested | 30 |
| Latest reply: needs info | 20 |
| Latest reply: not now | 0 |
| Latest reply: wrong person | -20 |
| Unsubscribe event, unsubscribe intent, or suppression entry | Final score becomes 0 |

Scores are clamped to 0–100. Text matching is trimmed and case-insensitive, with exact values rather than fuzzy/substrings. Unknown attributes and omitted criteria earn zero. At least one size bound must be supplied to award size points. These are transparent initial weights for the assignment, not a claim of predictive accuracy.

Each lead stores its own ICP snapshot. Campaign ICP describes that campaign and does not silently replace a lead's scoring criteria when it joins multiple campaigns. Change the lead's ICP explicitly to rescore it against different criteria.

Only the latest reply by occurrence time contributes reply points. Ties use event ID for deterministic replay; late-arriving older replies do not replace newer ones. Opens are capped to one contribution. Any unsubscribe remains dominant even after later positive replies. Status uses the precedence unsubscribed > replied > opened > delivered > sent > new; it cannot regress because an older delivery callback arrives late.

Event insertion, suppression updates, current score and history commit atomically. Per-lead row locks plus serializable transactions protect concurrent writes; serialization conflicts retry up to three times. Repeated deduplication keys do not rescore. Every new event records an explanation, including a zero-point change. Company/lead changes and explicit replay also record explanations.

Raw events and historical score rows have PostgreSQL triggers that reject update/delete operations. Composite foreign keys enforce account consistency between company/lead, campaign/enrollment, message/event, and event/score history. Score bounds are enforced both in code and PostgreSQL. Tenant read isolation is enforced by account-scoped API queries, not PostgreSQL row-level security; production credentials must remain private to the backend.

Replay has two meanings: `/leads/:id/recompute` recalculates current state from all immutable events and current company/lead attributes; historical reproduction uses each history entry's saved fit inputs, event subset, configuration and suppression flag. The integration suite verifies historical reproduction.
