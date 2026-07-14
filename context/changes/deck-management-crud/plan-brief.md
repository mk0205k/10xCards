# Deck Management CRUD (S-03) — Plan Brief

> Full plan: `context/changes/deck-management-crud/plan.md`

## What & Why

Add manual CRUD (create / list / edit / delete) for flashcards on a new `/deck` protected route. Closes roadmap slice S-03 and resolves Open Q3 (edit preserves FSRS review schedule). Without this the deck grows write-only via AI generation, users cannot correct typos, and cannot remove cards they no longer want.

## Starting Point

F-01 already shipped the `cards` schema with full FSRS state and RLS. S-01 shipped `POST /api/cards` which explicitly accepts `source: "manual"` for reuse here. S-02 shipped the FSRS review session but touches these rows through a separate RPC (`commit_review`). What is missing: any list, edit, or delete endpoint; a `/deck` route; shadcn Dialog and Input primitives; and any UI for browsing the deck.

## Desired End State

The user signs in, opens `/deck`, and sees every card they own with a source badge ("AI" or "manual"). A "Dodaj fiszkę" button opens a modal that persists a manual card. Clicking a card row opens the same modal pre-filled; saving updates only `question`/`answer` — the FSRS review schedule is untouched. A per-row delete button opens a confirmation dialog warning that review history is removed with the card; confirming hard-deletes and the FK cascade wipes `review_history`. A search input above the list filters visible rows client-side on question OR answer.

## Key Decisions Made

| Decision                          | Choice                                                 | Why (1 sentence)                                                                                                    | Source |
| --------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------ |
| Edit vs FSRS schedule (Open Q3)   | Preserve schedule (UPDATE only question/answer)        | Matches "typo-fix should not erase learning progress"; simplest DB write; can revisit later if metrics demand.       | Plan   |
| Delete safety                     | Confirm Dialog with cascade warning                    | Standard destructive-action UX at zero infra cost; soft-delete is deferred to S-05.                                  | Plan   |
| Route                             | New `/deck` protected route                            | Keeps `/dashboard` free for a future home summary; semantic separation matches PRD language.                         | Plan   |
| Edit UX                           | Modal (shadcn Dialog)                                  | Focused editing surface; scales to more fields; single Dialog install serves both create and edit.                   | Plan   |
| Create UX                         | Modal (same Dialog as edit)                            | One component covers both flows; consistent UX; minimizes new UI surface.                                            | Plan   |
| List scale                        | Prosta lista + client-side search (no pagination)      | MVP scale (~500 cards/user) fits one payload; server-side is premature optimization.                                 | Plan   |
| Row content                       | Question + answer + source badge                       | Enough context to identify a card; badge signals the "75% AI" metric from PRD without adding FSRS state noise.       | Plan   |

## Scope

**In scope:**
- `GET /api/cards`, `PATCH /api/cards/[card_id]`, `DELETE /api/cards/[card_id]` endpoints
- `/deck` protected route with list, source badges, empty state
- Shared create/edit modal (shadcn Dialog + Input install)
- Delete confirmation Dialog with cascade warning
- Client-side substring search across question + answer
- Reuse of existing `POST /api/cards` for manual create

**Out of scope:**
- Server-side pagination or search
- Toast notifications (no lib in project)
- Changing a card's `source` on edit
- Soft delete / undo (S-05 territory)
- Multi-select / bulk actions (S-06 territory)
- Test-runner bootstrap (separate change if needed)
- Debouncing on client search
- Import/export, sharing, media (PRD Non-Goals)

## Architecture / Approach

Follows the S-01 pattern line-by-line: per-file `jsonResponse` helper, Zod validation, `context.locals.user` auth check, per-request Supabase client, RLS as the sole scoping mechanism (no manual `user_id` filters). Client fetch wrappers throw typed errors on non-2xx. React island mirrors `GeneratePanel.tsx`'s `useReducer` shape (`phase / cards / dialog / deleteTarget`). Search state lives in `useState` (derived-view, not data). One shared `CardFormDialog` handles both create and edit via a `mode` prop; a separate `DeleteConfirmDialog` handles destructive flow. Cascade deletion via existing FK (`review_history.card_id ON DELETE CASCADE`) — no new DB work.

## Phases at a Glance

| Phase                                                | What it delivers                                              | Key risk                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1. Backend endpoints + client wrappers               | GET/PATCH/DELETE landed; RLS scoping verified                 | PATCH accidentally touches FSRS columns → wipes learning progress                 |
| 2. `/deck` page + list view (read-only)              | Protected route renders full deck with source badges          | RLS regression makes another user's cards visible                                 |
| 3. Create + Edit modal                               | Shared Dialog wired to POST and PATCH                         | Edit path invokes `emptyCardState()` in error; source silently changes on edit    |
| 4. Delete confirmation + client-side search          | Destructive flow gated by Dialog; live search over visible rows | Delete copy underplays cascade to `review_history`                                |

**Prerequisites:** F-01 (schema + RLS), S-01 (POST endpoint) — both done.
**Estimated effort:** ~2–3 evening sessions across 4 phases.

## Open Risks & Assumptions

- Assumes shadcn `dialog` and `input` install cleanly under the current Tailwind 4 config; if they emit v0/v3 syntax, small manual patches may be needed.
- Assumes the current single-tenant RLS setup remains authoritative; a future `admin` role would require rethinking the "404 on other user's row" convention here.
- Client-side search performance untested past ~1000 cards; if metrics show a heavy user, revisit with server-side search — out of scope now.

## Success Criteria (Summary)

- User can create, list, edit, and delete their own flashcards on `/deck` end-to-end.
- Editing a card leaves every FSRS column byte-identical (SQL diff proves it).
- Deleting a card removes the row and all its `review_history` entries (cascade verified via SQL); dialog copy makes this explicit.
- User A cannot see, edit, or delete user B's cards (RLS gate holds — PATCH/DELETE return 404, not 200/403).
