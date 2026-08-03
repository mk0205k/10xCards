---
date: 2026-08-03T00:00:00+02:00
researcher: "@mkról (via Claude)"
git_commit: 982982907667ba18150fc4488baf1d70e4e1e129
branch: master
repository: 10xdevs
topic: "North-star e2e smoke: what a Phase 5 Playwright plan needs to know about signin → paste → generate → accept → review"
tags: [research, codebase, playwright, e2e, testing, phase-5, test-plan]
status: complete
last_updated: 2026-08-03
last_updated_by: "@mkról (via Claude)"
---

# Research: North-star e2e smoke (Phase 5)

**Date**: 2026-08-03 (Europe/Warsaw)
**Researcher**: @mkról (via Claude)
**Git Commit**: `9829829`
**Branch**: `master`
**Repository**: 10xdevs (10x-astro-starter)

## Research Question

For `context/foundation/test-plan.md` §3 Phase 5 — a single north-star Playwright smoke covering **signin → paste → generate → accept → review** — what does the plan need to know from live code to make the following decisions:

- (a) the exact route + role-name inventory for every step of the flow (PL locale, cookie-only strategy)
- (b) the real-vs-mocked boundary for the OpenRouter call (which is server-side, so `page.route()` cannot intercept it)
- (c) how to seed an authenticated session for Playwright, given `@supabase/ssr` cookies + local Docker Supabase, without introducing `service_role`
- (d) how the accepted card is persisted and where it becomes visible (the assertion anchor for the "review" step)
- (e) what Phase 1 (`context/archive/2026-07-29-testing-generation-flow-protection/`) left behind that Phase 5 can reuse or must extend
- (f) cleanup strategy per test so parallel/repeated runs stay deterministic

Signal, not code-location: this research grounds the plan; it does not write test code.

## Summary

Phase 5 is executable, but the plan needs to make **four load-bearing decisions** the research grounds but does not settle:

1. **"Review" assertion anchor** — the test-plan wording says "review", but `/review` in this app is the **FSRS rating session**, not "the deck view". A freshly accepted card is due immediately (FSRS `emptyCardState()`), so it *will* appear in `/review` — but the deterministic, non-time-sensitive anchor is `/deck` (deck management). The plan must pick one; recommendation: assert **both** — the accepted card appears at `/deck` (structural proof of persistence), and the review session at `/review` can pull it up (functional proof of end-to-end wiring).
2. **OpenRouter mock strategy** — the OpenRouter HTTP call is made **server-side** by `@openrouter/ai-sdk-provider` inside the Astro/Cloudflare Worker process. Playwright's `page.route()` cannot intercept it. Three viable options remain (real API + canary prompt, env-var-gated fixture branch in `src/lib/ai/generate-proposals.ts`, or Node loader hook module swap). The plan must pick one — recommendation below.
3. **Seeding strategy** — Option C (Hybrid): Playwright `setup` project performs UI signin once, captures `storageState`; the north-star smoke opts out to exercise the signin path end-to-end. Zero new secrets, no `service_role`.
4. **Locale pin** — the language switcher is visible in the Topbar on every page. The test MUST pin `PARAGLIDE_LOCALE=pl` (cookie) before starting, else the role names in the test won't match rendered UI when a prior visit flipped the cookie.

Two config-level tripwires block a green first run and need to be prescribed by the plan:
- `playwright.config.ts:11` defaults `baseURL` to `http://localhost:3000`; Astro dev serves on `4321` (per `.dev.vars:5` `PUBLIC_SITE_URL`).
- `playwright.config.ts:12` sets `storageState: "playwright/.auth/user.json"` globally — that file is gitignored and only exists when someone has captured a session; without a `setup` project or `.gitkeep`-adjacent contract, cold runs fail.

## Detailed Findings

### 1. UI surface — routes, roles, PL names

Every interactive control in the north-star path has an accessibility-tree hit; no `data-testid` is required for the happy path.

