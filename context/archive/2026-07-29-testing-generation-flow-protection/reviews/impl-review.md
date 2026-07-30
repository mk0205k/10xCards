<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Generation-flow Protection (Phase 1 test rollout)

- **Plan**: `context/changes/testing-generation-flow-protection/plan.md`
- **Scope**: All 4 phases (full plan review)
- **Date**: 2026-07-30
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical · 2 warnings · 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Async stream-iteration errors escape the endpoint try/catch

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Plan Adherence + Safety & Quality
- **Location**: `src/pages/api/generate.ts:47-65` · missing test in `src/pages/api/generate.test.ts`
- **Detail**: The plan §"Critical Implementation Details / AI SDK error surface" required the try/catch to wrap **stream setup AND pipe**, and §Phase 2 Contract 6 explicitly named the test case "stream iteration rejects → 502 GENERATION_FAILED". The actual implementation only spans the synchronous setup — once `createTextStreamResponse` returns, the runtime pumps `result.stream` asynchronously and any mid-stream provider error (5xx after partial body, network drop, or the `AbortSignal.timeout` firing while streaming) escapes as an unhandled rejection. The response has already been sent as HTTP 200, so the client sees a truncated body with no `GENERATION_*` code. Endpoint tests only cover synchronous throws (lines 121, 131, 143); the "stream iteration rejects" case is not tested. The fixture module even documents this gap: `partialThenErrorResponse` says "no `GENERATION_*` code — the response headers already indicated 200 so parseErrorBody is not called" (`src/test/fixtures/generate-stream.ts:96-97`).
- **Fix A ⭐ Recommended**: Pipe through a `TransformStream` between `result.stream` and `toTextStream(...)`; in its `flush`/error handler, log the failure and close the downstream stream cleanly. Add the missing test case (mock `generateProposals` to return a stream that rejects mid-iteration; assert the response body closes without a runtime crash).
  - Strength: Removes the unhandled-rejection surface (workerd isolate risk). Lands the plan-named test case. Composable with future client-side truncation detection.
  - Tradeoff: Cannot turn a mid-stream error into a 502 — headers are already sent. Client still sees a truncated 200 until client-side truncation detection lands (deferred per plan §"What We're NOT Doing"). Signal to the user is still incomplete today.
  - Confidence: MEDIUM — the exact `TransformStream` wire-up depends on how Vercel AI SDK's stream error path surfaces; the implementer will need to verify against the SDK during the fix.
  - Blind spot: Whether the SDK already routes iteration errors to a `.finishReason` promise; if so, awaiting it before response construction is a simpler pattern (but breaks streaming UX).
- **Fix B**: Accept the gap; add an addendum to the plan documenting that Phase 2 delivered synchronous-throw protection only, and that async-iteration protection is bundled with the deferred client-side truncation detection (`it.todo` in `useProposalStream.test.tsx`).
  - Strength: Keeps scope discipline strict. Server-side coverage without client-side handling has limited user-facing value anyway.
  - Tradeoff: Leaves the unhandled-rejection risk on Cloudflare Workers. Plan explicitly named this case as in-scope for Phase 2 — accepting the gap means overriding the plan.
  - Confidence: HIGH — the deferral is already partially documented in the plan.
  - Blind spot: Workers-level impact of unhandled rejections (isolate reuse, log-noise budget) — not measured.
- **Decision**: FIXED via Fix A — `onError` callback added to `generateProposals` params; guarded ReadableStream wraps `toTextStream(...)` in `generate.ts` to catch mid-stream errors, log, and close cleanly; missing test "closes the response body cleanly when the SDK stream errors mid-iteration" added to `generate.test.ts`. 81 tests pass, lint + build green.

### F2 — Phase 1 bundled unrelated pre-existing drift adaptation

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; already documented in commit
- **Dimension**: Scope Discipline
- **Location**: commit `40c5831` (Phase 1) — `src/components/Topbar.astro`, `src/components/ui/{alert-dialog,dialog,sheet}.tsx`, `src/pages/api/auth/signup.test.ts`; commit `060a8c6` (Phase 2) — `src/pages/api/review/[card_id]/rate.ts`
- **Detail**: Four categories of edits bundled into Phase 1 and Phase 2 commits were pre-existing drift on master, not planned work: (a) prettier tailwind class-order autofix on 4 UI files, (b) `signup.test.ts` assertion update to match UPPER_SNAKE `ACCOUNT_PENDING_DELETION` behaviour, (c) `rate.ts` Supabase `Json` type-narrowing casts. All are transparently documented in the commit messages as "adapt pre-existing drift to unblock the gate". Legitimate motivation, but the bundling pattern mixes plan-scoped and non-plan-scoped work in the same phase commit and complicates any future revert. `.claude/settings.json` + `.gitignore` (commit `741c19c`, between Phases 2 and 3) is a properly separated unrelated chore — good pattern to emulate.
- **Fix**: For future rollouts, land drift-adaptation edits in their own separate commits before opening the phase's feat/refactor commit (the `741c19c` pattern). No fix needed for the already-shipped commits.
- **Decision**: NOTED — acknowledged as a retrospective observation; commits are already pushed and no code change is possible. Pattern to apply on future rollouts.

### F3 — Plan-named test case "stream iteration rejects" not represented in test file

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Success Criteria
- **Location**: `src/pages/api/generate.test.ts` — no test matches Phase 2 §Contract 6 bullet 2
- **Detail**: This is the test-side mirror of F1. Phase 2 Contract 6 listed four test cases; three landed (sync throw, timeout, happy path). The "stream iteration rejects" case has no corresponding `it(...)`. Success Criteria dimension still PASSes because Progress row 2.1 ("npm test exits 0 with the new endpoint + hook cases passing") is technically true — but the failing case that would have caught F1 is silent-missing. If F1 is fixed via option A, add this test as part of the fix.
- **Fix**: Fold into F1 Fix A.
- **Decision**: FIXED via F1 — new test "closes the response body cleanly when the SDK stream errors mid-iteration" landed as part of F1 Fix A.
