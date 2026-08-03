# North-star e2e smoke — Implementation Plan

## Overview

Deliver **one Playwright north-star smoke test** (`signin → paste → generate → accept → deck → review`) that closes `context/foundation/test-plan.md` §3 Phase 5 by protecting the cross-cutting cluster of Risk #1 (silent AI-generation drift), Risk #2 (accept/reject/edit UI contract), and Risk #4 (auth gate). Playwright is already installed locally (v1.62.1, 2026-08-03); this change hardens the surrounding infrastructure (config, auth setup, server-side OpenRouter mock, quality levers), authors the smoke test, and updates the cookbook. CI wiring is deliberately out of scope — a follow-up change owns that.

## Current State Analysis

- Playwright 1.62.1 installed (`package.json:54`) + `test:e2e` / `test:e2e:ui` scripts wired (`package.json:20-21`), but `playwright.config.ts` and `e2e/seed.spec.ts` are **uncommitted** exploratory artifacts (see `.playwright-cli/*` timestamped 2026-07-31).
- `playwright.config.ts:11` defaults `baseURL` to `http://localhost:3000`; Astro dev serves on `4321` (per `.dev.vars:5` `PUBLIC_SITE_URL=http://127.0.0.1:4321`) — **first-run bug**.
- `playwright.config.ts:12` declares `storageState: "playwright/.auth/user.json"` globally, but the file is gitignored (`.gitignore:49`) and only exists when someone captured a session; cold checkouts will fail without a `setup` project.
- No `webServer` block — current pattern is "run `npm run dev` in one terminal, `npm run test:e2e` in another"; workable locally, brittle for automation.
- `e2e/seed.spec.ts` mixes a working signin-persistence exemplar (`getByRole("textbox", { name: "Email" })`, `{ name: "Hasło" }`, `{ name: "Zaloguj się" }`) with a **skipped** placeholder test that references role names (`"New deck"`, `"Deck name"`, `"Create"`, `"Delete deck"`, `"Confirm"`) that do not exist in this app — technical debt from the seed pattern reference.
- `src/lib/ai/generate-proposals.ts:35-46` wraps `streamText()` from `@openrouter/ai-sdk-provider`. The OpenRouter HTTP call happens **server-side** in the Astro/Cloudflare dev process — Playwright's `page.route()` cannot intercept it.
- Phase 1 (`context/archive/2026-07-29-testing-generation-flow-protection/`) shipped `src/test/fixtures/generate-stream.ts` with five factories, but they return `Response` objects consumed by Vitest via `vi.stubGlobal('fetch')`. They are **NOT** SDK-shape compatible — `generateProposals()` returns `streamText()`'s result object (`.stream`, `.textStream`, `.finishReason`, …), not a `Response`.
- Accept persistence: `POST /api/cards` (`src/pages/api/cards.ts:52-99`) with Zod `{ question, answer, source: "ai" }`. RLS-scoped insert. Cleanup: existing `DELETE /api/cards/:card_id` (`src/pages/api/cards/[card_id].ts:89-133`) — RLS-scoped, idempotent-safe.
- Locale strategy is cookie-only (`AGENTS.md §Internationalization`), base locale `pl`. Language switcher visible on every signed-in page (`src/components/i18n/LanguageSwitcher.tsx`) — a prior flip to EN silently breaks all role-based locators in tests unless the cookie is pinned.
- `.dev.vars` (local Docker Supabase) vs `.env` (hosted paused free-tier) drift — memories `dev-vars-cloud-vs-local.md` and `prod-login-530-supabase-paused.md`. Playwright must NOT call `dotenv.config()`; env flows through `astro dev` → `.dev.vars` automatically (`@astrojs/cloudflare` reads `.dev.vars` at dev startup).

## Desired End State

After this plan lands:

- `npm run test:e2e` runs green from a cold checkout, given `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` in `.env.e2e` and a running local Supabase.
- `playwright.config.ts` carries a hardened config: correct baseURL, `webServer` with `reuseExistingServer: !CI`, `setup` project dependency, `OPENROUTER_MOCK=1` in `webServer.env`.
- `playwright/setup/auth.setup.ts` performs a one-time UI signin against a dedicated e2e user (`e2e-north-star@local.test`) and writes `playwright/.auth/user.json`.
- `src/lib/ai/generate-proposals.ts` carries a single, auditable `OPENROUTER_MOCK==='1'` branch that returns a fixture stream (SDK-shape compatible); the branch is unit-tested and never fires without the env var set.
- `e2e/CLAUDE.md` carries the E2E rules block; `e2e/seed.spec.ts` is the canonical exemplar (signin persistence only, with the locale-cookie pin pattern).
- `e2e/north-star.spec.ts` runs the full `signin → paste → generate → accept → deck → review` chain end-to-end, cleans up its created card via `DELETE /api/cards/:id`, and provably fails when the accept/persist path breaks (verified via deliberate-break check).
- `test-plan.md §6.6` is filled in with the north-star cookbook entry; §3 Phase 5 status flips to `complete`; §8 Freshness Ledger is updated.