| Step | Route | Element | Role | Accessible name (PL) | i18n key | Source |
|---|---|---|---|---|---|---|
| Signin | `/auth/signin` | Email input | `textbox` | `Email` | `auth_form_email_label` | `src/components/auth/FormField.tsx:37`, `messages/pl.json:56` |
| Signin | `/auth/signin` | Password input | `textbox` | `Hasło` | `auth_form_password_label` | `messages/pl.json:57` |
| Signin | `/auth/signin` | Submit | `button` | `Zaloguj się` | `auth_form_signin_button` | `src/components/auth/SubmitButton.tsx:16-32`, `messages/pl.json:70` |
| Dashboard | `/dashboard` | Generate CTA | `link` | `Wygeneruj fiszki AI` | `dashboard_cta_generate` | `src/pages/dashboard.astro:100-116`, `messages/pl.json:110` |
| Dashboard | `/dashboard` | Review CTA | `link` | `Rozpocznij powtórkę` | (dashboard_cta_review-ish) | `src/pages/dashboard.astro:120-128` |
| Generate | `/generate` | Source textarea | `textbox` | `Tekst źródłowy` | `generate_form_label` | `src/components/generate/GenerateForm.tsx:28-39` |
| Generate | `/generate` | Generate btn (idle) | `button` | `Generuj` | `generate_form_generate` | `src/components/generate/GenerateForm.tsx:50-61` |
| Generate | `/generate` | Generate btn (streaming) | `button` | `Generowanie...` | `generate_form_generating` | `messages/pl.json:121` |
| Generate | `/generate` | Stop btn (streaming) | `button` | `Zatrzymaj` | `generate_form_stop` | `src/components/generate/GenerateForm.tsx:45-48` |
| Generate | `/generate` | Accept per proposal | `button` | `Akceptuj` | `generate_proposal_accept` | `src/components/generate/ProposalCard.tsx:101-110` |
| Generate | `/generate` | Reject per proposal | `button` | `Odrzuć` | `generate_proposal_reject` | `src/components/generate/ProposalCard.tsx:121-130` |
| Generate | `/generate` | Edit per proposal | `button` | `Edytuj` | `generate_proposal_edit` | `src/components/generate/ProposalCard.tsx:111-120` |
| Generate | `/generate` | Saved-badge text | (text) | `Dodano do talii` | `generate_proposal_added` | `src/components/generate/ProposalCard.tsx:93-98` |
| Deck | `/deck` | Deck list rendering | — | (card question text visible) | — | `src/components/deck/DeckPanel.tsx:90-96` via `GET /api/cards` |
| Review | `/review` | Show-answer btn | `button` | `Pokaż odpowiedź` | `review_show_answer` | `src/components/review/ReviewSession.tsx:198-200` |
| Review | `/review` | Rating "Znowu" | `button` | `Znowu → …` | `review_rating_again` | `src/components/review/ReviewSession.tsx:217-231` |
| Review | `/review` | Rating "Trudne" | `button` | `Trudne → …` | `review_rating_hard` | same |
| Review | `/review` | Rating "Dobrze" | `button` | `Dobrze → …` | `review_rating_good` | same |
| Review | `/review` | Rating "Łatwe" | `button` | `Łatwe → …` | `review_rating_easy` | same |
| Review | `/review` | Session-complete text | (text) | `Sesja zakończona 🎉` | `review_session_complete` | `messages/pl.json:161` |
| Topbar | any | Language switcher | `button` | `PL` / `EN` | `language_pl`/`language_en` | `src/components/i18n/LanguageSwitcher.tsx:10-44` |

**Locale pin.** `PARAGLIDE_LOCALE` cookie drives `<html lang>` and all `m.*()` message calls (see `src/paraglide/runtime.js:14,25`). Base locale is `pl`. Strategy is `["cookie", "globalVariable", "baseLocale"]` (`AGENTS.md` §Internationalization). The language switcher is present in `Topbar.astro:55,71` on every signed-in page — if a prior visit flipped the cookie to `en`, all role names above shift to English. The plan must prescribe pinning the cookie in the Playwright setup project:

```ts
await context.addCookies([{ name: "PARAGLIDE_LOCALE", value: "pl", domain: "localhost", path: "/" }]);
```

**Streaming affordance.** `<div role="status" aria-live="polite" className="sr-only">` in `GeneratePanel.tsx:135-139` — a screen-reader-only live region announces bulk progress. Cannot be a wait-for anchor for role-based locators, but `getByRole("button", { name: "Zatrzymaj" })` is visible only when streaming, which is a clean state-change anchor.

**Accept success anchor.** After a successful `POST /api/cards`, `ProposalCard` transitions to a "saved" render at `ProposalCard.tsx:93-98`: the three action buttons disappear, replaced by a check-mark badge with text `Dodano do talii`. The plan's accept-verification step should be `await expect(page.getByText("Dodano do talii")).toBeVisible()` — this is the deterministic anchor that "the accept POST completed and the client saw success."

### 2. AI generation server surface + mock strategy

**Endpoint contract.** `POST /api/generate` at `src/pages/api/generate.ts:30-101`:

