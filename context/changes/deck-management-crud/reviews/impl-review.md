<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Deck Management CRUD (S-03)

- **Plan**: context/changes/deck-management-crud/plan.md
- **Scope**: Phase 1–4 of 4 (full plan)
- **Date**: 2026-07-23
- **Verdict**: NEEDS ATTENTION (triaged: 4 fixed)
- **Findings**: 0 critical · 2 warnings · 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Success Criteria: all Automated rows across the four phases carry SHAs (`5b272cf`, `457fb25`, `3cae625`, `8cba0b0`) — type-check / lint / build each passed at phase commit. Manual verification for Phase 1 (RLS 404s, FSRS byte-identity across edit, `review_history` cascade to 0) was reproduced end-to-end against local Supabase in the current session. Manual UI verification for Phases 2–4 is being run by the user in the browser now.

## Findings

### F1 — Nested interactive elements in CardListItem row

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence / Safety & Quality (a11y)
- **Location**: src/components/deck/CardListItem.tsx:25-66
- **Detail**: The row is an outer `<button type="button">` (for edit-on-click), and the delete affordance is a `<span role="button" tabIndex={0}>` **nested inside** that button. This is invalid HTML — the HTML spec forbids interactive descendants inside `<button>`. Assistive tech may collapse the inner control or expose only one; browsers can reparent or drop focus behavior; Enter/Space activation order varies by engine. Functionally it works today (`stopPropagation` and manual `onKeyDown` are present), but the plan's Phase 3 note said "row becomes a button (**a11y correct**)" — the added delete pill violates that guarantee.
- **Fix A ⭐ Recommended**: Row becomes `<div role="button" tabIndex={0}>` with its own `onClick` + `onKeyDown` for Enter/Space; delete pill becomes a native `<button type="button">` with `e.stopPropagation()` in its click handler. Drops the manual keydown-on-span entirely.
  - Strength: Removes the invalid-HTML violation, gives the inner button native keyboard support for free, matches how shadcn's own primitives layer interactive elements.
  - Tradeoff: Row loses `<button>`'s built-in Enter/Space; you're reimplementing it via `onKeyDown` — but that's one small `if (e.key === "Enter" || e.key === " ")` handler.
  - Confidence: HIGH — this is the standard React a11y pattern; already used by shadcn Dialog trigger patterns in the repo.
  - Blind spot: None significant.
- **Fix B**: Invert the structure — row is a non-interactive `<article>`, with two sibling native buttons inside ("Edytuj" and "Usuń"). No propagation issues, no keyboard shims.
  - Strength: Zero a11y drama; each action has its own native button; users don't have to guess what clicking the row does.
  - Tradeoff: Loses the "click anywhere on the card to edit" affordance the plan explicitly asked for ("Row becomes a button"). A visible-scope UX change.
  - Confidence: MEDIUM — clean from an a11y standpoint but diverges from the plan's Phase 3 UX intent.
  - Blind spot: Whether users have already habituated to click-row-to-edit (unlikely — feature is brand new).
- **Decision**: FIXED

### F2 — PATCH/DELETE don't map RLS error code 42501 to 404

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency / Safety & Quality
- **Location**: src/pages/api/cards/[card_id].ts:65-79, 105-121
- **Detail**: The rate endpoint (`src/pages/api/review/[card_id]/rate.ts:89-93`) explicitly maps Supabase error code `"42501"` (RLS-filtered UPDATE) to 404 — the comment there notes this is deliberate: "Return 404 to avoid disclosing that the id exists but is not owned." The new PATCH/DELETE in `[card_id].ts` rely purely on `.maybeSingle() + !data → 404`, which is empirically correct today (RLS silently returns 0 rows for cross-user attempts, verified against local Supabase this session — cross-user PATCH/DELETE returned 404 both times). But if Supabase's client behavior ever changes to surface an `error` with `code === "42501"` before returning `data: null`, the current code hits the generic 500 path and returns `{error: "update failed"}` / `{error: "delete failed"}`. That distinguishes "not owned" from "not found" and reopens the oracle the rate endpoint closed. Trivial hardening; matches the existing pattern.
- **Fix**: Before the generic `console.error + 500` in both handlers, add:
  ```ts
  if (error.code === "42501") {
    return jsonResponse(404, { error: "not found" });
  }
  ```
  Mirrors `src/pages/api/review/[card_id]/rate.ts:89-93` verbatim.
- **Decision**: FIXED

### F3 — POST spread order lets future body fields overwrite FSRS defaults

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/cards.ts:71-77
- **Detail**: The POST insert spreads client fields first then `...emptyCardState()`:
  ```ts
  .insert({
    user_id: user.id,
    question: parsed.data.question,
    answer: parsed.data.answer,
    source: parsed.data.source,
    ...emptyCardState(),
  })
  ```
  Currently safe — the create `bodySchema` only allows `{question, answer, source}`, none of which collide with FSRS keys. But the schema is **not** `.strict()` (unlike PATCH's), so it silently accepts extra keys today. If a future refactor extends the schema with (say) `state`, and the developer forgets that the spread order matters, `emptyCardState()`'s value wins and the field is silently dropped — or if the order is flipped later without noticing, a client-supplied `state: 2` overwrites scheduler default. Ordering-based safety is brittle.
- **Fix**: Add `.strict()` to the POST `bodySchema` — mirrors the PATCH schema's strictness principle, closes off unknown keys explicitly, decouples correctness from spread order.
- **Decision**: FIXED

### F4 — GET /api/cards has no defensive row cap

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (defensive)
- **Location**: src/pages/api/cards.ts:29-42
- **Detail**: The list query is `.select("*").order("created_at", { ascending: false })` — no `.limit(...)`. The plan explicitly defers server-side pagination as out of scope for MVP (persona ≈ hundreds of cards, well under 1 MB), and the "Performance Considerations" section acknowledges this. Fine as a deliberate choice. Worth calling out that a runaway user (e.g. a test bot creating 100k cards) would hand the client a huge payload and freeze the browser filter. A defensive `.limit(1000)` costs nothing and lets the future pagination change ship without a scary migration.
- **Fix**: Add `.limit(1000)` after the `.order(...)` call. If the returned length equals 1000, log a warning so this is surfaced before it becomes a real problem.
- **Decision**: FIXED
