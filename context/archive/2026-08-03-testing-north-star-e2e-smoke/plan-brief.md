# North-star e2e smoke — Plan Brief

> Full plan: `context/changes/testing-north-star-e2e-smoke/plan.md`
> Research: `context/changes/testing-north-star-e2e-smoke/research.md`

## What & Why

Close `context/foundation/test-plan.md` §3 Phase 5 by delivering one Playwright north-star smoke test (`signin → paste → generate → accept → deck → review`) that protects the cross-cutting cluster of Risk #1 (AI-generation drift), Risk #2 (accept/reject/edit contract), and Risk #4 (auth gate). Wedge protection: the accept flow crosses seven hops (UI event → reducer → fetch → RLS insert → FSRS init → response → re-render) and only e2e proves the whole chain from a real browser.

## Starting Point

Playwright 1.62.1 is installed (`package.json:54`) and `playwright.config.ts` + `e2e/seed.spec.ts` exist as uncommitted 2026-07-31 exploration. Config carries a wrong `baseURL` default (`localhost:3000` — Astro dev runs on `4321`), no `webServer` block, and a global `storageState` that references a gitignored file. Seed has a working signin-persistence exemplar plus a skipped placeholder with fake role names. Phase 1 (`context/archive/2026-07-29-testing-generation-flow-protection/`) shipped `src/test/fixtures/generate-stream.ts` factories, but they return `Response` — not the `streamText()` SDK shape the endpoint consumes, so a small shim is required for e2e reuse.

## Desired End State

`npm run test:e2e` runs green from a cold checkout (given local Supabase + `.env.e2e` filled). Config is hardened (correct port, `webServer` with `reuseExistingServer: !CI`, `setup` project). A single `src/lib/ai/generate-proposals.ts` env-var-gated branch backed by `OPENROUTER_MOCK=1` returns deterministic mock proposals — no OpenRouter cost, no flake. `e2e/CLAUDE.md` carries E2E rules; `e2e/seed.spec.ts` is a clean exemplar; `e2e/north-star.spec.ts` walks the full flow, cleans up its card via `DELETE /api/cards/:id`, and provably fails when the accept path breaks (deliberate-break check). `test-plan.md §6.6` reads as onboarding for a next contributor; §3 Phase 5 status flips to `complete`.

## Key Decisions Made

| Decision                             | Choice                                                          | Why (1 sentence)                                                                                                                    | Source   |
| ------------------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------- |
| OpenRouter mock strategy             | Env-var branch in `generate-proposals.ts` gated by `OPENROUTER_MOCK=1` | ~15 LoC in one auditable file; deterministic, zero-cost, reuses Phase 1 fixture content shape.                                       | Plan     |
| Assertion anchor for "review" step   | Primary `/deck` (deterministic RLS-scoped GET), secondary `/review` (FSRS session) | `/deck` is the deterministic proof; `/review` matches test-plan wording and adds functional end-to-end coverage of the FSRS hop.     | Plan     |
| Test count                           | 1 test — happy path only                                        | Matches test-plan "one deep guard"; reject/edit already covered by Phase 1's component test; keeps flake surface minimal.            | Plan     |
| Test user identity                   | Dedicated `e2e-north-star@local.test` (local Supabase)          | Isolates test data from developer account; parallel-safe; no `service_role` needed.                                                  | Plan     |
| CI wiring                            | Deferred to a follow-up change                                  | Mixing CI setup (secrets, matrix, local-Supabase-in-CI) with test authoring stretches this change; test-plan §5 gate stays `planned`. | Plan     |
| Seeding pattern                      | Playwright `setup` project via UI signin; smoke opts out         | Zero new secrets, no `service_role` (honors `context/deployment/deployment-plan.md:51`); smoke IS the Risk #4 acceptance oracle.     | Research |
| Locale pin                           | `PARAGLIDE_LOCALE=pl` cookie set in setup project + per-test    | Language switcher visible on every page — a prior EN flip silently breaks all role-based locators.                                   | Research |
| Cleanup pattern                      | `afterEach` DELETE via captured `card.id` (existing endpoint)   | Endpoint is RLS-scoped and idempotent (204/404 both safe); no new admin surface needed.                                              | Research |

## Scope

**In scope:**

- Playwright config hardening (baseURL, `webServer`, `setup` project)
- Server-side OpenRouter mock via `OPENROUTER_MOCK` env-var branch + unit test
- `e2e/CLAUDE.md` (E2E rules) + `e2e/seed.spec.ts` cleanup
- `e2e/north-star.spec.ts` — the smoke itself
- `test-plan.md §6.6` cookbook fill-in + §3 Phase 5 status flip

**Out of scope:**

- CI/GitHub Actions wiring (deferred to a follow-up change)
- Second/third e2e test (reject / edit variants stay at component layer)
- Real OpenRouter integration test (Phase 1 covers this)
- Visual regression, accessibility tests, cross-browser matrix (per §7 negative space)
- Middleware unit tests for PROTECTED_ROUTES (test-plan Phase 3 owns this)
- Fixing `.env` vs `.dev.vars` drift beyond the "don't `dotenv/config` in Playwright" rule

