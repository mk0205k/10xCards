<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: First Review Session — S-02

- **Plan**: `context/changes/first-review-session/plan.md`
- **Scope**: All 5 phases (full plan review)
- **Date**: 2026-07-14
- **Verdict**: APPROVED
- **Findings**: 0 critical · 0 warnings · 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

**Overall: APPROVED** — no critical or warning-level findings; the two dimension WARNINGs are driven only by LOW-impact observations (documented drift and additive scope). All hard rules honoured (`prerender = false`, RLS + granular policies in the migration, no `"use client"`, no secrets in client code, react-compiler-safe hooks). Success criteria across `supabase test db`, `npm run lint`, `npm test`, `npm run build`, `npm run deploy:dry` all green in Phase 5 (commit `9a6e881`). Every manual Progress row carries a phase-close SHA — no rubber-stamping.

## Findings

### F1 — ts-fsrs pinned to 5.x, plan specified "latest 6.x"

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `package.json:41`
- **Detail**: Plan §Phase 2 §1 reads "Add ts-fsrs as a runtime dependency at the latest 6.x version". Actual dep is `"ts-fsrs": "^5.4.1"`. Consequence: `src/lib/review/scheduler.ts:65` carries an `eslint-disable @typescript-eslint/no-deprecated` shim for `elapsed_days` (deprecated in 6.x). Functional today; will need to be revisited when upgrading.
- **Fix**: Open a follow-up ticket to upgrade `ts-fsrs` to `^6` and remove the `no-deprecated` shim. No behaviour change expected; run scheduler tests and the pgTAP suite as gate.
- **Decision**: SKIPPED — ts-fsrs 6.x not yet published on npm (latest = 5.4.1); the "6.x" wording in the plan was prospective. Existing shim + comments already document the intent. Revisit when 6.0 lands.

### F2 — ReviewSession uses useReducer where plan called for useState

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/components/review/ReviewSession.tsx:64-98`
- **Detail**: Plan §Phase 4 §3 contract: "Uses `useState` for `phase`, `data` (NextResponse), `revealed`, `error`. No reducer necessary (state is linear)." Actual implementation uses `useReducer` with an `Action` union; `revealed` is folded into `phase === "answer"`. Behaviour equivalent; state machine matches the described phases.
- **Fix**: Keep as-is. The reducer is arguably cleaner for the 4-state machine and remains react-compiler-safe (no manual memoization).
- **Decision**: SKIPPED — user confirmed to keep useReducer; behaviour matches plan's state machine.

### F3 — Extra append-only indexes on review_history not in plan

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `supabase/migrations/20260709120000_fsrs_state_and_review_log.sql`
- **Detail**: Plan §Phase 1 lists only `cards_user_due_idx`. Migration additionally creates `review_history_user_review_idx` and `review_history_card_idx`. Both are sensible for the append-only log (per-user chronological reads + per-card audit lookups) and add negligible storage cost.
- **Fix**: Keep — additive scope justified by the append-only access pattern.
- **Decision**: SKIPPED — user confirmed to keep the extra indexes; benign additive scope.

### F4 — Extra RPC serializer helpers in scheduler service

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `src/lib/review/scheduler.ts`
- **Detail**: Plan §Phase 2 §2 lists named exports: `defaultScheduler`, `createScheduler`, `emptyCardState`, `hydrateCard`, `computePreview`, `formatInterval`. Actual module also exports `serializeCardForRpc`, `serializeLogForRpc`, `RpcCardPayload`, `RpcLogPayload`. These are required by Phase 3's rate endpoint per §"marshal both to plain JSON" but were not declared in Phase 2's contract.
- **Fix**: Keep — implicitly required by Phase 3 and keeps date/ISO marshalling in one place.
- **Decision**: SKIPPED — user confirmed to keep the serializers in scheduler.ts.

### F5 — Rate endpoint maps RPC 42501 → 404 (defensive extra)

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (positive)
- **Location**: `src/pages/api/review/[card_id]/rate.ts:89-92`
- **Detail**: Plan §Phase 3 §2 lists "500 supabase / rpc errors". Actual code additionally intercepts PostgreSQL error code `42501` (RLS-denied UPDATE inside `SECURITY INVOKER` RPC) and returns 404 rather than surfacing the RLS denial as a 500 or 403. This prevents ownership disclosure via error-code side channel.
- **Fix**: Keep — the mapping is a defensible security refinement and matches the endpoint's existing "unknown card → 404" behaviour for cross-user attempts.
- **Decision**: SKIPPED — user confirmed to keep the 42501→404 mapping (defence-in-depth).
