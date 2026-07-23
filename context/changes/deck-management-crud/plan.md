# Deck Management CRUD (S-03) Implementation Plan

## Overview

Add manual CRUD for flashcards on a new `/deck` protected route: list all of the current user's cards, create manually (reusing the existing `POST /api/cards`), edit an existing card's question/answer (preserving its FSRS review schedule), and delete a card with an irreversibility warning. Closes S-03 from the roadmap and resolves Open Q3 (edit preserves schedule).

## Current State Analysis

- `cards` table complete with all FSRS state columns (F-01, `supabase/migrations/20260709120000_fsrs_state_and_review_log.sql:27-38`). RLS policies exist for SELECT/INSERT/UPDATE/DELETE per authenticated owner.
- `POST /api/cards` already exists (`src/pages/api/cards.ts:21-68`) and was explicitly designed to accept `source: "manual"` for reuse by S-03. It initializes an empty FSRS state via `emptyCardState()` (`src/lib/review/scheduler.ts:58-74`).
- Client wrapper `createCard()` present (`src/lib/api/cards.ts:19-40`); no `listCards`/`updateCard`/`deleteCard` yet.
- No list, PATCH, or DELETE endpoints for cards.
- No `/deck` route; `PROTECTED_ROUTES = ["/dashboard", "/generate", "/review"]` in `src/middleware.ts:4`.
- `review_history.card_id` has `ON DELETE CASCADE` (`supabase/migrations/20260709120000_fsrs_state_and_review_log.sql:52`) — deleting a card wipes its review history irreversibly.
- shadcn primitives available: `Card`, `Button`, `Textarea` (`src/components/ui/`). Missing: `Dialog`, `Input` — will install via shadcn CLI.
- No toast library; errors and success are surfaced inline (see `src/components/generate/ProposalCard.tsx:126-139`).
- Reducer-based React island pattern established (`src/components/generate/GeneratePanel.tsx`), which the deck UI will mirror.

## Desired End State

The user logs in, navigates to `/deck`, and sees every card they own in a scrollable list with a source badge ("AI" or "manual") on each. From that page they can:

1. Click **"Dodaj fiszkę"** → a modal (Dialog) opens with two empty textareas → save persists a new card with `source='manual'` → the card appears at the top of the list.
2. Click any card row → the same modal opens pre-filled with that card's question and answer → save updates only `question`/`answer` on the row; the FSRS columns (`due`, `stability`, `difficulty`, `reps`, `state`, etc.) and `source` are untouched.
3. Click the delete affordance on a row → a confirmation Dialog appears warning that the operation removes the card **and its review history** irreversibly → confirm hard-deletes the row (FK cascade removes `review_history` entries).
4. Type in the search input above the list → visible rows filter live client-side on case-insensitive substring match against `question` OR `answer`. Clearing the input restores the full list.

Verify:

- User A never sees or mutates user B's cards (RLS gate holds end-to-end).
- FSRS columns are byte-for-byte identical before and after an edit (SQL diff).
- After a delete, `SELECT count(*) FROM review_history WHERE card_id = '<deleted>'` returns 0.
- `/deck` is unreachable when signed out (301 to `/auth/signin`).

### Key Discoveries

- The POST endpoint's shape (`src/pages/api/cards.ts:8-12`) allows `source: 'manual'` with no changes — the manual-create flow reuses it as-is.
- `emptyCardState()` (`src/lib/review/scheduler.ts:58-74`) is the canonical initializer; the PATCH endpoint must NOT call it.
- Custom error class pattern for client fetch wrappers (`src/lib/api/cards.ts:11-17`) — extend for list/update/delete.
- `PROTECTED_ROUTES.some(startsWith)` check in `src/middleware.ts:18` — `/deck` addition is a one-line change.
- No shadcn `Form` in project; validation is inline reducer/state pattern (`src/components/auth/SignUpForm.tsx:22-45`). CardFormDialog will follow this pattern.
- `commit_review` RPC (`src/pages/api/review/[card_id]/rate.ts:74-95`) has no bearing on this change — plain UPDATE/DELETE against the `cards` table respects RLS on its own.

## What We're NOT Doing

