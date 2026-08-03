<!-- PLAN-REVIEW-REPORT -->
# Plan Review: North-star e2e smoke

- **Plan**: `context/changes/testing-north-star-e2e-smoke/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-03
- **Verdict**: REVISE → **SOUND after triage** (F1, F2, F3, F4 fixed; F5 skipped)
- **Findings**: 0 critical  2 warnings  3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

10/10 paths ✓, 6/6 new-paths-absent ✓, `/auth/signup` exists ✓, brief↔plan ✓, `generateProposals` blast radius = 2 callers (endpoint + test).

## Findings

### F1 — Mock SDK-shape contract described with wrong API surface

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 2 Change #2 (Contract), § Critical Implementation Details, plan-brief.md § Open Risks
- **Detail**: Plan says mock must be "shape-compatible with streamText()'s consumer contract... specifically: whatever `.textStream` / `.toTextStreamResponse()` method the endpoint pipes through". `src/pages/api/generate.ts:67` actually reads `result.stream` and pipes through `toTextStream({ stream: result.stream })`. The mock must return `{ stream: <AsyncIterable of Vercel AI SDK stream event parts — minimally `{type: 'text-delta', textDelta: string}` chunks + trailing `{type: 'finish', ...}`> }` so that `toTextStream` produces the JSON envelope text. If the implementer takes the plan literally and builds `.textStream` / `.toTextStreamResponse()`, they hit a mismatch during Phase 2 unit test.
- **Fix ⭐ Recommended**: Update plan Phase 2 Change #2 Contract, § Critical Implementation Details, and plan-brief § Open Risks to name `.stream` (not `.textStream` / `.toTextStreamResponse()`) and specify the event-stream shape.
  - Strength: Zamyka lukę w Contract; unit test staje się precyzyjny; zero zmian w kodzie planu.
  - Tradeoff: Kilka linijek edytu w 3 miejscach.
  - Confidence: HIGH — surface potwierdzony przez Read `generate.ts:67` + archived plan (2026-07-29 §43).
  - Blind spot: Nie zweryfikowałem dokładnego typu eventów SDK (może być `{type:'text',text:...}` zamiast `{type:'text-delta',...}`) — implementer musi doczytać z `node_modules/ai/*.d.ts`.
- **Decision**: FIXED via Fix — Phase 2 Change #2 Contract, § Critical Implementation Details, Phase 2 Change #5 unit test spec, and plan-brief § Open Risks all updated to name `.stream` + AsyncIterable event shape; unit test now feeds mock's stream through `toTextStream` and asserts JSON envelope.

### F2 — Phase 4 reads proposal question via getByRole that likely doesn't exist

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 4 Change #1 Contract step 4
- **Detail**: Plan says "Capture the first proposal's question text (`page.getByRole('article').first().locator(...).textContent()` or equivalent role-based read)". `ProposalCard.tsx:88-92` renders `<Card>` (shadcn, typically `<div>` not `<article>`) with `<CardTitle>{proposal.question}</CardTitle>` (shadcn, typically `<div class="text-2xl font-semibold">` not `<h3>`). Neither `getByRole('article')` nor `getByRole('heading')` will match without prod-code changes. Since we control `DEFAULT_MOCK_PROPOSALS`, the question text is known upfront — the test can `page.getByText(MOCK_QUESTION_TEXT)`.
- **Fix ⭐ Recommended**: Change Phase 4 Change #1 step 4 to "use `page.getByText(MOCK_QUESTION_TEXT)` — import the known constant from the mock module; do not read from DOM". Step 5 unchanged (`waitForResponse` still captures cardId independently).
  - Strength: Zero zmian w prod code, deterministyczne, zgodne z E2E rule o unique test data.
  - Tradeoff: Test coupled do wewnętrznej zawartości mock module (import konstanty).
  - Confidence: HIGH — kontrolujemy mock w Phase 2.
  - Blind spot: Jeśli w przyszłości mock będzie pobierał fixtury dynamicznie, test musi się zmienić.
- **Decision**: FIXED via Fix — Phase 4 Change #1 step 4 updated to `getByText(MOCK_QUESTION_1)` (imported from mock module); step 7 assertion also switched to `getByText`; step 8 rewritten to close F4 simultaneously (see F4 Decision).

### F3 — Skill handoff /10x-implement ↔ /10x-e2e not documented in plan.md

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: plan.md § Implementation Approach
- **Detail**: plan-brief mówi wprost "Phase 1/2/3/5 → /10x-implement; Phase 4 → /10x-e2e", ale plan.md nie zawiera tej informacji. Jeśli user zacznie od `/10x-e2e testing-north-star-e2e-smoke phase 1`, /10x-e2e's Setup step 6 auto-utworzy quality levers w Phase 1's commit — czyniąc Phase 3 pustym. Nie fatalny (redirect z gate'a działa), ale phasing planu przyjmuje że /10x-implement prowadzi Phase 1.
- **Fix**: Add one-line note in plan.md § Implementation Approach: "Phase 1/2/3/5 driven by `/10x-implement`; Phase 4 driven by `/10x-e2e`."
- **Decision**: FIXED via Fix — added "Skill routing (canonical)" paragraph to § Implementation Approach naming which skill drives which phase and the consequence of starting with `/10x-e2e phase 1` instead.

### F4 — /review "Sesja zakończona fallback" too permissive — may mask accept failure

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 4 Change #1 Contract step 8
- **Detail**: Step 8 mówi "assert `Sesja zakończona` fallback if scheduling puts the card later in the queue (accept both — the secondary anchor is best-effort)". Ale jeśli accept POST po cichu zawiedzie i talia zostanie pusta, /review pokaże "Sesja zakończona" — test przejdzie mimo zerwanego contract'u. /deck primary anchor to łapie deterministycznie, więc /review jest tak naprawdę tylko "smoke of the FSRS hop wiring".
- **Fix**: Change step 8 to "navigate to /review, wait for the page to load without error (page-level heading visible), do not assert on specific content — /review is a smoke of the FSRS hop, /deck is the assertion".
- **Decision**: FIXED via Fix — Phase 4 Change #1 step 8 rewritten to load-only smoke; removed permissive `Sesja zakończona` fallback (applied together with F2 edit).

### F5 — Migration Note "delete stale playwright/.auth/user.json" is over-cautious

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: plan.md § Migration Notes
- **Detail**: Setup project's `page.context().storageState({ path: ... })` atomically overwrites the file. Playwright runs dependencies sequentially before dependents, so stale content is replaced before other projects read it. The "delete before first run" recommendation adds a manual step with no gain.
- **Fix**: Remove the sentence "Recommend deleting it before first run of the setup project to force a clean capture" from Migration Notes.
- **Decision**: SKIPPED — user left the defensive note in place; harmless if unused.
