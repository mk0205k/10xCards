# Generation-flow Protection (Phase 1) — Plan Brief

> Full plan: `context/changes/testing-generation-flow-protection/plan.md`
> Research: `context/changes/testing-generation-flow-protection/research.md`

## What & Why

First rollout phase of the project's test plan. Two H×H risks land coverage in this pass: **#1** silent AI-generation drift (OpenRouter response variants + parser gap that emits "cards that look weird") and **#2** the accept/reject/edit UI contract that is the product wedge. Without this phase the two risks the test plan flagged as highest-impact stay open, and every subsequent phase inherits an unwired `npm test` gate.

## Starting Point

Vitest 4 runs 9 tests today (6 endpoint + 2 unit + 1 reducer), all under a single `node` environment. `@testing-library/react`, `happy-dom`, and any component-level mocking are absent. The generation endpoint has no try/catch around the AI SDK call, no 30s timeout, and no `GENERATION_*` codes in `src/lib/error-messages.ts` — a provider exception surfaces as an Astro 500 HTML page the client can't display as an i18n message. The reducer is fully unit-tested; the component tree that owns the accept / reject / edit / bulk-action wiring has zero coverage.

## Desired End State

`npm test` runs a Vitest 4 two-project split (node for endpoint / lib tests, happy-dom for component / hook tests) with all 9 existing tests still passing, plus new tests protecting both risks. The endpoint returns JSON `{ error: "GENERATION_FAILED" | "GENERATION_TIMEOUT" }` (HTTP 502 / 504) on provider failure, and the client hook translates the code into a localized message. A panel-level component test drives accept / reject / edit-then-accept / bulk-accept / bulk-reject against fetch stubs. `test-plan.md §5` `unit + integration` gate is flipped to `required`, `§6.1` + `§6.2` cookbook entries point at concrete reference tests, and `.github/workflows/ci.yml` runs `npm test` between `lint` and `build`.

## Key Decisions Made