- Request Zod schema (`generate.ts:12-14`): `{ text: string(min: 1).max(10_000) }`.
- Success: HTTP 200, `text/plain` streaming body, chunked JSON that grows into `{ proposals: [{question, answer}, …] }`. Client uses `parsePartialJson()` from Vercel AI SDK.
- Error codes registry (UPPER_SNAKE_CASE): `GENERATION_FAILED` (HTTP 502) and `GENERATION_TIMEOUT` (HTTP 504) added in Phase 1. Older pre-Phase-1 codes remain lowercase (`unauthorized`, `invalid json`, `invalid input`).

**SDK boundary.** `generateProposals()` at `src/lib/ai/generate-proposals.ts:35-46`:

```ts
const openrouter = createOpenRouter({ apiKey });
return streamText({ model: openrouter.chat(model), system: SYSTEM_PROMPT, prompt: text, output: Output.object({ schema: proposalsSchema }), abortSignal, onError });
```

Imported at module top level in `src/pages/api/generate.ts:5`. The endpoint's try/catch wraps both the synchronous call and the guarded stream pipe (`generate.ts:67-88`) — Phase 1's F1 fix (see `context/archive/2026-07-29-testing-generation-flow-protection/plan.md` bottom epilogue).

**Env vars (from `astro.config.mjs:34-46`):**

| Name | Type | Access | Required | Local value source |
|---|---|---|---|---|
| `OPENROUTER_API_KEY` | string | `secret` | build-time yes | `.dev.vars:3` |
| `OPENROUTER_MODEL` | string | `public` | no (default `google/gemini-2.5-flash`) | `.dev.vars` / config default |

Cloudflare Worker adapter reads `.dev.vars` at `astro dev` startup (`node_modules/@astrojs/cloudflare/dist/index.js:292-302`) — no wrapper needed.

**Why `page.route()` doesn't help.** The `openrouter.ai` fetch happens inside the Node.js runtime of the Astro/Cloudflare dev server, not in the browser. Playwright's `page.route()` intercepts only browser-originated requests. A `page.route('**/openrouter.ai/**', ...)` handler would never fire.

**Mock strategy options (server-side only):**

| Strategy | Cost | Isolation | Blast radius | Verdict |
|---|---|---|---|---|
| **A**. Env-var-gated fixture branch in `src/lib/ai/generate-proposals.ts` (`if (import.meta.env.OPENROUTER_MOCK === "1") return fixtureStream()`) | Lowest (~10 LoC) | Prod code carries a mock branch, gated by an env var that's never set outside test | Low (env-var typo could flip mock in prod, but requires setting the var) | ✅ Simplest for a single smoke |
| **B**. Node loader hook module swap in a Playwright `webServer` command | Medium (~40 LoC, `--experimental-loader`) | Excellent — prod code untouched | Low, but fragile to Node version changes | ✅ Cleanest boundary, most complexity |
| **C**. Real OpenRouter API with a deterministic canary prompt, structural assertions only (non-empty `question`/`answer`) | Zero (no code) | Excellent | Real $-cost per run, non-deterministic content | ⚠️ Flaky but usable for local exploration |
| **D**. `msw/node` server-side interceptor booted with the `webServer` process | Medium (adds `msw` dep) | Good — test-only middleware layer | Low | Not evaluated in depth; overkill for one test |
| **E**. Test-only endpoint (`GET /api/test/generate-fixture`) + client-side test-mode branch | High | Poor — pollutes client + prod endpoints | Requires disabling in prod | ❌ Rejected — violates the "no client-side test code" boundary |

**Recommendation:** default to **Strategy A (env-var-gated fixture branch)** — the pragmatic choice for a single smoke. It sits behind `OPENROUTER_MOCK=1` set only in `playwright.config.ts`'s `webServer.env`, is trivially auditable in one file (`src/lib/ai/generate-proposals.ts`), and reuses the existing `src/test/fixtures/generate-stream.ts` shape. If the plan reviewer objects to prod-code contamination, escalate to **Strategy B** (Node loader). Reject **C** as the primary path — non-deterministic OpenRouter output makes assertion budgets thin. This is a fork the plan must pick — the research surfaces the trade-off, doesn't decide it.

**Client wiring.** `src/components/generate/GeneratePanel.tsx:24-158` uses `useReducer(proposalsReducer)` + `useProposalStream(dispatch)` hook. The hook (`src/components/hooks/useProposalStream.ts:43-121`) fetches `/api/generate` with `credentials: "include"`, decodes via `TextDecoderStream`, and dispatches `stream/chunk` on each `parsePartialJson` success. On non-2xx: `parseErrorBody()` reads `{ error: code }` JSON, dispatches `stream/abort` with the code, and `errorCodeToMessage()` maps to i18n text.