### Key Discoveries:

- Locators PL are the base locale — a prior EN flip via language switcher silently breaks every test (`src/components/i18n/LanguageSwitcher.tsx:10-44`, `src/paraglide/runtime.js:14`).
- The Vercel AI SDK `streamText()` result is NOT a `Response` — the mock branch cannot reuse Phase 1 fixtures directly (`src/test/fixtures/generate-stream.ts:47-52`); a small SDK-shape shim is required.
- `@astrojs/cloudflare` reads `.dev.vars` at `astro dev` startup — no wrapper needed (`node_modules/@astrojs/cloudflare/dist/index.js:292-302`).
- FSRS `emptyCardState()` sets `due` in the immediate future — a freshly created card is typically pickable in `/review`, but the ordering is scheduler-driven, so `/review` is a weaker anchor than `/deck` (RLS-scoped `GET /api/cards` is deterministic).
- The existing `DELETE /api/cards/:card_id` is idempotent-safe (returns 204 on delete, 404 if already deleted / cross-user) — safe for `afterEach` retry.
- `context/deployment/deployment-plan.md:51` forbids `service_role` usage — Option C (setup via UI signin) honors this cleanly.

## What We're NOT Doing

- **CI wiring** — no GitHub Actions job, no repo secrets, no local-Supabase-in-CI setup. Deferred to a follow-up change (see test-plan §5 Gate "e2e on critical flows" — stays `planned` after this plan).
- **Second or third e2e test** — no reject-only test, no edit-then-accept test. Risk #2's reject/edit paths remain covered at the component layer by Phase 1's `GeneratePanel.test.tsx`.
- **Real OpenRouter integration test** — the smoke uses the env-var-gated mock; validating real-model integration is out of scope for this smoke (Phase 1 endpoint tests already exercise the SDK boundary with `vi.mock`).
- **Visual regression / accessibility tests** — per test-plan §7 "What we deliberately don't test", these are excluded from the initial rollout.
- **Middleware unit tests for PROTECTED_ROUTES** — test-plan §3 Phase 3 owns this; Phase 5 only proves the current gate holds via the smoke's opt-out signin.
- **Migrating the existing seed test's PARAGLIDE_LOCALE handling to a shared fixture** — done in Phase 3, not extracted into a reusable Playwright fixture (over-engineering for one test suite).
- **Formalizing `.playwright-cli/` output as versioned artifacts** — `.playwright-cli/` stays gitignored; those YAML dumps are exploratory only.
- **Fixing `PROTECTED_ROUTES` manual-list gap** — that's a separate risk (test-plan Phase 3), not addressed here.

## Implementation Approach

Five phases, each landing an independently-verifiable commit under a `test(testing-north-star-e2e-smoke): <phase title> (pN)` conventional-commit subject. Infrastructure lands first (Phase 1 config + Phase 2 mock + Phase 3 levers), then the smoke test itself (Phase 4, driven by `/10x-e2e`), then the cookbook close-out (Phase 5).

Phase 4 is the only browser-driven phase — `/10x-e2e`'s eligibility gate should pass on it (browser-level fit ✓, feature present ✓, test absent ✓). Phases 1/2/3/5 fail the browser-level fit check; `/10x-e2e`'s gate will redirect them to `/10x-implement` (or the user can invoke `/10x-implement` directly for them). This is by design — the plan is layered so the two skills interleave naturally.

**Skill routing (canonical):** Phase 1/2/3/5 driven by `/10x-implement`; Phase 4 driven by `/10x-e2e`. Starting with `/10x-implement testing-north-star-e2e-smoke phase 1` follows the layered order and keeps Phase 3's quality-levers commit self-contained. If the user starts with `/10x-e2e phase 1` instead, its Setup step 6 auto-creates the levers into Phase 1's commit — functional, but collapses Phase 3 into Phase 1.

Locale-pin discipline: `PARAGLIDE_LOCALE=pl` cookie is set (a) by the auth setup project once (captured into `storageState`), (b) explicitly by the north-star smoke in its `test.beforeEach` since the smoke opts out of `storageState` to exercise UI signin. This dual approach avoids a shared-fixture abstraction for one test file.