- **Server-side pagination or search** — client-side only for MVP scale (persona = one exam prep ≈ hundreds of cards; well under 1MB payload).
- **Toast notifications** — errors displayed inline in the modals; success is implicit via list updating (project has no toast lib and adding one is out of scope).
- **Changing a card's `source` on edit** — an AI card stays `source='ai'` even after editing; no `ai-edited` value exists in the enum, and none is added.
- **Soft delete / undo** — hard delete only, gated by confirm Dialog (Q7 decision; soft-delete lives in S-05, not S-03).
- **Multi-select / bulk actions** — deferred to S-06 (UX improvements).
- **Import, export, sharing, media** — PRD Non-Goals.
- **Debouncing on client-side search** — dataset is small enough that per-keystroke filtering is fine.
- **Dedicated integration test infrastructure** — no test runner exists in the project yet; manual + type-check + build cover this MVP slice.

## Implementation Approach

Mirror the S-01 patterns line-by-line so nothing surprises the implementer: per-file `jsonResponse` helper, Zod validation on all mutating endpoints, `context.locals.user` auth check, per-request Supabase client via `createClient(context.request.headers, context.cookies)`, and RLS as the sole scoping mechanism. On the client, reuse the custom-error-class pattern from `src/lib/api/cards.ts`, and mirror `GeneratePanel.tsx`'s reducer-based island for the deck view.

Four phases, each independently manually verifiable, roughly one work session each:

1. **Backend** — new endpoints and client wrappers land; verified by curl and RLS smoke tests.
2. **List view** — `/deck` renders a read-only list, unblocking visual review of the whole deck.
3. **Create/Edit modal** — shared Dialog wired to POST and PATCH.
4. **Delete + search** — completes destructive flow with confirmation, adds client-side filter.

## Critical Implementation Details

### FSRS state is untouched on edit

The `PATCH /api/cards/[card_id]` endpoint MUST update only `question` and `answer`. Do NOT call `emptyCardState()`; do NOT include any FSRS column in the `.update({ ... })` payload; do NOT allow `source` in the body (the Zod schema rejects unknown keys via `.strict()`). `updated_at` is set automatically by the `cards_set_updated_at` trigger. This is the resolution of roadmap Open Q3 — a punctuation-fix edit must not erase weeks of learning progress.

### RLS scoping means "not found" and "not owned" look identical

Follow `src/pages/api/cards.ts:44-54` and do NOT add explicit `.eq("user_id", user.id)` filters on PATCH/DELETE/GET. RLS policies (`cards_update_own`, `cards_delete_own`, `cards_select_own`) restrict the row set. A PATCH or DELETE against another user's card returns 0 affected rows; the endpoint must interpret zero-rows as `404 not found` rather than `200 ok` — this both avoids leaking existence and matches semantic truth (the row does not exist *for this user*).

### Delete cascade is irreversible

`review_history.card_id` has `ON DELETE CASCADE`. A single DELETE against `cards` removes every `review_history` row referencing it. The confirmation Dialog copy must state this explicitly ("usunie również jej historię powtórek"); do not phrase it as a soft warning ("możesz cofnąć") because there is no undo.

## Phase 1: Backend endpoints + client wrappers

### Overview

Add three endpoints (`GET /api/cards`, `PATCH /api/cards/[card_id]`, `DELETE /api/cards/[card_id]`) and their client wrappers.

### Changes Required:

#### 1. GET /api/cards — list current user's cards

**File**: `src/pages/api/cards.ts` (extend existing)

**Intent**: Return the authenticated user's cards ordered by `created_at DESC`, so the deck page can render them without any filter. Reuse the file's existing `jsonResponse` helper and auth check; rely on RLS for row scoping.

**Contract**: `GET /api/cards` → `200 { cards: CardRow[] }`; `401 { error: "unauthorized" }` when unauthed; `500` on DB error. No query params in v1. Uses the `cards_user_created_idx` index (`supabase/migrations/20260709120000_fsrs_state_and_review_log.sql:39`).

#### 2. PATCH /api/cards/[card_id] — edit question/answer only

**File**: `src/pages/api/cards/[card_id].ts` (new)