### 3. Auth + session seeding for Playwright

**PROTECTED_ROUTES.** `src/middleware.ts:5` — manually maintained array: `["/dashboard", "/generate", "/review", "/deck", "/account"]`. Prefix-matched at `src/middleware.ts:46`. Redirect target for unauth'd: `/auth/signin` (`src/middleware.ts:47-49`). Soft-delete gate runs before the protected-route gate (`src/middleware.ts:32-38`) and redirects to `/auth/restore-account`.

**Supabase cookie shape.** `@supabase/ssr` writes a cookie named ``sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`` (`node_modules/@supabase/supabase-js/src/SupabaseClient.ts:295`):
- Local (`SUPABASE_URL=http://127.0.0.1:54321`): **`sb-127-auth-token`**.
- Prod (`https://qxflwgkkhfgvgmoqkszm.supabase.co`): `sb-qxflwgkkhfgvgmoqkszm-auth-token`.

Cookie defaults (`@supabase/ssr/dist/module/utils/constants.js:1-8`): `path: "/"`, `sameSite: "lax"`, **`httpOnly: false`**, `maxAge: 400d`. Value shape: `base64-<base64url(session envelope JSON)>`. Chunked at >3180 bytes into `.0`, `.1`, … suffixes (`chunker.js:1,16-56`); current sessions fit in one cookie.

**`playwright/.auth/user.json` already exists** — captured session for `mk@betasi.pl` (user id `ebb4e5cc-bb4f-4f0c-9f9c-b3c519a02040`) against local Supabase. Path already gitignored (`.gitignore:49`) — good. The plan can't rely on this file being present in cold checkouts; the setup project must recreate it deterministically.

**Local Docker Supabase.**
- `supabase/config.toml` present. API `54321`, DB `54322`, Studio `54324`.
- Migration `20260723165737_soft_delete_and_retention.sql` creates `profiles(user_id, deleted_at, scheduled_hard_delete_at)` with a trigger on `auth.users` that auto-inserts a profile row on signup — any user created via admin API or `/auth/signup` gets a `profiles` row for free.
- **No `SUPABASE_SERVICE_ROLE_KEY` shipped.** `context/deployment/deployment-plan.md:51` explicitly forbids using service_role in prod code. No `supabase-admin.ts` exists. Adding it for tests only is possible but noisy.
- **No `supabase/seed.sql`** — no data seeding pattern to inherit.

**Seeding options (evaluated):**

| Option | Cost | Robustness | Risk-#4 coverage | Fit for "signin → …" wording |
|---|---|---|---|---|
| **A**. Playwright `setup` project via UI signin, capture `storageState` | 30 min | High (captures whatever app writes) | Medium (setup is the only signin exercise) | Partial |
| **B**. `globalSetup` calls `supabase.auth.admin.createUser` + hand-builds cookie envelope | 2h + envelope maintenance | Low (fragile to `@supabase/ssr` internals) | Zero | Partial |
| **C**. Hybrid: setup project + smoke opts out with `test.use({ storageState: { cookies: [], origins: [] } })` (same pattern as `e2e/seed.spec.ts:3`) | 30 min | High | High (smoke IS the exercise) | **Exact match** |

**Recommendation: Option C.** Zero new secrets, no `service_role`, matches Phase 5 wording verbatim. The setup project seeds `playwright/.auth/user.json`; the north-star smoke opts out to prove the full signin path.

**Env-var mapping for e2e:**

| Var | Purpose | Where defined | Action for plan |
|---|---|---|---|
| `SUPABASE_URL` | Base URL | `.dev.vars:1` (local Docker) + `.env:1` (**HOSTED — hazard**) | Ensure Playwright reads via `astro dev` (which uses `.dev.vars`), NOT via `dotenv/config` (which loads `.env`). |
| `SUPABASE_KEY` | anon key | same | same |
| `E2E_USER_EMAIL` | Setup signin identity | undefined; read at `e2e/seed.spec.ts:6` | Plan prescribes `.env.e2e` template. |
| `E2E_USER_PASSWORD` | Setup signin credential | undefined | same |
| `PLAYWRIGHT_BASE_URL` | Points Playwright at dev server | undefined; fallback `http://localhost:3000` at `playwright.config.ts:11` | **BUG** — Astro dev serves on `4321`. Plan must either fix the fallback in config or require env override. |
| `OPENROUTER_API_KEY` | Real OpenRouter | `.dev.vars:3` (live) | If Strategy A (env-var-gated mock), plan sets `OPENROUTER_MOCK=1` in `webServer.env` and this key is not consulted during the smoke. |
| `PUBLIC_SITE_URL` | Password-reset flow | `.dev.vars:5` | No change. |

