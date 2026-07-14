<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Deck Management CRUD (S-03)

- **Plan**: `context/changes/deck-management-crud/plan.md`
- **Mode**: Deep
- **Date**: 2026-07-14
- **Verdict**: REVISE (light — one contract gap + three low-impact polish items)
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

9/9 paths ✓, 2/2 symbols ✓ (CreateCardError has exactly 2 sites: def + one call in `src/components/generate/GeneratePanel.tsx:5,36`; cards RLS policies use `auth.uid() = user_id` on select/insert/update/delete per `supabase/migrations/20260707200908_initial_schema.sql:79-102`), Zod `~4.4.3` (`.strict()` still rejects unknown keys), shadcn `components.json` present so `npx shadcn@latest add dialog input` will work, brief↔plan consistent.

## Findings

### F1 — Zero-rows detection for PATCH/DELETE unspecified

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real gap; implementer needs Supabase/PostgREST nuance not visible from the current codebase (no existing UPDATE/DELETE endpoint to mirror).
- **Dimension**: Blind Spots
- **Location**: Phase 1 — endpoints §2 (PATCH) and §3 (DELETE); Critical Implementation Details §"RLS scoping means 'not found' and 'not owned' look identical".
- **Detail**: Plan says "interpret zero-affected-rows as 404" but does not specify HOW to detect zero rows for PATCH vs DELETE. Two nontrivial mechanics:
  - **PATCH**: `.update({...}).eq("id", X).select().single()` — Supabase returns `error.code === "PGRST116"` when zero rows match (either row doesn't exist OR RLS filtered it). Endpoint must catch PGRST116 and map to 404.
  - **DELETE**: `.delete().eq("id", X)` returns `data: null` regardless of whether a row was hit. To detect zero rows, use `.delete().eq("id", X).select("id")` and check `data.length === 0`, or `.delete({ count: "exact" }).eq(...)` and check `count`.

  There is no existing UPDATE/DELETE handler in `src/pages/api/` to copy from (grep confirmed). Without this in the contract, the DELETE endpoint will silently return 204 on missing/not-owned rows, and Success Criteria bullet 1.9 ("User A PATCH/DELETE on user B's card returns 404, not 200/403") will fail at manual test time — with no guidance on how to fix.
- **Fix**: Add a Contract note under §2 (PATCH) and §3 (DELETE) in Phase 1:
  - PATCH: after `.update({question, answer}).eq("id", card_id).select().single()`, if `error?.code === "PGRST116"` return 404.
  - DELETE: use `.delete().eq("id", card_id).select("id")`; if the returned array is empty, return 404. Otherwise 204.
  - Strength: Anchors the 404 contract to a concrete PostgREST call pattern; implementer doesn't have to reverse-engineer it during Phase 1 or discover the gap at manual-test time.
  - Tradeoff: Slightly leans into "how" territory in a plan that otherwise stays intent-only. Acceptable because there's no existing pattern in the codebase to imitate.
  - Confidence: HIGH — PGRST116 is documented Supabase behavior; `.select()` after `.delete()` is the canonical way to detect zero-rows.
  - Blind spot: Doesn't distinguish "row genuinely absent" from "row owned by another user". Plan already accepts this conflation as intentional.
- **Decision**: PENDING

### F2 — Progress ↔ Phase-2 Manual mismatch (5 bullets vs 4 entries)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; obvious fix
- **Dimension**: Plan Completeness
- **Location**: Phase 2 Success Criteria (plan.md lines 191-195) vs Progress "### Phase 2: /deck page + list view" (plan.md lines 397-401)
- **Detail**: Plan Phase 2 Manual lists 5 verification bullets: signed-out redirect, AI-badge render, manual-badge render (via SQL insert), empty state, RLS gate. Progress collapses these into 4 entries (2.4–2.7) — the manual-badge assertion is folded into 2.5 ("list renders with source badges") rather than getting its own line. Violates the 1:1 mapping convention in `references/progress-format.md`.
- **Fix**: Split 2.5 into two lines — one for AI-badge render, one for manual-badge render — and renumber trailing entries.
- **Decision**: PENDING

### F3 — `ALL` method catch-all missing for `[card_id].ts`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; obvious fix
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 — §2 and §3 (new file `src/pages/api/cards/[card_id].ts`)
- **Detail**: Existing `src/pages/api/cards.ts:70` exports `ALL: () => jsonResponse(405, { error: "method not allowed" })` to cleanly reject unrecognized methods. The new `[card_id].ts` file will export PATCH and DELETE but the plan doesn't mention mirroring the 405 catch-all. Consistency + defense-in-depth.
- **Fix**: Add a one-liner to Phase 1 §3 contract: "Also export `ALL: () => jsonResponse(405, ...)` matching the existing `src/pages/api/cards.ts:70` pattern."
- **Decision**: PENDING

### F4 — No nav link to `/deck` from other pages

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — discoverability is a real UX cost but arguably out of S-03 scope
- **Dimension**: Blind Spots
- **Location**: Phase 2 — Astro page / DeckPanel
- **Detail**: Plan adds `/deck` but doesn't add a link from `/dashboard`, `/generate`, or `/review`. Currently `/dashboard` only shows the user email + signout (`src/pages/dashboard.astro:1-27`), so users have no way to discover `/deck` short of typing the URL. This isn't a correctness issue but bites the "user lands, sees their deck" mental model from the Round-1 questioning.
- **Fix**: Add a bullet to Phase 2: "Add 'Twoja talia' link to `src/pages/dashboard.astro` pointing to `/deck`." Alternative: defer to S-06 (UX improvements) and explicitly park under "What We're NOT Doing".
- **Decision**: PENDING