## Critical Implementation Details

**Mock shape contract.** The endpoint reads `result.stream` and passes it to `toTextStream({ stream: result.stream })` at `src/pages/api/generate.ts:67`. The gated branch must return `{ stream: <AsyncIterable of Vercel AI SDK stream event parts> }` — nothing more. The event parts are the SDK's internal shape (typically `{ type: 'text-delta', textDelta: string }` chunks + a `{ type: 'finish', ... }` terminal); `toTextStream` extracts the textDelta payloads into a plain text stream. Satisfy only what the endpoint reads (`.stream`), not every field of the SDK result type. The unit test for the branch codifies this by feeding the mock's `.stream` through `toTextStream` (imported from `"ai"`) and asserting the concatenated output equals the JSON envelope `{"proposals":[...]}`.

**Locale-cookie pin ordering.** `context.addCookies([{ name: 'PARAGLIDE_LOCALE', value: 'pl', … }])` must run **before** any `page.goto()` that renders an interactive island — the initial SSR reads the cookie server-side, and any post-navigation flip requires a reload to re-render islands with the new locale.

## Phase 1: Playwright config hardening + auth setup project

### Overview

Fix the config-level tripwires that block a cold-checkout green run and add a `setup` project that captures an authenticated session into `playwright/.auth/user.json` via UI signin. Establishes the "e2e-north-star user + `.env.e2e`" onboarding footprint.

### Changes Required:

#### 1. Playwright config

**File**: `playwright.config.ts`

**Intent**: Correct the baseURL fallback to Astro's dev port, add a `webServer` block so `npm run test:e2e` starts (or reuses) the dev server, declare a `setup` project the `chromium` project depends on, and thread `OPENROUTER_MOCK=1` into the dev server's env so the smoke never hits real OpenRouter.

**Contract**:
- `baseURL` fallback: `http://127.0.0.1:4321` (matches `.dev.vars:5`).
- `webServer`: `{ command: 'npm run dev', url: 'http://127.0.0.1:4321', reuseExistingServer: !process.env.CI, timeout: 120_000, env: { OPENROUTER_MOCK: '1' } }`.
- `projects` array gains a `setup` entry with `testMatch: /.*\.setup\.ts/` and no `storageState`; the existing `chromium` project gains `dependencies: ['setup']`.
- `use.storageState` remains `playwright/.auth/user.json` (unchanged — setup writes it).

#### 2. Auth setup script

**File**: `playwright/setup/auth.setup.ts` (new)

**Intent**: Perform UI signin against the dedicated e2e user once per Playwright run and persist the resulting cookies to `playwright/.auth/user.json` so subsequent tests inherit an authenticated context. Skip explicitly with a clear error if env vars are missing.

**Contract**:
- Single `setup` test titled `authenticate` (Playwright convention).
- Reads `E2E_USER_EMAIL` and `E2E_USER_PASSWORD` from `process.env`; if either is unset, throw with a message pointing at `.env.e2e.example`.
- Pins `PARAGLIDE_LOCALE=pl` via `page.context().addCookies(...)` before navigation.
- Navigates to `/auth/signin`, fills email/password using `getByRole("textbox", { name: "Email" })` / `{ name: "Hasło" }`, submits with `{ name: "Zaloguj się" }`.
- Waits for `**/dashboard` URL (`page.waitForURL`).
- Writes storageState to the path declared in `playwright.config.ts:12`: `page.context().storageState({ path: 'playwright/.auth/user.json' })`.

#### 3. E2E env template + onboarding

**File**: `.env.e2e.example` (new)

**Intent**: Document the two variables the e2e run needs so a new contributor can copy-and-fill without spelunking through the config.

**Contract**:
- Contains `E2E_USER_EMAIL=e2e-north-star@local.test` and `E2E_USER_PASSWORD=<local-only>` with a leading comment naming the file's purpose and warning against committing a filled `.env.e2e`.
- Optional third line commented out: `# PLAYWRIGHT_BASE_URL=http://127.0.0.1:4321` (override for non-default ports).

**File**: `.gitignore`

**Intent**: Ensure filled `.env.e2e` never lands in a commit.

**Contract**: Append `.env.e2e` line (keep `.env.e2e.example` tracked).

**File**: `README.md`

**Intent**: Add a short "E2E tests" section pointing at the setup steps: `supabase start`, one-time user creation, `.env.e2e` copy, `npm run test:e2e`.

**Contract**: New section with 5–8 lines under an existing "Available Scripts" section; references `.env.e2e.example` and `playwright/setup/auth.setup.ts` via `@`-paths per `AGENTS.md` inclusion test.