**Env hygiene tripwire** (per memory `dev-vars-cloud-vs-local.md`): `.env` currently points at hosted (paused free-tier) Supabase. If the plan wires Playwright with `dotenv`, e2e will hit that instance and get 530 (memory `prod-login-530-supabase-paused.md`). The plan MUST NOT add `dotenv/config` in Playwright infra — env flows via `astro dev` → `.dev.vars`.

**Dev-server startup.** `playwright.config.ts:1-22` has **no `webServer` block** — current pattern is "run `npm run dev` in one terminal, `npm run test:e2e` in another." Recommendation: add `webServer: { command: 'npm run dev', url: 'http://127.0.0.1:4321', reuseExistingServer: !process.env.CI, timeout: 120_000, env: { OPENROUTER_MOCK: '1' } }`. `astro dev` picks up `.dev.vars` on its own. `reuseExistingServer: !process.env.CI` keeps local iteration fast.

**Cleanup between tests.** Cards table has `user_id → auth.users(id) on delete cascade` (per archived `2026-07-23-account-deletion-30d-retention/plan.md:41`). Options:

- **Dedicated e2e-north-star user + `afterEach` truncates via RLS-scoped `DELETE`** — cheapest. Uses anon key + user JWT (RLS lets user delete their own rows; `cards_delete_own` policy per archived plan). No service_role.
- Unique user per run: requires service_role, garbage users accumulate.
- `supabase db reset`: nuke-and-repave, ~15s, destroys other in-progress work.

**Recommendation:** dedicated e2e user + per-test `afterEach` DELETE via the existing endpoint `DELETE /api/cards/:card_id` (see §4).

### 4. Accept persistence + review-vs-deck assertion anchor

**Accept endpoint.** `POST /api/cards` at `src/pages/api/cards.ts:52-99`:

- Zod schema (`cards.ts:8-14`): `{ question: string(min:1), answer: string(min:1), source: enum("ai","manual").default("ai") }`.
- Auth: `context.locals.user` required (`cards.ts:53-56`); 401 otherwise.
- RLS: `user_id = user.id` set on insert (`cards.ts:78`); FSRS scheduling state initialized via `emptyCardState()` (`src/lib/review/scheduler.ts`).
- Response 201: `{ card: CardRow }` — full row including `id`, `created_at`, `due`, `state`, `reps`, etc. (`src/db/database.types.ts:38-56`).

**Component wiring.** `GeneratePanel.tsx:42-60`: `onAccept(id)` → `persist()` dispatches `saveStart` → calls `createCard({ question, answer, source: "ai" })` from `src/lib/api/cards.ts:37-52` → on 201: `saveSuccess` action populates `proposal.savedCardId` (used later for potential undo/delete). Bulk-accept (`GeneratePanel.tsx:86-96`) is a **`Promise.allSettled` with concurrency cap 4**, still POSTing per card — no batch endpoint exists.

**Deck view = the deterministic assertion anchor.** `/deck` (`src/pages/deck.astro:20` mounts `DeckPanel` with `client:load`). `DeckPanel` calls `listCards()` on mount (`DeckPanel.tsx:90-96`) → `GET /api/cards` (`src/pages/api/cards.ts:23-50`) which does `supabase.from("cards").select("*").order("created_at", { ascending: false }).limit(1000)` — RLS-scoped to the caller. The accepted card is guaranteed to appear here, sorted first.

**Review view = the functional assertion anchor.** `/review` (`src/pages/review.astro:20` mounts `ReviewSession`). `ReviewSession.tsx:72-93` starts in `phase: "loading"` and calls `loadNext()` which fetches the next-due card via a review-scoped endpoint. FSRS `emptyCardState()` sets `due` in the immediate future — a freshly created card is typically pickable in the current session. But timing is not fully deterministic (relative-to-`now()`), so this is a **weaker** anchor than `/deck`.

**Recommendation for the plan:**
- **Primary assertion (deterministic):** navigate to `/deck` and assert the card's `question` text is visible.
- **Optional secondary assertion (matches test-plan wording of "review"):** navigate to `/review`, wait for the question section, and assert the card's `question` text appears — but only if the plan is willing to accept small non-determinism from FSRS scheduling (e.g., other cards might land first if the user has an existing deck; solved by ensuring the smoke user starts with an empty deck each run via cleanup).

