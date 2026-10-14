# 3–5 minute recording guide

Record the local console with your own account. No recording file has been produced. Close secret-bearing terminals and environment files before recording; use fixtures or approved public research. The default run is a labelled mock demonstration, not evidence of live discovery or email delivery.

## Preparation

Run `npm run db:up`, `npm run db:migrate`, and `npm run dev`; open http://127.0.0.1:5180. Sign in, create a campaign, and ensure `EMAIL_MODE=mock` and `AI_MODE=mock` for the repeatable local demo. Do not change production settings to expose simulations publicly. Run `$env:BROWSER_CHANNEL='msedge'; npm run verify` separately beforehand on Windows. The browser suite uses a disposable schema and does not seed your account.

## Recording timeline

| Time | Show and explain |
| --- | --- |
| 0:00–0:30 | Sign in and show the ranked pipeline. Explain React → authenticated API → PostgreSQL, fit plus engagement, and explicit mock provider labels. |
| 0:30–1:15 | Discovery: enter Apparel, India, Buyer, size 50–500, count 5. Run synthetic discovery. Open a candidate, inspect source/excerpt and synthetic label, and import it. Explain that live AI discovery remains a separate gate. |
| 1:15–2:00 | Evidence tab, then Outreach: select the campaign, enroll the lead, preview subject variant 2, inspect omissions, prepare immutable draft, review and confirm mock send. Show ACCEPTED and the `resend.dev` test recipient. |
| 2:00–2:30 | Simulate mock delivery; show a separate DELIVERED event. To demonstrate an open, copy the selected message's tracking pixel URL from the authenticated `/api/messages/:id` response in browser developer tools and open that URL once in another tab. Treat this as a deliberate test request, not a real human email open. Refresh the lead and show OPENED and its score-history entry. Do not load the whole message HTML. |
| 2:30–3:15 | Replies: enter “Interested. Let's schedule a call.” Classify; inspect the draft, edit it, and choose Approve draft without sending. Explain that approval is stored but no response is transmitted. |
| 3:15–3:45 | Return to Leads, refresh, show score and rank. With all fit fields matched: fit 60 + open 10 + interested 30 = 100. Show immutable events and score history. |
| 3:45–4:15 | Simulate “Please unsubscribe me.” Show suppression, score zero and blocked future sends. |
| 4:15–4:45 | Show `examples/EMAILS.md`, the unsupported-claim rejection check, evaluation result (8/8 mock smoke examples), and the remaining live-provider/deployment limitations in README.md. |

## Live demonstration gate

Configure OpenAI/Tavily and Resend privately as described in ASSISTANCE.md and EMAIL.md. Restart the local API, perform a fresh 5–10 candidate live discovery, inspect evidence before import, send only to the enforced provider test recipient, and wait for a verified public webhook. Do not relabel synthetic runs as live. Report partial discovery honestly. Run `npm run evaluate:replies -- --live` and record the actual accuracy/model separately from the mock result. Record the video only after those checks if a live demonstration is required by the reviewer.

Capture with a local screen recorder, review the saved video for secrets and legibility, and include its link in your submission yourself. No reviewer has been contacted and nothing has been submitted automatically.