## Architecture / Approach

Five phases, each landing an independent conventional-commit. Infrastructure lands first (config + mock + levers), then the smoke test itself, then the cookbook close-out.

```
Phase 1 (config) → Phase 2 (mock branch) → Phase 3 (levers) → Phase 4 (smoke) → Phase 5 (cookbook)
   /10x-implement       /10x-implement           /10x-implement        /10x-e2e        /10x-implement
```

`/10x-e2e`'s browser-level-fit gate passes only on Phase 4; the other four phases fail the gate and get redirected to `/10x-implement`. This is by design — the plan interleaves the two skills naturally.

Mock architecture: `src/lib/ai/generate-proposals.ts` gets one env-var branch (~3 lines) that delegates to a new sibling module `src/lib/ai/generate-proposals-mock.ts` (SDK-shape shim). Real path is untouched. Endpoint (`src/pages/api/generate.ts`) is untouched. Fixture content shape reused from `src/test/fixtures/generate-stream.ts` (proposals list envelope), but the shim wraps it in the `streamText()` consumer shape the endpoint expects.

## Phases at a Glance

| Phase                                              | What it delivers                                                              | Key risk                                                                                             |
| -------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1. Playwright config + auth setup                  | Correct baseURL, `webServer`, `setup` project, `playwright/setup/auth.setup.ts`, `.env.e2e.example`, README | `playwright/.auth/user.json` stale from prior 2026-07-31 exploration — must be deleted before first setup run. |
| 2. Server-side OpenRouter mock                     | `OPENROUTER_MOCK=1` env-var branch + `generate-proposals-mock.ts` shim + unit test | SDK-shape contract is not fully public API — shim may break on `@openrouter/ai-sdk-provider` upgrades. |
| 3. E2E quality levers                              | `e2e/CLAUDE.md` (rules) + cleaned `e2e/seed.spec.ts`                          | Delete of the skipped placeholder is a technical-debt cleanup — verify the seed exemplar still teaches the right pattern. |
| 4. North-star smoke                                | `e2e/north-star.spec.ts` (signin → paste → generate → accept → deck → review) | Card leak if test crashes before capturing `card.id`; FSRS scheduling could put the card off-queue in `/review` (secondary anchor is best-effort). |
| 5. Cookbook §6.6 + close-out                       | `test-plan.md` §6.6 filled, §3 Phase 5 → `complete`, §8 Ledger stamped        | Prose only; risk is minimal — main check is that §6.6 reads well for a stranger.                     |

**Prerequisites:**

- Local Docker Supabase running (`supabase start`).
- Dedicated e2e user (`e2e-north-star@local.test`) created once via `/auth/signup` UI in local dev.
- `.env.e2e` filled with `E2E_USER_EMAIL` / `E2E_USER_PASSWORD`.
- Playwright browsers installed (`npx playwright install chromium` if not already done).

**Estimated effort:** ~2 sessions across 5 phases; Phase 2 (mock shim) and Phase 4 (smoke authoring + deliberate-break) are the heavy lifting; Phases 1, 3, 5 are mechanical.

## Open Risks & Assumptions

- **SDK-shape contract may drift.** `@openrouter/ai-sdk-provider` + Vercel AI SDK's `streamText()` return shape is used by `src/pages/api/generate.ts:67` — specifically `result.stream`, an AsyncIterable of stream event parts (`{type:'text-delta',textDelta:string}` chunks + a terminal `{type:'finish',...}`) that `toTextStream({ stream })` converts to plain text. The mock returns just `{ stream }` in the same event shape; Phase 2 unit test pins it precisely by feeding the mock's stream through `toTextStream` and asserting the JSON envelope. If the SDK bumps a major version and renames the event discriminant, both the shim and endpoint need re-verification.
- **`playwright/.auth/user.json` from prior exploration** (2026-07-31, `mk@betasi.pl` session) may still be on disk. If not deleted before Phase 1's setup runs, tests using it inherit the wrong user and produce confusing failures. Migration note in the plan calls this out.
- **FSRS scheduling for freshly-created cards** — `emptyCardState()` sets `due` in the immediate future, so the card *should* be pickable in `/review`, but if another due card exists first the assertion may need broader tolerance. The plan uses "assert question text OR `Sesja zakończona` fallback" to accept both orderings.
- **`.env` still points at hosted paused Supabase** (memory `dev-vars-cloud-vs-local.md`). This plan does not fix that — it explicitly forbids `dotenv/config` in Playwright to prevent `.env` from leaking in. If someone adds `dotenv` later, the smoke will fail with 530s (memory `prod-login-530-supabase-paused.md`).

## Success Criteria (Summary)

- `npm run test:e2e` runs green end-to-end from a cold checkout given the documented prerequisites.
- Deliberate-break check: mutate `DEFAULT_MOCK_PROPOSALS` to break the accept path → smoke goes red; revert → smoke goes green. This proves the assertion is tied to the risk, not decorative.
- `test-plan.md §6.6` filled in as concrete onboarding; §3 Phase 5 status = `complete`.
