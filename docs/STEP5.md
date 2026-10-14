# Step 5: connected sales console

The React console now uses the authenticated API and PostgreSQL records. It includes:

- Sign-in, cookie-session restoration, sign-out, and removal of private screens on session expiry. CSRF tokens stay in memory; credentials are not stored in browser storage.
- Ranked lead lists, server pagination, search, status and minimum-score filters, loading indicators, empty states, and retryable errors.
- Company and lead creation/editing, source links, and editable scoring profiles. Unknown emails remain blank.
- Campaign creation/editing, paginated membership, and explicit enrollment from a lead's Outreach tab.
- Sourced outreach evidence, template previews with grounding omissions, immutable draft preparation, exact stored-message review, and a separate send confirmation.
- Provider-labelled message status, retries on the same message, mock delivery simulation, timestamped events, score changes, and recorded scoring inputs.
- Responsive desktop/mobile layouts and accessible form labels. Wide lead tables scroll within their container on small screens.

## Use the console

Keep the existing environment files. From the repository root:

```powershell
npm ci
npm run db:up
npm run db:migrate
npm run dev
```

Open `http://127.0.0.1:5180`. Sign in with your provisioned account. If you have not created one, privately configure the `BOOTSTRAP_` values described in [API.md](API.md), run `npm run user:create`, and remove the bootstrap password afterwards. No default application account was added.

1. Add a sourced company in **Companies**.
2. Add a sourced contact in **Leads**, with an optional ideal customer profile for scoring.
3. Create a campaign in **Campaigns**.
4. Open the lead's **Evidence** tab and save a supported token, source URL, and the exact excerpt containing its value. For subject option 2, a supported `pain_point_category` is required.
5. Open **Outreach**, choose the campaign, enroll the lead, and preview. Review omissions and provenance before preparing a draft.
6. Review the stored message, select **Review & send**, then explicitly confirm. Mock mode makes no external email request; Resend mode remains limited to provider test recipients.
7. Use mock delivery simulation where available, then inspect **Activity** and **Score history**. Acceptance and delivery alone do not add engagement points under the current scoring configuration. Opens and reply intent do.

Filters apply when submitted. Lists and provider status can be refreshed explicitly; there is no background polling. Browser reload restores authentication but returns to the Leads screen; navigation and unsaved form state are not persisted. Campaign profiles do not overwrite individual lead scoring profiles.

## Verification

Verified on 14 October 2026:

- 14 unit/API tests passed.
- 17 backend database integration scenarios passed (19 reported tests including parent tests).
- Six browser scenarios passed against real API endpoints and a disposable PostgreSQL schema (seven reported tests including the parent test).
- TypeScript checks and production API/frontend builds passed.
- Desktop and 390px mobile screenshots were reviewed. The browser test asserts no document-level horizontal overflow and no uncaught page errors.

Browser coverage includes invalid login, session restoration, server-error recovery, a deliberately delayed loading state, empty lists, sourced company/contact creation, grounded/blocked previews, campaign enrollment, explicit mock sending, delivery and score history, pagination, combined filters, logout, and session revocation. Updating a lead's fit profile changed its score from 20 to 35 and moved it above a lead scored at 30. Previewing drafts created no OPENED events.

The runner uses port 5187 and a random API port, creates only synthetic records in its isolated schema, and drops that schema on completion. It does not add test accounts or leads to the application schema. Screenshots are written to ignored `tmp/step5/`.

```powershell
npm run typecheck
npm test
npm run test:integration
# On Windows with Microsoft Edge installed:
$env:BROWSER_CHANNEL = 'msedge'
npm run test:console
Remove-Item Env:BROWSER_CHANNEL
npm run build
```

Alternatively, install Playwright's Chromium with `npx playwright install chromium`, leave `BROWSER_CHANNEL` unset, and run `npm run test:console`. Docker must be running. The existing PostgreSQL driver deprecation warning about overlapping queries remains; tests pass with the installed driver.

Live Resend delivery and public callbacks remain unverified pending credentials and a reachable HTTPS callback URL. Step 6 adds automated research/discovery and reply assistance; those features are not simulated by this console. Deployment remains Step 7.

## Push this step to GitHub

```powershell
Set-Location -LiteralPath 'C:\Users\Mayank Singh\.codex\.chatgpt-projects\g-p-6aca42ae5fb881919def5c0720d937c4\stylesense-platform'
git status --short
git add README.md docs/BUILD_PLAN.md docs/EMAIL.md docs/STEP5.md apps/web/src/ apps/api/package.json apps/api/test/integration/console.ts package.json package-lock.json
git diff --cached --stat
git commit -m "feat: build connected prospecting console"
git push origin main
```

The explicit staging list excludes the unrelated pre-existing untracked file. Secrets, dependencies, generated builds and test screenshots remain ignored. No commit or push is performed automatically.
