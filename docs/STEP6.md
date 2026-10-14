# Step 6: discovery and reply assistance

Implemented the bounded research tool loop, live OpenAI/Tavily adapters, explicit local mock mode, source validation and persisted provenance, reviewed candidate import, simulated reply classification, human-reviewed drafts, opt-out suppression, and the labelled reply evaluation. The React console exposes Discovery and per-lead Replies, plus imported research evidence.

See [ASSISTANCE.md](ASSISTANCE.md) for provider configuration, endpoint contracts, request limits, provenance limitations and failure behavior.

## Run locally

Keep your existing environment files. Mock mode is the default; no additional credentials are required for local fixtures.

```powershell
npm ci
npm run db:generate
npm run db:up
npm run db:migrate
npm run dev
```

Open `http://127.0.0.1:5180` and sign in. Use **Discovery → Run synthetic discovery → Review field evidence → Import synthetic lead** for the local demonstration. Open the imported lead's **Replies** tab to classify a test reply, inspect its score/history, and approve or dismiss a draft. An approval never sends a message.

## Verification

The additive migration applied successfully on 14 October 2026. Local verification covers:

- 21 unit/API tests, including private-network URL/IP rejection, source/claim grounding, exact sourced company sizes, live ICP mismatch rejection, tool budgets, malformed arguments/output, provider transport failures, and opt-out handling.
- 25 database integration scenarios (28 tests including parent tests), covering the earlier backend and eight discovery/reply scenarios: tenant boundaries, idempotency, duplicate imports, source persistence, partial/failed research, review decisions, score updates, and durable suppression of prepared messages.
- Seven browser scenarios (eight tests including the parent): the Step 5 console plus synthetic discovery/import, research provenance, reply approval without sending, and opt-out behavior. Desktop/mobile screenshots are saved under ignored `tmp/step5/` by the shared browser suite.
- TypeScript checks and production builds.

```powershell
npm run typecheck
npm test
npm run test:integration
$env:BROWSER_CHANNEL = 'msedge'
npm run test:console
Remove-Item Env:BROWSER_CHANNEL
npm run evaluate:replies
npm run build
```

The browser tests use installed Microsoft Edge on Windows; alternatively install Playwright Chromium with `npx playwright install chromium` and leave `BROWSER_CHANNEL` unset. Test schemas contain only fixtures and are removed after each completed suite. The existing PostgreSQL driver deprecation warning remains; current tests pass.

## Evaluation and remaining live gates

The eight hand-labelled smoke examples in `evaluation/replies.json` produced **8/8 correct (100%) in local mock mode**, with per-example predictions and a confusion matrix saved in `evaluation/mock-results.json`. The evaluation runs the same classification path as the API, including the literal opt-out guard. This small deterministic smoke set is not a held-out benchmark or evidence of live LLM accuracy. The examples are transparent and do not represent production-language diversity.

After privately configuring OpenAI credentials and an enabled function-calling model, run `npm run evaluate:replies -- --live` to measure the live path. Provider errors count as misses and make the command fail; they are not excluded from the denominator.

No OpenAI/Tavily keys were configured for this stage. The live adapters are implemented and tested with injected provider responses, but finding 5–10 real leads through the application and measuring live-model accuracy remain unverified. A real public HTTPS fetch to example.com succeeded; it does not satisfy the real-lead gate. Live Resend sending/public callbacks also remain pending from Step 4. These limitations must remain visible in the final submission.

Step 7 covers full lifecycle verification, three real-research sample emails, final documentation, the demo guide and deployment preparation. It has not started.

## Push this step to GitHub

```powershell
Set-Location -LiteralPath 'C:\Users\Mayank Singh\.codex\.chatgpt-projects\g-p-6aca42ae5fb881919def5c0720d937c4\stylesense-platform'
git status --short
git add README.md docs/ apps/api/ apps/web/src/ prisma/ evaluation/ package.json
git diff --cached --stat
git diff --cached --name-only
git commit -m "feat: add grounded discovery and reply assistance"
git push origin main
```

No commit or push is performed automatically. This explicit staging list excludes the unrelated pre-existing untracked file. Environment secrets, generated Prisma code, dependencies and screenshots remain ignored.