| Decision                                | Choice                                                                                        | Why (1 sentence)                                                                                                                     | Source        |
| --------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| Two H×H risks in this phase             | #1 (AI-generation drift) + #2 (accept/reject/edit contract)                                   | Phase 1 of `test-plan.md §3` scopes exactly these two rows.                                                                          | Test-plan     |
| Silent-loss surface identified          | `useProposalStream.ts:65-82` never detects truncation                                         | Research §Silent-loss gap — hook fires `stream/done` regardless of mid-JSON cut.                                                     | Research      |
| Endpoint has no error/timeout wrapper   | `src/pages/api/generate.ts:37-43` bubbles exceptions as Astro 500 HTML                        | Research §Live-code map — no try/catch, no `GENERATION_*` codes, no `AbortSignal.timeout`.                                           | Research      |
| Phase scope                             | Tests + minimal endpoint hardening (try/catch + 2 error codes + 30s timeout)                  | Test-only leaves Risk #1 provider-failure oracle unassertable; full hardening incl. truncation detection is a product-design decision deferred to a later phase. | Plan          |
| Mocking approach                        | `vi.stubGlobal('fetch', ...)` + hand-crafted `ReadableStream` fixtures                        | Zero new deps; matches existing test patterns (`vi.mock` for Supabase / OpenRouter provider); MSW is overkill for 6-10 tests.        | Plan          |
| Wire-fixture location                   | `src/test/fixtures/generate-stream.ts` (dedicated tree)                                       | Same fixture reused by endpoint tests AND hook tests; stable pointer for §6.1 cookbook entry; Phase 4 can drop fixtures under same root. | Plan          |
| Component-test file naming              | Co-located `<Component>.test.tsx`                                                             | Matches existing reducer pattern (`proposalsReducer.test.ts` next to source); `.tsx` extension picks up dom project glob cleanly.    | Plan          |
| Component-test mount level              | Mount `GeneratePanel` end-to-end                                                              | The exact seam Risk #2 names (button → dispatch → POST payload) sits at the panel level; smaller-unit tests would miss the wiring. | Plan          |
| Response-variant breadth                | 5 variants (success, mid-JSON truncation, malformed suffix, HTTP 5xx pre-body, 5xx after partial) | Matches every variant named in `test-plan.md §2 Risk Response Guidance` row 1; single `it.todo` documents the deferred truncation face. | Plan          |
| Error codes registered                  | `GENERATION_FAILED` + `GENERATION_TIMEOUT`                                                    | Two codes cover the two distinct UI stories (transient failure vs. slow); rate-limit / unavailable defer to Phase 4 (Risk #5).       | Plan          |
| CI wiring timing                        | Wire `npm test` in Phase 4 (last sub-phase)                                                   | Honors the test-plan's own §5 gate promise; every subsequent phase benefits from the CI ratchet.                                     | Plan          |
| Vitest 4 migration path                 | `test.projects: [{ node, environment: "node" }, { dom, environment: "happy-dom" }]` with `extends: true` | `environmentMatchGlobs` removed in Vitest 4; `extends: true` inherits top-level `resolve.alias` (`@` → `./src`).                     | Research (Context7) |

## Scope

**In scope:**
- Install `@testing-library/react` + `@testing-library/dom` + `happy-dom` (+ `@testing-library/user-event` if not transitive)
- Migrate `vitest.config.ts` to `projects` split
- Register `GENERATION_FAILED` / `GENERATION_TIMEOUT` codes + i18n messages in both locales
- Wrap `generateProposals()` in try/catch + 30s `AbortSignal.timeout`
- Teach `useProposalStream.ts` to parse JSON error body from non-2xx responses
- Author `src/test/fixtures/generate-stream.ts` with 5 factory variants
- Extend `src/pages/api/generate.test.ts` (provider failure paths)
- New `src/components/hooks/useProposalStream.test.tsx` (client-side reducer terminal states)
- New `src/components/generate/GeneratePanel.test.tsx` (Risk #2 sub-oracles)
- Fill `test-plan.md §6.1` + `§6.2` cookbook entries; flip `§5` gate to `required`
- Add `npm test` step to `.github/workflows/ci.yml`

**Out of scope:**
- Truncation detection in `useProposalStream` (research Q5 — product design decision deferred)
- Rate-limit / cost-cap code and tests (Phase 4 territory — Risk #5)
- Two-user RLS integration tests (Phase 2 — Risk #3)
- Middleware / protected-route gate tests (Phase 3 — Risk #4)
- E2E smoke tests with Playwright (Phase 5 — deferred)
- Retrofitting existing lowercase `unauthorized` / `invalid json` codes to UPPER_SNAKE
- MSW / undici mock agent
- Coverage tooling
- Per-edit / pre-commit hooks (Lesson 3 territory, not this phase)

## Architecture / Approach

Four phases in strict dependency order. Phase 1 lands infrastructure (deps + Vitest projects split), Phases 2 and 3 are TDD-shaped (each has a nameable first red assertion), Phase 4 closes with cookbook + CI ratchet.

```
Phase 1 (infra)     → Phase 2 (Risk #1)      → Phase 3 (Risk #2)  → Phase 4 (cookbook + CI)
  install deps        try/catch + timeout      GeneratePanel        §6.1 + §6.2 + §5 flip
  vitest projects     GENERATION_* codes       .test.tsx            npm test in ci.yml
  keep 9 tests green  fixture module            5 user-flow cases
                      hook error-body parse
                      endpoint + hook tests
```

The `dom` Vitest project runs only `.test.tsx` files; the `node` project runs only `.test.ts`. Fixture module (`@/test/fixtures/generate-stream`) is imported by both projects. `global.fetch` is stubbed per test via `vi.stubGlobal`; endpoint tests continue to use the existing `vi.mock('@/lib/ai/generate-proposals')` pattern with new failure signatures.

## Phases at a Glance

| Phase                            | What it delivers                                                                                   | Key risk                                                                                                     |
| -------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1. Testing infrastructure        | Vitest 4 projects split (node + dom); RTL v16 + happy-dom installed; all 9 existing tests still pass | `extends: true` gotcha on the projects config — alias inheritance fails silently if missed                    |
| 2. Risk #1 hardening + tests     | `GENERATION_*` codes with i18n; try/catch + 30s timeout on endpoint; hook parses JSON error body; endpoint + hook tests | AI SDK error surface may be at stream iteration, not `streamText()` invocation — try/catch must span both      |
| 3. Risk #2 component contract    | `GeneratePanel.test.tsx` with 5 user-flow cases (accept / reject / edit / bulk-accept / bulk-reject) | Radix / shadcn `AlertDialog` under happy-dom occasionally needs an explicit `await` for portal mount timing   |
| 4. Cookbook + CI ratchet         | `test-plan.md §6.1`/`§6.2` filled; `§5` gate flipped to required; `npm test` wired in `ci.yml`     | CI run reveals a flaky test from Phase 2 or 3 under GitHub Actions' cold cache — surfacing is a good outcome |

**Prerequisites:**
- `context/foundation/test-plan.md` complete (done — §3 Phase 1 row `change opened`)
- Research complete: `context/changes/testing-generation-flow-protection/research.md`
- Git commit `3f2eb7a` (or later) — verified pushed to `origin/master`

**Estimated effort:** ~4-6 sessions across 4 phases; Phase 2 and 3 have the highest per-phase cost (test authoring + assertion tuning); Phase 1 and 4 are ~30 minutes each.

## Open Risks & Assumptions

- **Assumption**: `AbortSignal.timeout(30_000)` is available under the project's current `compatibility_date` in `wrangler.jsonc`. If not, Phase 2 falls back to the `AbortController` + `setTimeout` pattern — same behavior, one extra local variable.
- **Assumption**: `@testing-library/react@^16` is compatible with the current React 19 pin (`^19.2.6`). Context7-verified 2026-07-29; peer deps allow `react ^18.0.0 || ^19.0.0`. If a peer conflict surfaces on install, pin to the latest v16 with explicit `--legacy-peer-deps` — small friction, not a blocker.
- **Risk**: Radix AlertDialog rendering under happy-dom may need explicit portal-mount awaits in Phase 3. Mitigated by RTL's `findByRole('alertdialog')` which polls until the dialog is in the DOM.
- **Risk**: `AbortSignal.timeout` + Vitest fake timers interaction. Timeout tests in Phase 2 need `vi.useFakeTimers()` + `vi.advanceTimersByTime(30_001)`; if the AI SDK's abort listener isn't wired to Vitest's mocked clock, the test hangs. Mitigation: verify by writing the failing test first (TDD principle in Phase 2's plan phrasing).
- **Risk**: Adding `npm test` to CI in Phase 4 exposes a flaky test that only manifests under GitHub Actions' single-CPU runner. This is a *good* signal — the CI ratchet works — but may require one follow-up commit to stabilize before the phase closes.

## Success Criteria (Summary)

- `npm test` runs both `node` and `dom` projects green, locally and in CI
- Deliberately breaking `OPENROUTER_API_KEY` in dev renders the localized `error_generation_failed` message on `/generate` (both PL and EN)
- Failed generation returns HTTP 502 with `{ "error": "GENERATION_FAILED" }` JSON body (verified via dev-tools network tab)
- The `test-plan.md §5` `unit + integration` row reads `required (this phase)` after Phase 4 lands
- A future contributor unfamiliar with this rollout can locate reference tests for endpoint-with-LLM-call and component-with-accept-reject-edit within 30 seconds of reading `test-plan.md §6.1` / `§6.2`