**Intent**: Accept `{ question, answer }`, validate both non-empty, run UPDATE touching only those two columns, return the updated row. The Zod schema is `.strict()` so any additional field (including `source` or FSRS columns) results in 400. If the row does not exist (either because the id is bogus OR RLS masked another user's row), return 404 without leaking existence.

**Contract**: `PATCH /api/cards/:card_id` with body `{ question: string(min 1), answer: string(min 1) }` → `200 { card: CardRow }`; `400` invalid input (bad body, invalid UUID, extra fields); `401` unauth; `404` not found; `500` db error. Route param validated with `z.string().uuid()`.

#### 3. DELETE /api/cards/[card_id] — hard delete

**File**: `src/pages/api/cards/[card_id].ts` (same file as PATCH; export `DELETE` next to `PATCH`)

**Intent**: Delete the row by id; FK cascade removes associated `review_history` rows. Interpret zero-affected-rows as 404 (same rationale as PATCH).

**Contract**: `DELETE /api/cards/:card_id` → `204 no content`; `401`/`404`/`500` as above. UUID validation on the param.

#### 4. Extend client wrappers

**File**: `src/lib/api/cards.ts` (extend existing)

**Intent**: Add `listCards()`, `updateCard(id, { question, answer })`, `deleteCard(id)` following the fetch-then-throw-typed-error pattern of `createCard`. Introduce a single shared error class (rename `CreateCardError` → `CardApiError`, or keep `CreateCardError` and add sibling errors; the rename is preferable but touches the one existing call-site in `GeneratePanel.tsx`).

**Contract**: `listCards(): Promise<CardRow[]>`; `updateCard(id: string, params: { question: string; answer: string }): Promise<CardRow>`; `deleteCard(id: string): Promise<void>`. All throw the shared card-api error on non-2xx with the endpoint's `error` string as the message.

### Success Criteria:

#### Automated Verification:

- Type-check passes: `npx astro sync && npx tsc --noEmit`
- Lint passes: `npm run lint`
- Build passes: `npm run build`
- No breaking changes to existing `POST /api/cards` (GeneratePanel still works — verified by the same build step)

#### Manual Verification:

- `curl -X GET /api/cards` with a valid session returns `{ cards: [...] }`; without a session returns 401.
- `curl -X PATCH /api/cards/<uuid>` with `{question, answer}` returns 200 and the updated card; SQL `SELECT stability, difficulty, due, reps, state FROM cards WHERE id=...` shows identical values before and after.
- PATCH with body `{question, answer, source: "ai"}` returns 400 (strict Zod).
- `curl -X DELETE /api/cards/<uuid>` returns 204; the card and all `review_history` rows for it are gone.
- As user A, PATCH or DELETE on user B's card returns 404 (not 200, not 403).

**Implementation Note**: After Phase 1 lands and automated verification passes, pause here for manual confirmation of the curl smoke tests before proceeding to Phase 2.

---

## Phase 2: /deck page + list view (read-only)

### Overview

Add the `/deck` protected route hydrating a React island that fetches and renders the card list with source badges. No CRUD interactions yet — this ships something visible and unblocks visual QA.

### Changes Required:

#### 1. Protect `/deck` in middleware

**File**: `src/middleware.ts` (edit)

**Intent**: Add `/deck` to `PROTECTED_ROUTES` so unauthed visitors are redirected to signin.

**Contract**: `PROTECTED_ROUTES = ["/dashboard", "/generate", "/review", "/deck"]`.

#### 2. Astro page

**File**: `src/pages/deck.astro` (new)

**Intent**: Mirror the shape of `src/pages/generate.astro` / `src/pages/review.astro`. Hydrate a single React island with `client:load`. Page title in Polish (e.g., "Twoja talia") consistent with the rest of the UI.

**Contract**: Astro page that renders `<DeckPanel client:load />` inside the project's default layout.

#### 3. DeckPanel React island

**File**: `src/components/deck/DeckPanel.tsx` (new)

**Intent**: Top-level island. Manage state with `useReducer` (phases: `loading | ready | error`). On mount, call `listCards()`. Errors displayed as an inline banner. Empty state: "Twoja talia jest pusta. Wygeneruj fiszki przez AI albo dodaj ręcznie." Renders one `CardListItem` per card.

**Contract**: Default export `DeckPanel`. State: `{ phase, cards: CardRow[], error: string | null }`. Reducer actions: `loadStart`, `loadSuccess(cards)`, `loadError(message)`.

#### 4. CardListItem component

**File**: `src/components/deck/CardListItem.tsx` (new)

**Intent**: Render one card — question on top (larger), answer below (muted), source badge in the top-right. Use the existing shadcn `Card` primitive. Source badge is a small inline `<span>` with a Tailwind class per value (`ai` / `manual`); no new shadcn component required.

**Contract**: Props: `{ card: CardRow }`. Read-only in this phase (no interaction callbacks yet).

### Success Criteria:

#### Automated Verification:

- `npx astro sync && npx tsc --noEmit` passes.
- `npm run lint` passes (including `react-compiler/react-compiler`).
- `npm run build` passes.

#### Manual Verification:

- Navigate to `/deck` while signed out → redirected to `/auth/signin`.
- Navigate to `/deck` while signed in → list of all owned cards renders; existing AI cards from S-01 show "AI" badge.
- Insert a `source='manual'` card via SQL → refresh → the "manual" badge shows.
- Empty account → empty state renders.
- Log in as user B → list only contains user B's cards (RLS gate holds).

**Implementation Note**: Pause for manual confirmation before Phase 3.

---

## Phase 3: Create + Edit modal (shared Dialog)

### Overview

Install shadcn `Dialog` and `Input`. Add a single shared `CardFormDialog` used for both manual create and edit. Wire "Dodaj fiszkę" and clickable rows in `DeckPanel`.

### Changes Required:

#### 1. Install shadcn Dialog + Input

**File**: `src/components/ui/dialog.tsx` (new), `src/components/ui/input.tsx` (new), via `npx shadcn@latest add dialog input`

**Intent**: Install the canonical shadcn Dialog and Input components. Adds `@radix-ui/react-dialog` to dependencies. Keeps the existing project styling.

**Contract**: Standard shadcn exports — `Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`, `DialogClose`, and `Input`.

#### 2. CardFormDialog — shared create/edit form

**File**: `src/components/deck/CardFormDialog.tsx` (new)

**Intent**: A controlled Dialog with two `Textarea`s (question, answer). Accepts `mode: 'create' | 'edit'` and (when `mode='edit'`) a `card` prop. Local form state initialized from `card` when opening in edit mode, empty when opening in create mode. Client-side validation: both fields non-empty. On save: `createCard({ question, answer, source: 'manual' })` in create mode, `updateCard(card.id, { question, answer })` in edit mode. Errors displayed inline in the form. All controls disabled while submitting. Esc / Cancel closes without saving.

**Contract**: Props `{ mode: 'create' | 'edit'; card?: CardRow; open: boolean; onOpenChange: (v: boolean) => void; onSaved: (card: CardRow) => void }`. Never mutates `card` prop; produces a fresh row via the API and hands it back via `onSaved`.

#### 3. Wire into DeckPanel

**File**: `src/components/deck/DeckPanel.tsx` (extend)

**Intent**: Add a "Dodaj fiszkę" button at the top of the list; clicking opens `CardFormDialog` in create mode. Make each `CardListItem` clickable → opens `CardFormDialog` in edit mode pre-filled. On `onSaved`: prepend to `cards` for create; replace-by-id for edit.

**Contract**: `DeckPanel` state extended with `dialog: { mode: 'create' | 'edit' | null; card?: CardRow }`. Reducer gains `openCreate`, `openEdit(card)`, `closeDialog`, `savedCreate(card)`, `savedEdit(card)`.

#### 4. CardListItem — clickable + edit affordance

**File**: `src/components/deck/CardListItem.tsx` (extend)

**Intent**: Row becomes a button (a11y correct) with a visual affordance ("Edytuj" or a pencil icon). Delete UI is added in Phase 4.

**Contract**: Props extended: `onEditClick: () => void`. Delete callback added in Phase 4.

### Success Criteria:

#### Automated Verification:

- `npx astro sync && npx tsc --noEmit` passes.
- `npm run lint` passes.
- `npm run build` passes.
- shadcn Dialog/Input files match canonical shadcn output (visual review of generated files).

#### Manual Verification:

- Click "Dodaj fiszkę" → modal opens with empty form; save creates a `source='manual'` card that appears at top of the list.
- Save with an empty question or empty answer → inline error, no API call issued.
- Click any row → modal opens pre-filled; edit and save persist; refresh confirms persistence.
- Before-and-after SQL: `SELECT stability, difficulty, due, reps, lapses, state, source FROM cards WHERE id=<edited>` — all values identical except `updated_at`.
- Editing an AI card leaves its source badge as "AI".
- Esc key and Cancel button close the modal without saving; Save button disabled while a save is in flight.

**Implementation Note**: Pause for manual confirmation before Phase 4.

---

## Phase 4: Delete confirmation + client-side search

### Overview

Add a per-row delete button, a `DeleteConfirmDialog` warning about cascade, and a search input filtering visible rows.

### Changes Required:

#### 1. DeleteConfirmDialog

**File**: `src/components/deck/DeleteConfirmDialog.tsx` (new)

**Intent**: A Dialog asking "Usunąć tę fiszkę? Ta operacja jest nieodwracalna i usunie również jej historię powtórek." with a destructive "Usuń" button and a neutral "Anuluj". On confirm: `deleteCard(card.id)` then `onDeleted(card.id)`. Errors displayed inline. Both buttons disabled while deleting.

**Contract**: Props: `{ card: CardRow | null; onOpenChange: (v: boolean) => void; onDeleted: (id: string) => void }`. Open state derived from `card !== null`.

#### 2. Wire delete into CardListItem + DeckPanel

**File**: `src/components/deck/CardListItem.tsx` (extend); `src/components/deck/DeckPanel.tsx` (extend)

**Intent**: `CardListItem` gets a delete button ("Usuń" or a trash icon) that stops event propagation from the row-click. `DeckPanel` maintains `deleteTarget: CardRow | null`; setting it opens the dialog; `onDeleted(id)` removes the card from the local list.

**Contract**: `CardListItem` props extended: `onDeleteClick: () => void`. `DeckPanel` reducer gains `openDelete(card)`, `closeDelete`, `deleted(id)`.

#### 3. Client-side search

**File**: `src/components/deck/DeckPanel.tsx` (extend)

**Intent**: An `Input` at the top of the list bound to a local `search` state (via `useState`, not the reducer — it is derived-view UI state, not data state). Filter predicate: `search.trim() === "" || card.question.toLowerCase().includes(q) || card.answer.toLowerCase().includes(q)` where `q = search.trim().toLowerCase()`. Empty filtered set shows "Brak wyników" state.

**Contract**: Filter is pure; no debounce; no server call.

### Success Criteria:

#### Automated Verification:

- `npx astro sync && npx tsc --noEmit` passes.
- `npm run lint` passes.
- `npm run build` passes.

#### Manual Verification:

- Click delete on a card → confirmation dialog appears with the copy naming review-history loss.
- Confirm delete → card gone from list; refresh confirms; `SELECT count(*) FROM review_history WHERE card_id='<deleted>'` returns 0.
- Cancel delete → dialog closes; list unchanged.
- Type in search → visible rows filter live on question OR answer (case-insensitive).
- Clear search → full list restored.
- Search matching nothing → "Brak wyników" empty state shown.
- User A cannot delete user B's card (endpoint 404 surfaces as inline error in the dialog).

**Implementation Note**: Final phase; after this, `/deck` end-to-end works and S-03 closes.

---

## Testing Strategy

### Unit Tests:

No unit-test infrastructure exists in the repo. Do not add one for this slice — the manual verification steps + type-check + build cover the surface. Adding a test runner is a separate change with its own bootstrapping cost.

### Integration Tests:

Ad-hoc curl-based smoke covering:

1. `GET /api/cards` returns only the current user's rows.
2. `PATCH /api/cards/<other-user's-id>` returns 404.
3. `DELETE /api/cards/<id>` cascades `review_history` (verify via SQL count before and after).
4. `PATCH` preserves FSRS state (verify with a SQL diff of numeric columns).

Consolidate these curl calls in a scratch file under the change folder (e.g., `context/changes/deck-management-crud/smoke.md`) after Phase 1 for repeatability. Do not commit the file with real UUIDs — templatize.

### Manual Testing Steps:

1. Sign in as user A. Create a card via `/generate` (source='ai'). Note its id.
2. Rate the AI card once in `/review`; note `due`, `stability`, `difficulty` via SQL.
3. Go to `/deck`. Click "Dodaj fiszkę"; create a manual card. Verify both cards appear with correct badges.
4. Edit the AI card in `/deck`; save. Re-check SQL — `question`/`answer`/`updated_at` changed; `source`, `due`, `stability`, `difficulty`, `reps`, `state` unchanged.
5. Search for a substring of the manual card's question — only that card visible. Clear search — both visible again.
6. Delete the manual card; confirm the dialog copy mentions review-history loss; confirm. `SELECT count(*) FROM review_history WHERE card_id='<id>'` returns 0.
7. Sign out; navigate to `/deck` → redirected to signin.
8. Sign in as user B; `/deck` shows an empty list (or only user B's cards).

## Performance Considerations

No pagination and no debouncing on search — safe at target scale (medium users × up to ~500 cards each = well under 1 MB payload; JS filter on a few hundred strings is sub-millisecond). Index `cards_user_created_idx` supports the list query.

If future metrics show a user with >1000 cards or list-render lag, revisit with server-side pagination + full-text search — out of scope now.

## Migration Notes

None. Schema already accommodates all decisions in this plan (F-01 shipped the FSRS columns; the `card_source` enum already has `'manual'`). No new columns, no data migration.

## References

- Roadmap: `context/foundation/roadmap.md:107-118`
- Change: `context/changes/deck-management-crud/change.md`
- Prior CRUD-adjacent work: `context/archive/2026-07-07-first-ai-generation-and-accept/`
- POST endpoint pattern to mirror: `src/pages/api/cards.ts:1-70`
- Client-wrapper pattern: `src/lib/api/cards.ts:1-40`
- Reducer-based island reference: `src/components/generate/GeneratePanel.tsx`
- FSRS initializer (do NOT call on edit): `src/lib/review/scheduler.ts:58-74`
- Cascade FK: `supabase/migrations/20260709120000_fsrs_state_and_review_log.sql:52`
- Middleware entry point: `src/middleware.ts:4`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Backend endpoints + client wrappers

#### Automated

- [x] 1.1 Type-check passes: `npx astro sync && npx tsc --noEmit` — 5b272cf
- [x] 1.2 Lint passes: `npm run lint` — 5b272cf
- [x] 1.3 Build passes: `npm run build` — 5b272cf
- [x] 1.4 No breaking changes to existing `POST /api/cards` — verified by build — 5b272cf

#### Manual

- [x] 1.5 GET /api/cards with valid session returns `{ cards: [...] }`; without session returns 401 — 5b272cf
- [x] 1.6 PATCH /api/cards/<uuid> updates question/answer; FSRS columns byte-identical in SQL diff — 5b272cf
- [x] 1.7 PATCH with `{source: "ai"}` (or any extra key) rejected 400 — 5b272cf
- [x] 1.8 DELETE /api/cards/<uuid> returns 204; review_history cascade deletion verified — 5b272cf
- [x] 1.9 User A PATCH/DELETE on user B's card returns 404 (not 200/403) — 5b272cf

### Phase 2: /deck page + list view

#### Automated

- [x] 2.1 Type-check passes: `npx astro sync && npx tsc --noEmit` — 457fb25
- [x] 2.2 Lint passes: `npm run lint` — 457fb25
- [x] 2.3 Build passes: `npm run build` — 457fb25

#### Manual

- [x] 2.4 /deck signed-out → redirect to /auth/signin — 457fb25
- [x] 2.5 /deck signed-in → list renders with source badges — 457fb25
- [x] 2.6 Empty account → empty state renders — 457fb25
- [x] 2.7 User A cannot see user B's cards (RLS holds) — 457fb25

### Phase 3: Create + Edit modal

#### Automated

- [x] 3.1 Type-check passes: `npx astro sync && npx tsc --noEmit`
- [x] 3.2 Lint passes: `npm run lint`
- [x] 3.3 Build passes: `npm run build`
- [x] 3.4 shadcn Dialog/Input files match canonical shadcn output

#### Manual

- [x] 3.5 "Dodaj fiszkę" → modal → save creates manual card at top of list
- [x] 3.6 Save with empty field → inline error, no API call
- [x] 3.7 Click row → modal pre-filled; edit persists; FSRS state unchanged (SQL diff)
- [x] 3.8 Editing AI card keeps source='ai' badge
- [x] 3.9 Esc/Cancel closes without saving; controls disabled while submitting

### Phase 4: Delete confirmation + search

#### Automated

- [ ] 4.1 Type-check passes: `npx astro sync && npx tsc --noEmit`
- [ ] 4.2 Lint passes: `npm run lint`
- [ ] 4.3 Build passes: `npm run build`

#### Manual

- [ ] 4.4 Delete confirm dialog mentions review-history loss
- [ ] 4.5 Confirmed delete removes card; review_history cascade verified via SQL
- [ ] 4.6 Cancel delete leaves state unchanged
- [ ] 4.7 Search filters visible rows on question OR answer (case-insensitive)
- [ ] 4.8 Empty search restores full list
- [ ] 4.9 Search matching nothing shows "Brak wyników" state
- [ ] 4.10 User A cannot delete user B's card (endpoint 404 → inline error)