**Cleanup endpoint.** `DELETE /api/cards/:card_id` at `src/pages/api/cards/[card_id].ts:89-133`:
- Auth: required (401 otherwise).
- RLS: `.delete().eq("id", ...)` — cross-user DELETE fails silently, returns 404 (no disclosure).
- Response: 204 (success) or 404 (already deleted / not owned) — both safe under retry.

**E2E cleanup flow:** capture `card.id` from the POST response (already stored in `proposal.savedCardId` in-component; test can read via `page.evaluate` or by intercepting the response body via Playwright's `page.waitForResponse`), then DELETE in `afterEach` using `credentials: "include"`.

### 5. Phase 1 fixture reuse — verdict + gap

**Phase 1 fixtures** (`src/test/fixtures/generate-stream.ts:1-116`) export:
- `successResponse(proposals)` — full happy-path JSON envelope, chunked.
- `truncatedResponse(proposals, cutAfterBytes)` — cut mid-JSON.
- `malformedSuffixResponse(proposals)` — well-formed prefix + garbage tail.
- `errorResponse(status, code)` — HTTP 4xx/5xx with `{ error: code }`.
- `partialThenErrorResponse(proposals, errorAfterBytes)` — 200 + valid prefix + mid-stream `controller.error()`.

Consumed by:
- Component tests (`GeneratePanel.test.tsx:5,87`) via `vi.stubGlobal('fetch', vi.fn().mockResolvedValue(successResponse([...])))`.
- Endpoint tests via `vi.mocked(generateProposals).mockImplementationOnce(...)`.

**Verdict for e2e reuse.** These factories are pure JS functions returning `Response` objects — no Vitest dependency at runtime. But they're only consumable at points where the runtime can substitute a `fetch` return value. In Playwright, that means:
- Not via `page.route()` (server-side call — see §2).
- **Only** via an env-var-gated branch in `generate-proposals.ts` (Strategy A) or a Node loader hook (Strategy B) that produces a stream identical in shape to `successResponse()`.

**Gap:** the factories return `Response`, but `generateProposals()` returns the Vercel AI SDK `streamText()` result object (with a `.stream` property piped through `toTextStream()`). A mock inside `generate-proposals.ts` cannot return a `Response`; it must return the SDK-shaped object. The plan will need to author a small shim — either extract the "produce a JSON-fixture ReadableStream" helper (shared between Vitest and e2e), or accept a slightly-different mock surface in the e2e path. This is a modest cost the plan must budget.

**Phase 1 lessons that carry over:**
- Vitest 4 `projects` split with `extends: true` (per test-plan §6.2 rollout note). N/A for e2e directly.
- `@testing-library/react` v16 + `happy-dom` v20 idiosyncrasies. N/A for Playwright (drives real Chromium).
- Fixture-content shape is stable: `{ proposals: [ { question, answer } ] }` — plan can reuse this shape verbatim.
- Phase 1 did NOT leave behind a programmatic user-seeding pattern; Phase 5 authors its own (via setup project UI signin, per §3 recommendation).

## Code References

- `src/middleware.ts:5` — `PROTECTED_ROUTES` array (auth-gate list).
- `src/middleware.ts:9-14` — `SOFT_DELETE_ALLOWED_PATHS` bypass list.
- `src/middleware.ts:24-49` — session read, soft-delete gate, protected-route gate.
- `src/lib/supabase.ts:10-24` — `createServerClient` with `cookies.getAll`/`setAll`.
- `src/pages/auth/signin.astro:1-27` — signin page, hosts `SignInForm` island.
- `src/components/auth/SignInForm.tsx:1-88` — form + POST to `/api/auth/signin`.
- `src/components/auth/FormField.tsx:37-49` — label ↔ input binding (source of role name).
- `src/pages/dashboard.astro:100-116` — Generate CTA link.
- `src/pages/dashboard.astro:120-128` — Review CTA link.
- `src/pages/generate.astro:1-23` — generate route, mounts `GeneratePanel`.
- `src/components/generate/GeneratePanel.tsx:24-158` — state owner, `useReducer(proposalsReducer)` + `useProposalStream` hook.
- `src/components/generate/GeneratePanel.tsx:42-60` — `persist()` + `onAccept()` handler.
- `src/components/generate/GeneratePanel.tsx:86-96` — bulk-accept with concurrency cap 4.
- `src/components/generate/GenerateForm.tsx:28-61` — textarea + Generate/Stop buttons.
- `src/components/generate/ProposalCard.tsx:88-131` — card render (pending / saving / saved).
- `src/components/generate/ProposalCard.tsx:93-98` — "Dodano do talii" saved-state badge.
- `src/components/generate/ProposalCard.tsx:101-130` — Accept / Edit / Reject buttons.
- `src/components/hooks/useProposalStream.ts:43-121` — client-side stream consumer.
- `src/components/hooks/useProposalStream.ts:11-21` — `parseErrorBody()` — reads UPPER_SNAKE error codes.
- `src/lib/ai/generate-proposals.ts:35-46` — `generateProposals()` SDK boundary (target for Strategy A mock branch).
- `src/pages/api/generate.ts:12-14` — request Zod schema.
- `src/pages/api/generate.ts:30-101` — endpoint, try/catch, guarded stream pipe, status/code mapping.
- `src/lib/api/cards.ts:37-52` — `createCard()` client fetch wrapper.
- `src/lib/api/cards.ts:54-67` — `listCards()`.
- `src/pages/api/cards.ts:8-14` — POST request schema.
- `src/pages/api/cards.ts:23-50` — `GET /api/cards` handler (RLS-scoped SELECT).
- `src/pages/api/cards.ts:52-99` — `POST /api/cards` handler (RLS-scoped INSERT + FSRS init).
- `src/pages/api/cards/[card_id].ts:89-133` — `DELETE /api/cards/:card_id` (cleanup endpoint).
- `src/pages/deck.astro:1-23` — deck view route.
- `src/components/deck/DeckPanel.tsx:90-96` — `listCards()` on mount.
- `src/pages/review.astro:1-23` — review view route.
- `src/components/review/ReviewSession.tsx:72-93` — review session bootstrapping.
- `src/components/review/ReviewSession.tsx:198-231` — Show-answer + rating buttons.
- `src/components/i18n/LanguageSwitcher.tsx:10-44` — locale toggle (tripwire for role-name pinning).
- `src/paraglide/runtime.js:14,25` — locale cookie name (`PARAGLIDE_LOCALE`) + base locale (`pl`).
- `src/layouts/Layout.astro` — `<html lang>` follows `getLocale()`.
- `messages/pl.json:56,57,70,110,116,118-122,127-132,149,154-161` — all Polish role-name strings the smoke will assert on.
- `src/test/fixtures/generate-stream.ts:47-115` — five Phase 1 fixture factories (shape reference for Strategy A/B mock).
- `src/components/generate/proposalsReducer.ts:34-48` — reducer factory (already unit-tested; e2e never asserts on this).
- `playwright.config.ts:1-22` — current Playwright config (baseURL bug + missing `webServer`).
- `e2e/seed.spec.ts:1-43` — existing seed test (UI signin exemplar for setup project).
- `astro.config.mjs:34-46` — `env.schema` for `astro:env/server` (env var registry).
- `supabase/config.toml:60-65` — `[db.seed]` config (points at missing `seed.sql`).
- `supabase/migrations/20260723165737_soft_delete_and_retention.sql` — profiles + auto-insert trigger.
- `context/foundation/test-plan.md:65-66` — Phase 5 row (goal, risks, tools, status).
- `context/foundation/test-plan.md:118-131` — §6.1/§6.2 cookbook (Phase 1 patterns to inherit stylistically).
- `context/deployment/deployment-plan.md:51` — service_role prohibition.
- `.dev.vars:1-5` — local Docker Supabase + local OpenRouter + `PUBLIC_SITE_URL=http://127.0.0.1:4321`.
- `.gitignore:49` — `playwright/.auth/` excluded.

## Architecture Insights

- **Single-file middleware, manual PROTECTED_ROUTES.** `src/middleware.ts:5` is a hand-kept array. Any new page under `/settings/*` or similar slips through unless the array is updated. Phase 5 does not fix this (Phase 3 in `test-plan.md §3` covers it); the smoke just proves the current list is honored end-to-end.
- **Locale cookie strategy is coupled to test role names.** With PL as the base locale and cookie-only strategy, the tests are effectively Polish-locale-scoped. If `en.json` labels drift from `pl.json`, only PL tests catch it; that's an acceptable trade for this project (PRD-driven).
- **Accept flow is a compound risk surface.** The wedge (per test-plan §2 Risk #2) is the accept/reject/edit contract — accept touches (a) UI event handler, (b) reducer state, (c) fetch to `/api/cards`, (d) RLS-scoped insert, (e) FSRS state initialization, (f) response envelope, (g) UI re-render with saved badge. Phase 1 tests (a)–(c) at the component layer. Phase 5 asserts the full seven-hop chain via one round trip. The value-per-test is high because so much wiring is exercised at once.
- **No test-only endpoints exist.** The plan should not add `/api/test/*` endpoints (would violate the "no test-only code in prod paths" boundary). Server-side mock lives in `src/lib/ai/generate-proposals.ts` behind an env var — that is the smallest acceptable footprint.
- **`playwright.config.ts` was authored during exploration (2026-07-31 per `.playwright-cli/` timestamps)**, not from a hardened template. It carries defaults from a template (port 3000) that don't match this project (port 4321). This is a first-item-in-the-plan fix.
- **The touched-file set for Phase 5 first-phase commit will include the two Playwright quality levers** (`e2e/seed.spec.ts` upgrades + a new E2E rules file, per `/10x-e2e` skill setup step 6), plus `playwright.config.ts`, `src/lib/ai/generate-proposals.ts` (mock branch), and a new north-star spec — non-trivial diff for one phase.

## Historical Context (from prior changes)

- **`context/archive/2026-07-29-testing-generation-flow-protection/plan.md`** — Phase 1 landed the fixture module + endpoint try/catch + component tests. Its rollout note (`test-plan.md §6.1/§6.2`) is the pattern reference for how Phase 5 talks about the accept-contract wedge without duplicating what Phase 1 already proved. Phase 1's F1 fix (mid-stream error guard in `generate.ts:67-88`) is directly relevant — the e2e smoke should exercise a happy path, but a follow-up "streaming abort" test could reuse the Phase 1 fixture shape via Strategy A.
- **`context/archive/2026-07-23-account-deletion-30d-retention/plan.md`** — established the CASCADE from `auth.users` to `cards` + soft-delete gate in middleware. Phase 5's cleanup strategy relies on the RLS `cards_delete_own` policy this change landed.
- **`context/archive/2026-07-14-deck-management-crud/`** — landed `DELETE /api/cards/:card_id` (referenced above as the cleanup endpoint).
- **MEMORY: `dev-vars-cloud-vs-local.md`** — dev server hits local Docker Supabase (2026-07-23); `.env` still points at hosted (paused). Phase 5 infra must not `dotenv.config()` in Playwright.
- **MEMORY: `prod-login-530-supabase-paused.md`** — 530 == paused Supabase; if e2e hits it, this is the symptom.

## Related Research

- `context/archive/2026-07-29-testing-generation-flow-protection/research.md` — Phase 1's mapping of the accept/reject/edit UI and endpoint (already grounded the current locators; Phase 5 inherits directly).

## Open Questions

1. **Mock strategy (A vs B vs C)** — the plan reviewer should pick one. Recommendation: A (env-var-gated fixture branch) for lowest cost; escalate to B (Node loader) if reviewer objects to prod-code contamination.
2. **"Review" step assertion target — `/deck` or `/review`?** Test-plan wording says "review". Recommendation: primary anchor at `/deck` (deterministic), optional secondary at `/review` (matches wording but adds FSRS scheduling as a dependency).
3. **Should the smoke be one test or two?** Test-plan §3 Phase 5 says "one deep guard". A single test that walks the full chain matches this exactly. But: if the smoke also wants to exercise **reject** and **edit** as part of proving Risk #2 in an e2e context (test-plan §2 Risk #2 explicitly names those as the wedge), the plan might land 2-3 tests. Recommendation: **one** happy-path test only for Phase 5; reject/edit are already covered by Phase 1's component tests, and the /10x-e2e skill guidance says "1-3 per phase, one per risk."
4. **Locale-pinning mechanism** — should the plan set `PARAGLIDE_LOCALE=pl` in the setup project once (persisted in `storageState`), or per-test via `test.beforeEach`? The setup-project path is cleaner but assumes the cookie survives the storageState capture (needs verification during implementation).
5. **Cleanup on flaky exit** — if a test crashes mid-flow (after POST but before capturing `card.id` for cleanup), the card leaks. Options: (a) accept the leak (dev-only, easy to reset locally); (b) query `GET /api/cards` in `afterEach` and delete any `source: "ai"` card newer than test-start. Recommendation: (a) for the smoke — over-engineering the cleanup for one test isn't warranted.
6. **CI wiring** — this research does not cover CI. Phase 5's plan will need to decide whether to gate CI on this smoke or run it out-of-band. Test-plan §5 says "required after §3 Phase 5 (may be replaced by a manual smoke checklist if Playwright isn't wired in the after-hours budget)" — this decision belongs in the plan or a follow-up change.