### Success Criteria:

#### Automated Verification:

- `npx playwright test --list` shows the `setup` project and `chromium` project depends on it
- `npm run lint` passes on new/modified TS files
- `npx astro sync && npm run build` still succeeds (config typecheck)

#### Manual Verification:

- Cold-checkout flow: fresh `git clone` → `supabase start` → create `e2e-north-star@local.test` via `/auth/signup` UI once → copy `.env.e2e.example` to `.env.e2e` and fill → `npm run test:e2e -- --project=setup` → confirms `playwright/.auth/user.json` created
- Subsequent `npm run test:e2e` reuses the running dev server (no port collision)
- `webServer.env.OPENROUTER_MOCK=1` reaches the dev process (verify via a `console.log` in `generate-proposals.ts`, then remove — or defer to Phase 2's unit test)

**Implementation Note**: Pause after Phase 1 for manual confirmation that the setup project captures a working session before wiring the mock.

---

## Phase 2: Server-side OpenRouter mock via env-var branch

### Overview

Introduce a single, auditable env-var-gated branch in `src/lib/ai/generate-proposals.ts` that returns an SDK-shape-compatible stream backed by Phase 1's fixture content. Guarded by `OPENROUTER_MOCK==='1'`, never fires without the env var. Unit-tested so the branch's contract with the endpoint is codified.

### Changes Required:

#### 1. Register OPENROUTER_MOCK env var

**File**: `astro.config.mjs`

**Intent**: Declare the new opt-in test env var in the schema so `astro:env/server` can import it type-safely and Astro won't warn about an undeclared runtime env.

**Contract**:
- Adds `OPENROUTER_MOCK: envField.string({ context: "server", access: "secret", optional: true })` to `env.schema` (between `OPENROUTER_MODEL` and `PUBLIC_SITE_URL`). Optional; default undefined.

#### 2. Mock stream shim

**File**: `src/lib/ai/generate-proposals-mock.ts` (new)

**Intent**: Produce an SDK-shape-compatible mock of the object returned by `streamText()` for the fixture content shape the endpoint consumes. Isolated from prod code so the mock branch in `generate-proposals.ts` stays a 3-line delegation.

**Contract**:
- Exports `makeMockGenerateResult(fixtureProposals: FixtureProposal[])` returning an object with a `.stream` property — an AsyncIterable of Vercel AI SDK stream event parts (`{ type: 'text-delta', textDelta: string }` chunks that serialize the JSON envelope, followed by a `{ type: 'finish', ... }` terminal). This is the surface `src/pages/api/generate.ts:67` reads via `toTextStream({ stream: result.stream })`.
- Reuses the JSON envelope shape from `src/test/fixtures/generate-stream.ts` (`{ proposals: [{ question, answer }, ...] }`) — imports `FixtureProposal` type from there. The envelope is emitted incrementally across 2–5 `text-delta` chunks to exercise `parsePartialJson` on the client side.
- Ships a default fixture set (2–3 proposals with stable question/answer text like `"Kapitalem Polski jest ..."` / `"Warszawa"`) exported as `DEFAULT_MOCK_PROPOSALS` for the branch to use. The individual proposal texts are also re-exported (or stably importable) so `e2e/north-star.spec.ts` can reference them as known constants.
- Verify the exact event-part discriminant name (`text-delta` vs `text` vs another) by reading `node_modules/ai/*.d.ts` at implementation time — the SDK's stream-event type is the source of truth.

#### 3. Gated branch in generate-proposals.ts

**File**: `src/lib/ai/generate-proposals.ts`

**Intent**: Add a single, top-of-function early return that fires only when `OPENROUTER_MOCK==='1'` and delegates to the shim. Otherwise the function is unchanged. The branch is deliberately small and readable so the mock path is auditable at a glance.

**Contract**:
- Import `OPENROUTER_MOCK` from `astro:env/server` and `makeMockGenerateResult` + `DEFAULT_MOCK_PROPOSALS` from `./generate-proposals-mock`.
- The branch at the top of `generateProposals(...)` reads: `if (OPENROUTER_MOCK === "1") { return makeMockGenerateResult(DEFAULT_MOCK_PROPOSALS); }`.
- Real path (existing `createOpenRouter(...)` + `streamText(...)`) remains unchanged.

#### 4. Wire mock env into Playwright's dev server

**File**: `playwright.config.ts`

**Intent**: Confirm `webServer.env.OPENROUTER_MOCK = '1'` is set (added in Phase 1); no diff expected here unless Phase 1 landed without it.

**Contract**: No change if Phase 1's `webServer` block already carries the env; otherwise add the entry.

#### 5. Unit test for the branch

**File**: `src/lib/ai/generate-proposals.test.ts` (new)

**Intent**: Codify the branch's contract with the endpoint by consuming its output through the same iteration path `src/pages/api/generate.ts:48-88` uses, and asserting the resulting JSON envelope contains valid proposals. Also assert the real path is taken when `OPENROUTER_MOCK` is unset.

**Contract**:
- Runs in the `node` Vitest project (`.test.ts` naming).
- Test 1: with `vi.stubEnv('OPENROUTER_MOCK', '1')`, call `generateProposals({...})`, take the returned `.stream`, pass it through `toTextStream({ stream })` (imported from `"ai"`) as the endpoint does, iterate the resulting `ReadableStream<Uint8Array>` via a reader, decode with `TextDecoder`, concat the chunks, and `JSON.parse` the result. Assert the parsed value matches `{ proposals: [{ question: string, answer: string }, ...] }` with `proposals.length >= 1`. This codifies the mock↔endpoint contract by consuming the mock through the exact pipe the endpoint uses.
- Test 2: with `OPENROUTER_MOCK` unset (or `'0'`), `generateProposals()` calls into the real SDK path — assert via a `vi.mock('@openrouter/ai-sdk-provider')` spy that `createOpenRouter` was invoked (proves the branch didn't short-circuit).

### Success Criteria:

#### Automated Verification:

- `npm test -- generate-proposals` runs both tests green
- `npm run lint` passes
- `npx astro sync && npm run build` succeeds (env schema addition is picked up)

#### Manual Verification:

- With `OPENROUTER_MOCK=1` in `.dev.vars` temporarily, `npm run dev` + browser POST to `/generate` returns mock proposals (question text matches `DEFAULT_MOCK_PROPOSALS`)
- With `OPENROUTER_MOCK` unset (or `=0`), real OpenRouter call still fires (revert `.dev.vars` and confirm normal behavior)

**Implementation Note**: Pause after Phase 2 for manual confirmation that toggling `OPENROUTER_MOCK` reliably swaps behaviors before writing the smoke.

---

## Phase 3: E2E quality levers (rules + seed exemplar)

### Overview

Establish the two per-project quality levers `/10x-e2e` expects — a rules file the agent auto-loads before generating tests, and a canonical seed exemplar. Clean up the existing `e2e/seed.spec.ts` (remove the skipped placeholder with fake role names; keep the working signin-persistence test as the sole exemplar, augmented with a locale-cookie pin).

### Changes Required:

#### 1. E2E rules file

**File**: `e2e/CLAUDE.md` (new)

**Intent**: Give Claude Code an auto-loaded set of E2E rules the moment it enters the `e2e/` directory, so any generated test inherits Playwright best practices without repeating them in the prompt.

**Contract**:
- Contains the "E2E Testing Rules" block from `.claude/skills/10x-e2e/references/e2e-quality-rules.md:10-24` verbatim (7 rules covering locators, isolation, timing, business-outcome assertions, unique test data, storageState).
- Adds one project-specific line: "**Locale**: Every test pins `PARAGLIDE_LOCALE=pl` via `context.addCookies(...)` before the first `page.goto()` — role names in tests are Polish; a prior EN flip breaks locators silently."
- Ends with a link to `@AGENTS.md § Internationalization` and `@context/foundation/test-plan.md § 6.6` for the cookbook entry.

#### 2. Seed exemplar cleanup

**File**: `e2e/seed.spec.ts`

**Intent**: Make the seed a clean, minimal exemplar the agent copies: role-based locators, self-contained, wait-for-state, no shared state, cleanup at the end, PARAGLIDE_LOCALE cookie pinned. Remove the skipped placeholder (`"New deck"` / `"Deck name"` role names that don't exist in this app) — dead code that would mis-teach the agent about locator naming.

**Contract**:
- Keep the existing `sign-in persists the session across reload` test (`e2e/seed.spec.ts:5-23`).
- Add a `test.beforeEach` (or per-test cookie pin) that sets `PARAGLIDE_LOCALE=pl` before the first `page.goto()`.
- Delete the entire skipped `test.skip("created deck persists after page reload", ...)` block (`e2e/seed.spec.ts:28-43`) and its two-line preceding comment.
- Add a top-of-file comment referencing `@e2e/CLAUDE.md` as the rules source and identifying this file as the canonical exemplar.

### Success Criteria:

#### Automated Verification:

- `npm run test:e2e -- e2e/seed.spec.ts` passes green (with `.env.e2e` filled and dev server running or via `webServer` block)
- `npm run lint` passes on the modified seed file
- `e2e/CLAUDE.md` exists at repo path

#### Manual Verification:

- Open `e2e/seed.spec.ts` and confirm no fake role names remain
- Confirm `e2e/CLAUDE.md` reads naturally as onboarding for an agent that hasn't seen this project before

**Implementation Note**: Pause after Phase 3 for manual confirmation that the seed test still passes and the rules file reads well before generating the north-star smoke.

---

## Phase 4: North-star smoke test

### Overview

Author `e2e/north-star.spec.ts` — one deep guard exercising the full `signin → paste → generate → accept → deck → review` chain against the running app (with `OPENROUTER_MOCK=1`). This is the only phase driven by `/10x-e2e`'s PLAN → GENERATE → REVIEW → VERIFY inner loop (the other phases fail its browser-level fit gate and route to `/10x-implement`).

### Changes Required:

#### 1. North-star smoke spec

**File**: `e2e/north-star.spec.ts` (new)

**Intent**: One test proving the accept/persist/read chain works across every real boundary (auth, routing, API, DB) using the mocked OpenRouter response. The test itself IS the Risk #4 acceptance oracle because it opts out of the shared `storageState` and drives UI signin from scratch. Assert card presence on `/deck` (deterministic anchor) and on `/review` (functional end-to-end proof).

**Contract**:
- Single `test` block titled binding the assertion to the risk: e.g. `test('accepted flashcard persists across generation, deck, and review', ...)`.
- File-level `test.use({ storageState: { cookies: [], origins: [] } })` to opt out of `playwright/.auth/user.json` — mirror the `e2e/seed.spec.ts:3` pattern.
- `beforeEach`: pin `PARAGLIDE_LOCALE=pl` cookie.
- Flow steps (each with a preceding one-line comment naming the plan step it implements):
  1. Navigate to `/auth/signin`; fill using `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` env vars; submit; `waitForURL(**/dashboard)`.
  2. Click `Wygeneruj fiszki AI` link; `waitForURL(**/generate)`; assert heading `Generuj fiszki` visible.
  3. Fill `Tekst źródłowy` textbox with a stable canary text; click `Generuj` button; wait for at least one `Akceptuj` button to become visible.
  4. Import the mock question text as a known constant from `src/lib/ai/generate-proposals-mock` (e.g., `MOCK_QUESTION_1`) — no DOM read needed since we control the mock. `<CardTitle>` in `ProposalCard.tsx:90` is a shadcn `<div>`, not a semantic `heading`, so `getByRole('heading', ...)` would fail; `page.getByText(MOCK_QUESTION_1)` is the correct locator.
  5. Set up `page.waitForResponse('**/api/cards', response => response.request().method() === 'POST')` before clicking the first `Akceptuj` — capture the response JSON to extract `card.id` for cleanup.
  6. Assert `Dodano do talii` text is visible (accept UI acknowledgment).
  7. Navigate to `/deck`; assert `page.getByText(MOCK_QUESTION_1)` is visible.
  8. Navigate to `/review`; wait for the page to load without error (e.g., page-level heading `Powtórka` or equivalent visible). Do not assert on specific card presence — `/review` is a smoke of the FSRS hop wiring only; `/deck` at step 7 is the assertion.
- `afterEach`: fetch `DELETE /api/cards/:card_id` with the captured `card.id`, expect 204 or 404; if the id capture failed (test crashed before step 5), skip cleanup with a `console.warn`.
- Uses only role-based locators + text matches (per `e2e/CLAUDE.md`); no CSS, no XPath, no `waitForTimeout`.

### Success Criteria:

#### Automated Verification:

- `npm run test:e2e -- e2e/north-star.spec.ts` runs green against local dev with `OPENROUTER_MOCK=1`
- `npm run lint` passes on the new spec
- `/10x-e2e` review pass: no anti-patterns flagged (hallucinated assertion, brittle selector, shared state, wait-for-time, no cleanup)

#### Manual Verification:

- **Deliberate-break check**: temporarily change `DEFAULT_MOCK_PROPOSALS` in `src/lib/ai/generate-proposals-mock.ts` to return an empty proposals array (or return a fixture with `answer: ""`). Re-run the smoke; confirm it goes **red** (either the `Akceptuj` never appears, or the accept POST fails, or the `Dodano do talii` assertion times out). Revert the change; re-run; confirm green.
- Watch the test run once with `npm run test:e2e:ui` to eyeball the full flow: signin form fills, generation shows spinner+stop button, proposal cards render, click on Akceptuj shows "Zapisywanie..." then "Dodano do talii", /deck shows the card at top of list, /review pulls the question.
- No stray cards left in the e2e user's deck after the run (verify via `/deck` manual visit as the e2e user).

**Implementation Note**: Pause after Phase 4 for manual confirmation that the deliberate-break check went red-then-green and no cards leaked. This is the phase most likely to expose a real-vs-mocked boundary bug.

---

## Phase 5: Cookbook §6.6 + rollout close-out

### Overview

Fill `test-plan.md §6.6` with the north-star cookbook entry (location, run command, reference test, real-vs-mocked boundaries, cleanup approach), flip `§3 Phase 5` status to `complete`, and update the Freshness Ledger. Prose-only phase; no code changes.

### Changes Required:

#### 1. Cookbook §6.6

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the `TBD — see §3 Phase 5` placeholder in §6.6 with a concrete recipe for "adding an e2e smoke of the north-star flow" — location, naming, project convention, reference test path, run command, real-vs-mocked contract, cleanup pattern, PARAGLIDE_LOCALE pin. Written as onboarding for the next contributor who wants to add a second smoke.

**Contract**:
- Under §6.6 heading, replace the TBD line with 8–12 bullets covering: reference exemplar (`@e2e/north-star.spec.ts`), rules file (`@e2e/CLAUDE.md`), how OpenRouter is mocked (env-var branch), how the e2e user is provisioned (`.env.e2e.example` + one-time signup), why locale is pinned per-test, cleanup contract (DELETE via cardId capture), and when to add a second smoke vs stay at one.

#### 2. Phase 5 status + Freshness Ledger

**File**: `context/foundation/test-plan.md`

**Intent**: Mark the rollout row `complete` and stamp the ledger so future `/10x-test-plan --refresh` runs see fresh dates.

**Contract**:
- §3 Phase 5 row: `Status` column flips from `change opened` to `complete`.
- §7 (or wherever the Playwright checked-date lives — §4 stack row for e2e): update `checked: 2026-08-03` to today's date if Phase 4's smoke exercised a newer Playwright build, else leave.
- §8 Freshness Ledger: update `Strategy (§1–§5) last reviewed` and `Stack versions last verified` to today.

#### 3. Change close-out

**File**: `context/changes/testing-north-star-e2e-smoke/change.md`

**Intent**: The `/10x-implement` epilogue commit flips this automatically. Confirm the transition happens.

**Contract**: `status: implemented`, `updated: <today>`. No manual edit — the skill's epilogue owns this.

### Success Criteria:

#### Automated Verification:

- `git diff context/foundation/test-plan.md` shows changes only in §6.6, §3 Phase 5 row, §8 ledger (no unrelated edits)
- `npm run lint` passes (markdown files are prettier-formatted per `lint-staged`)

#### Manual Verification:

- Read §6.6 as a stranger and confirm it answers "how do I add another north-star-shape smoke?"
- Confirm §3 Phase 5 row status reads `complete`
- Confirm §8 Freshness Ledger dates updated

**Implementation Note**: This is the final phase — `/10x-implement`'s epilogue commit will close `change.md` (`status: implemented`).

---

## Testing Strategy

### Unit Tests:

- `src/lib/ai/generate-proposals.test.ts`: covers the env-var branch (mocked path returns SDK-shape stream with valid proposals; unset env still hits the real SDK boundary).

### Integration Tests:

- Existing Phase 1 endpoint + component tests continue to pass unchanged — this plan does not modify `src/pages/api/generate.ts` or `src/components/generate/*`.

### E2E Tests:

- `e2e/seed.spec.ts` (upgraded): canonical exemplar, signin-persistence.
- `e2e/north-star.spec.ts` (new): the smoke itself.

### Manual Testing Steps:

1. Cold-checkout smoke: fresh clone → `supabase start` → `/auth/signup` for `e2e-north-star@local.test` once → copy `.env.e2e.example` to `.env.e2e` + fill → `npm run test:e2e` → all green.
2. Deliberate-break: mutate `DEFAULT_MOCK_PROPOSALS` (Phase 4) → smoke fails → revert → smoke passes.
3. Locale drift: set `PARAGLIDE_LOCALE=en` in a browser, close browser, run smoke → confirm smoke still green (per-test cookie pin overrides).

## Performance Considerations

- One smoke test; runtime target ≤30s locally with dev server warm. If the test approaches 60s, that's a signal `useProposalStream` is slow-streaming the mock fixture or the FSRS `emptyCardState()` isn't due-immediate — investigate before adding retries.
- `webServer.reuseExistingServer: !CI` keeps local iteration fast; CI (out of scope) will pay one dev-server boot per run.

## Migration Notes

- The uncommitted `playwright.config.ts` + `e2e/seed.spec.ts` land as part of Phase 1/3 commits — they are not "migrated" but formalized.
- `playwright/.auth/user.json` (untracked) may already exist from prior exploration (2026-07-31 CLI runs). If it's stale (wrong user, wrong Supabase URL), the `setup` project overwrites it. Recommend deleting it before first run of the setup project to force a clean capture.
- `.env` file remains pointed at hosted (paused) Supabase (memory `dev-vars-cloud-vs-local.md`) — do not fix as part of this plan. This plan explicitly forbids `dotenv/config` in Playwright, so `.env` won't affect the e2e run.

## References

- Related research: `context/changes/testing-north-star-e2e-smoke/research.md`
- Test plan: `context/foundation/test-plan.md` §3 Phase 5, §6.6, §2 Risks #1/#2/#4
- Phase 1 archived plan: `context/archive/2026-07-29-testing-generation-flow-protection/plan.md` (fixture module + accept UI wiring reference)
- Endpoint contract: `src/pages/api/generate.ts:12-101`
- Accept endpoint: `src/pages/api/cards.ts:52-99`
- Cleanup endpoint: `src/pages/api/cards/[card_id].ts:89-133`
- Middleware / PROTECTED_ROUTES: `src/middleware.ts:5-49`
- Fixture factories: `src/test/fixtures/generate-stream.ts:47-115`
- E2E rules source: `.claude/skills/10x-e2e/references/e2e-quality-rules.md`
- Seed pattern source: `.claude/skills/10x-e2e/references/seed-test-pattern.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Playwright config hardening + auth setup project

#### Automated

- [x] 1.1 `npx playwright test --list` shows the `setup` project and `chromium` project depends on it — dcee8c6
- [x] 1.2 `npm run lint` passes on new/modified TS files — dcee8c6
- [x] 1.3 `npx astro sync && npm run build` still succeeds (config typecheck) — dcee8c6

#### Manual

- [x] 1.4 Cold-checkout flow produces `playwright/.auth/user.json` on first `--project=setup` run — dcee8c6
- [x] 1.5 Subsequent `npm run test:e2e` reuses the running dev server (no port collision) — dcee8c6
- [x] 1.6 `webServer.env.OPENROUTER_MOCK=1` reaches the dev process (verified via a temporary console log) — dcee8c6

### Phase 2: Server-side OpenRouter mock via env-var branch

#### Automated

- [x] 2.1 `npm test -- generate-proposals` runs both tests green
- [x] 2.2 `npm run lint` passes
- [x] 2.3 `npx astro sync && npm run build` succeeds (env schema addition picked up)

#### Manual

- [x] 2.4 With `OPENROUTER_MOCK=1` in `.dev.vars`, `/api/generate` returns mock proposals via browser
- [x] 2.5 With `OPENROUTER_MOCK` unset (or `=0`), real OpenRouter call still fires

### Phase 3: E2E quality levers (rules + seed exemplar)

#### Automated

- [ ] 3.1 `npm run test:e2e -- e2e/seed.spec.ts` passes green
- [ ] 3.2 `npm run lint` passes on the modified seed file
- [ ] 3.3 `e2e/CLAUDE.md` exists at repo path

#### Manual

- [ ] 3.4 `e2e/seed.spec.ts` contains no fake role names
- [ ] 3.5 `e2e/CLAUDE.md` reads naturally as agent onboarding

### Phase 4: North-star smoke test

#### Automated

- [ ] 4.1 `npm run test:e2e -- e2e/north-star.spec.ts` runs green with `OPENROUTER_MOCK=1`
- [ ] 4.2 `npm run lint` passes on the new spec
- [ ] 4.3 `/10x-e2e` review pass: no anti-patterns flagged

#### Manual

- [ ] 4.4 Deliberate-break check: mutated mock → smoke red; reverted → smoke green
- [ ] 4.5 UI walkthrough (`npm run test:e2e:ui`) shows full flow signin → generate → accept → deck → review
- [ ] 4.6 No stray cards in the e2e user's deck after the run

### Phase 5: Cookbook §6.6 + rollout close-out

#### Automated

- [ ] 5.1 `git diff context/foundation/test-plan.md` shows changes only in §6.6, §3 Phase 5 row, §8 ledger
- [ ] 5.2 `npm run lint` passes

#### Manual

- [ ] 5.3 §6.6 reads as concrete onboarding for a next contributor adding another smoke
- [ ] 5.4 §3 Phase 5 row status reads `complete`
- [ ] 5.5 §8 Freshness Ledger dates updated to today
