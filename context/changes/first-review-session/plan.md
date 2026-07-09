# S-02: First Review Session — Implementation Plan

## Overview

Deliver the north-star slice: user opens `/review`, sees a question from a card due today, reveals the answer, rates difficulty on the FSRS 4-button scale, and the scheduler writes a new `due` date. Backed by `ts-fsrs` (FSRS-6) with card state persisted on `cards` and per-review logs in a redesigned `review_history` table. Transactional consistency between the card update and the log insert is enforced through a Postgres RPC (`commit_review`).

## Current State Analysis

- **Schema (F-01)**: `public.cards` has 7 columns (no FSRS state); `public.review_history` has 6 columns (`id, card_id, user_id, reviewed_at, rating, next_review_at`) — a placeholder shape from before the algorithm choice, does not match ts-fsrs `ReviewLog`. Row-level security + per-op-per-role policies are in place (`supabase/migrations/20260707200908_initial_schema.sql:20-129`). Table `review_history` is empty (S-02 is its first writer).
- **S-01 output live**: `POST /api/cards` writes only `{ user_id, question, answer, source }` (`src/pages/api/cards.ts:44-51`); live rows exist in `cards`. Any new NOT NULL FSRS column needs a DEFAULT to migrate cleanly.
- **Endpoint conventions**: Server-side Supabase factory (`src/lib/supabase.ts`) called per-request via `createClient(headers, cookies)`; Zod validation; `context.locals.user` auth check in-handler; `prerender = false` required for API routes (`AGENTS.md`).
- **Service split**: `src/lib/ai/generate-proposals.ts` is the template — service owns schemas + logic; endpoint owns HTTP + auth.
- **pgTAP**: `supabase/tests/rls.test.sql:25-28` inserts `review_history (card_id, user_id, rating, next_review_at)` and `:118` asserts `rating 3::smallint`. Both will need to change with the schema redesign.
- **Frontend islands**: `src/pages/generate.astro:20` uses `<GeneratePanel client:load />`; hooks live in `src/components/hooks/`. React 19 strict, react-compiler on error.
- **Runtime**: `wrangler.jsonc:6` has `compatibility_flags: ["nodejs_compat"]` — `ts-fsrs` Node ≥ 20 requirement satisfied.
- **Dynamic routes**: No `[param]` API route exists yet. `POST /api/review/[card_id]/rate` will be the first.

## Desired End State

A logged-in user can:

1. Open `/review` (guarded by middleware).
2. See the question of the card with the lowest `due` timestamp where `due <= now()`.
3. Click "Show answer", see the answer + 4 rating buttons (Again / Hard / Good / Easy), each labeled with the interval it would produce (e.g., `Good → 4d`).
4. Click a rating → server calls `commit_review` RPC → next due card loads (or empty-queue state with next-due-at hint).
5. Refreshing the page mid-session keeps the queue coherent (server-driven, no client state cache).

Verification: `supabase test db` passes with an updated pgTAP suite that includes RLS assertions on the redesigned `review_history` + `commit_review`; `npm run lint && npm run build` green; manual US-02 walkthrough completes end-to-end.

### Key Discoveries:

- `review_history` is empty → DROP+CREATE is cheaper than incremental ALTER (F-01 was an algorithm-agnostic guess; user chose full redesign).
- `cards` has live rows → all FSRS columns must ship with SQL DEFAULTs matching `createEmptyCard()` (`due = now()`, `state = 0`, floats = 0, ints = 0).
- Cloudflare Workers + `@supabase/supabase-js` cannot open a client-side transaction → the atomic UPDATE-card-and-INSERT-log pair goes through a `SECURITY INVOKER` Postgres function so RLS still applies.
- FSRS `state` is int in the library; store as `smallint + CHECK (state BETWEEN 0 AND 3)` to keep `TypeConvert.card()` round-trip clean (no enum mapping layer).
- The scheduler is exported in two flavours: `defaultScheduler` (fuzz on, used by endpoints) and `createScheduler({ enableFuzz: false })` (used by unit tests) — one production behaviour, deterministic tests.

## What We're NOT Doing

- No per-user FSRS weight retraining (deferred until real review history accumulates; `@open-spaced-repetition/binding` not installed).
- No push/email reminders about due cards (PRD Non-Goals).
- No user-adjustable `request_retention` — locked at library default `0.9` for MVP.
- No client-side FSRS math — `ts-fsrs` stays server-only; browser only renders preview payloads.
- No batch prefetching of the next N cards — one card at a time, server-driven.
- No dark-mode / theming variant of the review screen — reuse the cosmic panel look from `/generate`.
- No CRUD for `review_history` from the UI (rows are write-only via `commit_review`).
- Not renaming existing table `review_history` — dropping and recreating with the same name.

## Implementation Approach

Layered, bottom-up: (1) schema + RPC + pgTAP first so downstream code compiles against fresh `Database` types; (2) install library and build a small scheduler service module + retrofit the existing insert path; (3) two API endpoints; (4) React island; (5) verify. Each phase ends with a manual gate for the human implementer to review before the next.

## Critical Implementation Details

- **RPC signature is the contract**. `public.commit_review(p_card_id uuid, p_rating smallint, p_now timestamptz, p_updated_card jsonb, p_log jsonb)` returns the updated card row. Callers pass the already-computed FSRS output from `scheduler.next()` — Postgres does not call `ts-fsrs`; it only atomically UPDATEs `cards` and INSERTs `review_history` inside a single transaction. `SECURITY INVOKER` so `auth.uid()` RLS checks still fire.
- **`prerender = false` is mandatory** on every new API route (`AGENTS.md` hard rule). Both `src/pages/api/review/next.ts` and `src/pages/api/review/[card_id]/rate.ts` must export it, or the build silently prerenders them and they break on Cloudflare.
- **Cloudflare `nodejs_compat`** is set (`wrangler.jsonc:6`) — do not remove it; `ts-fsrs` requires Node ≥ 20 APIs.
- **`TypeConvert.card()` at the DB boundary** — Supabase returns `timestamptz` as ISO string; convert to `Date` before calling `scheduler.next()`, and rely on `JSON.stringify` for the write-back path (Date → ISO).

---

## Phase 1: Migration, `commit_review` RPC, pgTAP

### Overview

Add FSRS state to `cards` with NOT NULL DEFAULT-s (backfill live rows), redesign `review_history` from scratch to match the ts-fsrs `ReviewLog`, add the `commit_review` function, rewrite the pgTAP suite to cover the new shape + the RPC, regenerate `Database` types.

### Changes Required:

#### 1. New migration file

**File**: `supabase/migrations/YYYYMMDDHHmmss_fsrs_state_and_review_log.sql` (fresh timestamp after `20260707200908`).

**Intent**: One migration file that (a) adds FSRS columns to `cards` with SQL DEFAULT-s derived from `createEmptyCard()`, (b) drops and recreates `review_history` in the ReviewLog shape, (c) adds a `cards(user_id, due)` index for the "next due" query, (d) creates the `commit_review` RPC, (e) re-declares RLS + per-op policies + GRANTs on the new `review_history`, (f) grants `EXECUTE` on the function to `authenticated`. All in one transaction so a partial apply cannot leave the schema inconsistent.

**Contract**:

- `cards` gains: `due timestamptz not null default now()`, `stability double precision not null default 0`, `difficulty double precision not null default 0`, `elapsed_days integer not null default 0`, `scheduled_days integer not null default 0`, `learning_steps integer not null default 0`, `reps integer not null default 0`, `lapses integer not null default 0`, `state smallint not null default 0 check (state between 0 and 3)`, `last_review timestamptz null`.
- `review_history` recreated with: `id uuid pk, card_id uuid fk cascade, user_id uuid fk cascade, rating smallint not null check (rating between 1 and 4), state smallint not null check (state between 0 and 3), due timestamptz not null, stability double precision not null, difficulty double precision not null, elapsed_days integer not null, last_elapsed_days integer not null, scheduled_days integer not null, learning_steps integer not null, review timestamptz not null default now(), created_at timestamptz not null default now()`.
- Old columns `reviewed_at, next_review_at` do not carry over (post-review `due` lives on `cards`; `review` on `review_history` replaces `reviewed_at`).
- Index: `create index cards_user_due_idx on public.cards (user_id, due)`.
- RLS + per-op-per-role (authenticated) policies re-declared on the recreated `review_history`; `grant select, insert on table public.review_history to authenticated, service_role` (no update/delete — log is append-only, deletion cascades from `cards`).
- Function `public.commit_review(p_card_id uuid, p_rating smallint, p_now timestamptz, p_updated_card jsonb, p_log jsonb) returns public.cards language plpgsql security invoker` — updates the card by id (RLS filters), inserts the log, returns the updated card row. `p_updated_card`/`p_log` are already-computed FSRS state from the endpoint; the RPC does no scheduling logic. `grant execute on function public.commit_review to authenticated`.

Contract snippet (non-obvious — the JSON→columns projection needs to be explicit so downstream calls fail fast on missing fields):

```sql
-- Non-obvious: jsonb_to_record + strict column list keeps the RPC honest.
-- If the endpoint forgets to send a field, this errors instead of writing null.
update public.cards set
  due            = (p_updated_card->>'due')::timestamptz,
  stability      = (p_updated_card->>'stability')::double precision,
  difficulty     = (p_updated_card->>'difficulty')::double precision,
  elapsed_days   = (p_updated_card->>'elapsed_days')::integer,
  scheduled_days = (p_updated_card->>'scheduled_days')::integer,
  learning_steps = (p_updated_card->>'learning_steps')::integer,
  reps           = (p_updated_card->>'reps')::integer,
  lapses         = (p_updated_card->>'lapses')::integer,
  state          = (p_updated_card->>'state')::smallint,
  last_review    = (p_updated_card->>'last_review')::timestamptz,
  updated_at     = now()
where id = p_card_id
returning * into v_card;
```

#### 2. Rewritten pgTAP suite

**File**: `supabase/tests/rls.test.sql`

**Intent**: Update setup inserts to the new `review_history` shape (all 12 required fields present); keep the RLS isolation assertions but reference the new columns; add coverage for `commit_review` — RLS still applies (user A cannot commit against user B's card), the row is inserted, `cards.reps` increments by 1, `review_history` gets exactly one new row.

**Contract**:

- `select plan(N)` count grows (add ~4 assertions for `commit_review`).
- Setup insert into `review_history` uses the new columns (all 12 not-null fields). No `next_review_at`, no bare `rating + reviewed_at`.
- New role-scoped block: as user A, call `select commit_review('<user-A-card-id>', 3, now(), <jsonb>, <jsonb>)` — assert it returns 1 row and `cards.reps = 1` afterwards. Then as user A, call it with `<user-B-card-id>` — assert `throws_ok` with `42501` (RLS-denied UPDATE inside the function, since `security invoker`).
- Anon lockout assertions on `review_history` stay (existing test at `:157-163`), rewritten with new column list.

#### 3. Regenerate `Database` types

**File**: `src/db/database.types.ts` (auto-generated).

**Intent**: Run `npm run db:types` after `supabase db reset` locally. New shape must include the FSRS columns on `cards` Row/Insert/Update and the full ReviewLog shape on `review_history`; `Database["public"]["Functions"]["commit_review"]` should appear with `Args` and `Returns` typed.

**Contract**: Not hand-edited. The `db:types` script (`package.json:15`) produces the file. Downstream code (`src/lib/api/cards.ts` re-exports `CardRow`) picks up the new columns for free.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly against an empty DB: `supabase db reset` completes without error.
- Migration applies cleanly against a DB with existing S-01 `cards` rows (backfill DEFAULT-s populate): manual test after `supabase db reset` + `supabase db push` on a snapshot with cards.
- pgTAP suite passes: `supabase test db` — all assertions green (existing 14 + new ~4).
- `npm run db:types` produces a `Database` type with `commit_review` under `Functions` and all new columns on `cards` + `review_history` Row.
- `npm run lint` passes (no import errors from removed columns).
- `npm run build` passes.

#### Manual Verification:

- Open `supabase/migrations/YYYYMMDDHHmmss_fsrs_state_and_review_log.sql` — the file is self-contained; a reader can understand what was added and why from the SQL comments alone.
- Inspect `src/db/database.types.ts` — `review_history.Row` contains all 12 required fields; no phantom `next_review_at`.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Install `ts-fsrs`, scheduler service, retrofit `POST /api/cards`

### Overview

Install `ts-fsrs`, build a small service module that owns the FSRS singleton + preview helpers + hydration, and retrofit the S-01 insert path so freshly-created cards go into the DB with explicit FSRS state (even though DB DEFAULT-s cover the missing keys, jawność beats implicit).

### Changes Required:

#### 1. Install `ts-fsrs`

**File**: `package.json`, `package-lock.json`.

**Intent**: Add `ts-fsrs` as a runtime dependency at the latest 6.x version. No dev-deps needed.

**Contract**: `npm i ts-fsrs` — one new dependency line under `dependencies`; lockfile updated.

#### 2. Scheduler service

**File**: `src/lib/review/scheduler.ts` (new file, new folder).

**Intent**: Own the ts-fsrs configuration, expose a `defaultScheduler` (fuzz on, used by endpoints) and a `createScheduler({ enableFuzz })` factory (used by tests). Provide helpers: `emptyCardState()` (returns the FSRS keys we add to `POST /api/cards` inserts), `hydrateCard(row)` (uses `TypeConvert.card` to normalize `string → Date` when a DB row comes back for `scheduler.next`/`scheduler.repeat`), `computePreview(scheduler, card, now)` (returns `{ again, hard, good, easy }` each with `due` (ISO string) and human-readable `interval` — e.g., `"1m"`, `"4d"`). Schemas + types exported inline (mirror of `generate-proposals.ts`).

**Contract**:

- Named exports: `defaultScheduler`, `createScheduler(opts?: { enableFuzz?: boolean })`, `emptyCardState()`, `hydrateCard(row: CardRow): Card`, `computePreview(scheduler, card, now): PreviewMap`, `formatInterval(days: number): string`.
- Types: `PreviewEntry = { due: string; interval: string }`; `PreviewMap = Record<'again'|'hard'|'good'|'easy', PreviewEntry>`.
- `defaultScheduler = createScheduler({ enableFuzz: true })`.
- `createScheduler` internals: `fsrs(generatorParameters({ enable_fuzz, request_retention: 0.9, maximum_interval: 36500, enable_short_term: true }))`.
- No side-effects on import (module-scope safe on Workers — `fsrs()` is pure).

#### 3. Retrofit `POST /api/cards`

**File**: `src/pages/api/cards.ts`

**Intent**: On insert, spread `emptyCardState()` into the row before calling Supabase, so future migrations that tighten DEFAULT-s don't silently rely on them. The existing Zod schema and response shape stay unchanged.

**Contract**: The `.insert({...})` object gains an explicit spread from `emptyCardState()`. Nothing about the request or response contract changes (client-side `createCard()` in `src/lib/api/cards.ts` unaffected).

#### 4. Unit tests for scheduler

**File**: `src/lib/review/scheduler.test.ts` (new).

**Intent**: Deterministic coverage — use `createScheduler({ enableFuzz: false })` for every assertion. Test: `emptyCardState()` produces `state = 0, reps = 0`; `computePreview` returns 4 keys with monotonically increasing intervals (again < hard < good < easy in scheduled_days for a new card); `hydrateCard` converts an ISO `due` string to a `Date`.

**Contract**: Vitest suite. Named describe blocks per helper. No mocks needed — pure functions.

#### 5. Update existing endpoint tests

**File**: `src/pages/api/cards.test.ts`

**Intent**: Update the `insertBuilder.insert.toHaveBeenCalledWith(...)` assertion at `:103-108` and `:127` to allow the new FSRS keys via `expect.objectContaining({...})`. Do not lock down every FSRS default value — that belongs in the scheduler unit tests.

**Contract**: One or two `toHaveBeenCalledWith` changes in the happy-path tests. All existing tests still pass.

### Success Criteria:

#### Automated Verification:

- `npm test` passes (existing suite + new scheduler tests).
- `npm run lint` passes — `react-compiler/react-compiler` still green.
- `npm run build` passes — Astro can bundle `ts-fsrs` (ESM) into the Cloudflare Worker.
- No new `.warn`/`.error` in `wrangler deploy --dry-run` output related to Node built-ins.

#### Manual Verification:

- Run `npm run dev`, log in, hit `/generate`, save a card. Check the DB: the new row has `due ≈ now()`, `state = 0`, `stability = 0`, `reps = 0` — proving the retrofit works alongside DB DEFAULT-s.
- Inspect `src/lib/review/scheduler.ts` — one file, no cross-imports outside `ts-fsrs`; sits comfortably next to `src/lib/ai/`.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Review API endpoints

### Overview

Add `GET /api/review/next` (returns the card with lowest `due <= now()` plus a preview payload, or `{ card: null, nextDueAt }` if the queue is empty) and `POST /api/review/[card_id]/rate` (commits a rating via `commit_review` RPC, returns the updated card). Both authenticated per-request, Zod-validated on inputs, `prerender = false`.

### Changes Required:

#### 1. `GET /api/review/next`

**File**: `src/pages/api/review/next.ts` (new folder + file).

**Intent**: Fetch the earliest-due card owned by the authenticated user (RLS filters by `auth.uid()`). If found, compute a `PreviewMap` via `computePreview(defaultScheduler, hydrateCard(row), now)` and return `{ card, preview }`. If not found, additionally query `MIN(due)` where `due > now()` for the same user and return `{ card: null, nextDueAt: string | null }`. `nextDueAt` is `null` only when the user has zero cards.

**Contract**:

- Method: `GET`. `prerender = false`.
- Response 200 (card due): `{ card: CardRow, preview: PreviewMap }`.
- Response 200 (empty queue): `{ card: null, nextDueAt: string | null }`.
- Response 401 `{ error: "unauthorized" }` when `!context.locals.user`.
- Response 500 `{ error: "supabase not configured" }` when the client factory returns null (mirror `cards.ts:38-41`).
- Query: `.from("cards").select("*").eq("user_id", user.id).lte("due", <now-iso>).order("due", { ascending: true }).limit(1).maybeSingle()`. When null, follow up with `.select("due").gt("due", <now-iso>).order("due").limit(1).maybeSingle()`.
- `ALL: APIRoute = () => jsonResponse(405, ...)` — mirror the guard rail from `cards.ts:68`.

#### 2. `POST /api/review/[card_id]/rate`

**File**: `src/pages/api/review/[card_id]/rate.ts` (new dynamic route — first `[param]` route in repo).

**Intent**: Load the card by `params.card_id` (RLS filters to owner); if not found return 404. Hydrate the row, call `defaultScheduler.next(card, now, rating)` to compute the new state + log, marshal both to plain JSON, call the `commit_review` RPC, return `{ card: updatedRow }` from the RPC's returned row.

**Contract**:

- Path: `src/pages/api/review/[card_id]/rate.ts`. `prerender = false`. `context.params.card_id` is the card id (validated as uuid via Zod).
- Zod input schema: `z.object({ rating: z.number().int().min(1).max(4) })`.
- 401 unauthorized, 400 invalid input (bad JSON, bad rating, non-uuid card_id), 404 card not found, 500 supabase / rpc errors.
- Success 200: `{ card: CardRow }` (updated).
- RPC call: `supabase.rpc('commit_review', { p_card_id, p_rating, p_now, p_updated_card, p_log })`. `p_updated_card` and `p_log` are `JSON.stringify`-safe (Date → ISO via `JSON.stringify` default), so no manual date massaging needed on the JS side.
- `ALL: APIRoute` → 405.

#### 3. Endpoint tests

**Files**: `src/pages/api/review/next.test.ts`, `src/pages/api/review/[card_id]/rate.test.ts` (both new).

**Intent**: Follow the `cards.test.ts` mocking pattern (`vi.hoisted` + `vi.mock("@/lib/supabase")`). Cover: 401, 400 (bad rating, non-uuid card_id, malformed json), 404 (no such card), 200 happy path (RPC called with the right JSON payload), 405 on other methods, empty-queue response shape for `next`.

**Contract**: The `buildContext` helper must accept `params: { card_id: "<uuid>" }` for the dynamic route. Mocks return the FSRS shape; scheduler is imported (real) with `createScheduler({ enableFuzz: false })` swapped into the endpoint under test via a vi.mock so results are deterministic.

Contract snippet (non-obvious — the `context.params` shape for dynamic routes isn't in any prior test):

```ts
// context builder for the dynamic route — first of its kind in the repo
return {
  request,
  locals: { user },
  cookies: {} as never,
  url: new URL(request.url),
  params: { card_id: cardId },
} as never;
```

### Success Criteria:

#### Automated Verification:

- `npm test` passes (existing + new endpoint tests).
- `npm run lint` passes.
- `npm run build` passes with the new `[card_id]` route (Astro detects and prerenders none of it since `prerender = false`).
- `npm run deploy:dry` succeeds — proves Cloudflare bundling accepts the dynamic route.

#### Manual Verification:

- Curl `GET /api/review/next` while authenticated → returns a card + preview, or `{ card: null, nextDueAt: null }` for a fresh account.
- Curl `POST /api/review/<real-card-id>/rate` with `{"rating": 3}` → returns the updated card with `reps` incremented, `due` advanced. Repeat with different ratings and confirm the interval matches the earlier preview.
- Curl the rate endpoint against another user's card id (need two accounts) → 404 (RLS-hidden).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Frontend `/review` page + `ReviewSession` React island

### Overview

Add the `/review` page, a React island that owns the session state machine (fetch → reveal → rate → refetch), a client-side API wrapper for the two endpoints, an interval-hint formatter, and update middleware to protect `/review`.

### Changes Required:

#### 1. Middleware — protect `/review`

**File**: `src/middleware.ts`

**Intent**: Extend `PROTECTED_ROUTES` (`:4`) with `"/review"` so unauthenticated users are redirected to `/auth/signin`.

**Contract**: One-line change: `["/dashboard", "/generate", "/review"]`.

#### 2. Client API wrapper

**File**: `src/lib/api/review.ts` (new).

**Intent**: Mirror `src/lib/api/cards.ts` — one file, thin fetch wrappers, one custom `ReviewApiError` class, DTO types re-exported from `Database`. Two functions: `fetchNext()` returns the union `{ card, preview } | { card: null, nextDueAt }`; `rateCard(cardId, rating)` returns the updated `CardRow`.

**Contract**:

- Named exports: `CardRow`, `PreviewMap`, `NextResponse` (union type), `ReviewApiError`, `fetchNext()`, `rateCard(cardId: string, rating: 1|2|3|4)`.
- Errors thrown as `ReviewApiError(message, status)` — same shape as `CreateCardError` in `src/lib/api/cards.ts:11-17`.

#### 3. React island — `ReviewSession.tsx`

**File**: `src/components/review/ReviewSession.tsx` (new folder + file, mirrors `src/components/generate/`).

**Intent**: Own the whole session lifecycle. State machine: `loading → showing_question → showing_answer → rating (submitting) → loading (next)` or `→ empty (nextDueAt)`. On mount, `fetchNext`. On "Show answer", flip a local `revealed` boolean. On rating click, call `rateCard`, then `fetchNext` again. Render 4 buttons with interval hints from `preview` (labels: `Again → ${preview.again.interval}`, etc.). Empty state renders `nextDueAt` as human-readable "next card ready {relative}".

**Contract**:

- Default export `ReviewSession` (no props needed — self-contained).
- Uses `useState` for `phase`, `data` (NextResponse), `revealed`, `error`. No reducer necessary (state is linear).
- No external state library; no context. React-compiler safe (no manual memoization).
- Extract the interval-hint formatter (`formatRelativeDate(iso: string): string` for the empty-state hint) into `src/components/hooks/useRelativeDate.ts` if it grows beyond a one-liner — otherwise inline.

#### 4. `/review` page

**File**: `src/pages/review.astro` (new).

**Intent**: Mirror `src/pages/generate.astro:1-24` — same Layout, same cosmic panel look, header block with user email, `<ReviewSession client:load />` below.

**Contract**: Frontmatter reads `Astro.locals.user`, renders the React island with `client:load`. Static prose in the header ("Review your due cards…"). No dynamic Astro logic beyond user email.

#### 5. Optional: add `/review` link to Topbar

**File**: `src/components/Topbar.astro`

**Intent**: If Topbar already has `/generate` and `/dashboard` nav links, add `/review` alongside them. If Topbar doesn't have navigation yet, skip this — the plan doesn't hinge on it.

**Contract**: Small edit if the file already has a nav pattern; no-op otherwise. Do not build a navigation system just for this.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes (including `react-compiler/react-compiler` error rule).
- `npm run build` passes.
- `npm test` passes — the existing suite still green; no new component tests are strictly required at this stage (the endpoint tests + scheduler unit tests cover the core logic; UI regression is caught manually per `AGENTS.md`).

#### Manual Verification:

- Sign in, go to `/review`. When at least one card is due, question renders, "Show answer" reveals answer + 4 buttons with interval hints. Click "Good" → next card appears (or empty state).
- Sign out, hit `/review` directly → redirected to `/auth/signin`.
- Empty deck: brand new user (or delete all cards in DB) → empty state renders `"Brak fiszek w talii"` or equivalent, no crash.
- Rate the same card "Again" twice in a row (create another card first so the queue continues). Confirm each rating advances the queue and `reps` visibly grows in the DB.
- Refresh mid-session → next-due card appears (state is server-driven; no stale UI).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: End-to-end verification + roadmap update

### Overview

Full walkthrough of PRD Success Criteria steps 1–7 in one session; close S-02 in the roadmap.

### Changes Required:

#### 1. Full US-02 walkthrough

**File**: — (manual, no code change).

**Intent**: Sign up (or use existing account), paste text at `/generate`, accept at least 3 proposals, navigate to `/review`, rate all 3 through the queue, confirm each rating advances the due date, confirm the empty state shows a `nextDueAt` for tomorrow.

#### 2. Update roadmap S-02 status

**File**: `context/foundation/roadmap.md`

**Intent**: Flip S-02 from `blocked` → `done` in the At-a-glance table (`:38`) and the Slices section (`:103`); add a Done entry with archive path placeholder for whoever runs `/10x-close` next.

**Contract**: Two status-word edits + one Done bullet. Mirrors the F-01 / S-01 done entries at `:161-162`.

#### 3. Verify PRD Open Q1 resolution

**File**: `context/foundation/prd.md`

**Intent**: PRD Open Q1 (algorithm choice) is now resolved. Note the resolution — e.g., append `→ Resolved 2026-07-09: FSRS via ts-fsrs (see context/changes/first-review-session/).` at the end of the Q1 bullet.

**Contract**: One-line append to the existing Q1 bullet.

### Success Criteria:

#### Automated Verification:

- `supabase test db` — all pgTAP assertions green.
- `npm run lint && npm run build && npm test` — all green.
- `npm run deploy:dry` — succeeds.
- Git status: no uncommitted files outside the change folder.

#### Manual Verification:

- Full US-02 flow completes in one session with zero errors or dead-ends.
- Preview interval hints match the actual `due` returned after rating (within fuzz tolerance) — spot-check one rating.
- Queue advances correctly with multiple cards; empty state appears cleanly.
- No console errors in the browser during the review flow.
- Cloudflare `wrangler tail` (if deploying) shows no unexpected `nodejs_compat` warnings.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the walkthrough went end-to-end without regressions.

---

## Testing Strategy

### Unit Tests:

- `src/lib/review/scheduler.test.ts` — `emptyCardState()` shape, `computePreview()` monotonicity, `hydrateCard()` date conversion. Fuzz **off** (deterministic).
- `src/pages/api/cards.test.ts` — update existing insert assertion to `expect.objectContaining` for the FSRS spread.

### Integration Tests:

- `src/pages/api/review/next.test.ts` — 401, 500 (no client), 200 with card + preview, 200 empty queue + nextDueAt, 405.
- `src/pages/api/review/[card_id]/rate.test.ts` — 401, 400 bad input, 404 unknown card, 200 happy-path (RPC called with correct payload), 405.
- `supabase/tests/rls.test.sql` — expanded pgTAP: RLS on the redesigned `review_history`, `commit_review` returns owned card, `commit_review` on a foreign card raises `42501`, anon lockout on the new table.

### Manual Testing Steps:

1. Sign in, paste text at `/generate`, accept 3 proposals.
2. Navigate to `/review` — first question renders.
3. Click "Show answer" — answer reveals, 4 buttons show interval hints.
4. Click "Good" — next question renders. Check DB: `cards.reps = 1`, `review_history` has one new row for that card.
5. Rate the remaining 2 cards "Again" and "Easy" respectively. Confirm interval hints for "Again" produce sub-day durations; "Easy" produces multi-day.
6. Confirm the empty state: after clearing the queue, page shows "Sesja zakończona" + a next-due timestamp.
7. Sign out, hit `/review` directly — redirect to `/auth/signin`.
8. As a fresh account with zero cards, `/review` shows empty state with `nextDueAt: null` phrasing.

## Performance Considerations

- Both `GET /api/review/next` and the RPC round-trip fit comfortably within the PRD `p95 < 30s` budget (that budget targets AI generation, not review; review round-trip should be < 300ms typical).
- `cards(user_id, due)` index makes the "next due" query index-only for typical deck sizes (thousands of cards).
- Preview payload is ~200 bytes — negligible.
- `ts-fsrs` is pure math, no I/O — instantiated once at module load, safe to reuse across Worker requests.

## Migration Notes

- Live rows in `cards` are backfilled via SQL DEFAULT-s to values that match `createEmptyCard()`. Historically all cards will therefore be marked `due = <migration_apply_time>` — meaning immediately after deploy every existing card is treated as "due today". This is intentional for MVP (no legacy schedule to preserve; users can rate them and reset the schedule).
- `review_history` is dropped; no data is preserved from the previous shape (it was never written to by any endpoint).
- Rolling back requires: revert migration file, `supabase db reset`, `npm run db:types`. No production DB has this schema yet at planning time.

## References

- Research: `context/changes/first-review-session/research.md`
- API reference: `context/changes/first-review-session/ts-fsrs-api-docs.md`
- Library shortlist: `context/changes/first-review-session/srs-library-research.md`
- PRD slice: `context/foundation/prd.md` §US-02, FR-012–FR-015
- Roadmap: `context/foundation/roadmap.md` §S-02
- Template — service module: `src/lib/ai/generate-proposals.ts`
- Template — endpoint: `src/pages/api/cards.ts:1-69`
- Template — endpoint test: `src/pages/api/cards.test.ts:1-137`
- Template — React island page: `src/pages/generate.astro:1-24`
- Template — React island component tree: `src/components/generate/GeneratePanel.tsx`
- Template — pgTAP: `supabase/tests/rls.test.sql:1-168`
- Existing migration: `supabase/migrations/20260707200908_initial_schema.sql`
- Runtime config: `wrangler.jsonc:5-6`, `astro.config.mjs:23-34`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Migration, `commit_review` RPC, pgTAP

#### Automated

- [x] 1.1 Migration applies cleanly against an empty DB (`supabase db reset`) — 07737fb
- [x] 1.2 Migration applies cleanly against a DB with existing S-01 `cards` rows (backfill DEFAULT-s populate) — 07737fb
- [x] 1.3 pgTAP suite passes (`supabase test db`) — 14 existing + ~4 new assertions — 07737fb
- [x] 1.4 `npm run db:types` produces `Database` with `commit_review` under Functions and all new columns on `cards` + `review_history` — 07737fb
- [x] 1.5 `npm run lint` passes — 07737fb
- [x] 1.6 `npm run build` passes — 07737fb

#### Manual

- [x] 1.7 Migration file is self-contained and readable — comments explain what and why — 07737fb
- [x] 1.8 `src/db/database.types.ts` inspection — no phantom `next_review_at`; all 12 required fields on `review_history.Row` — 07737fb

### Phase 2: Install `ts-fsrs`, scheduler service, retrofit `POST /api/cards`

#### Automated

- [x] 2.1 `npm test` passes (existing + new scheduler unit tests) — 5eb6af0
- [x] 2.2 `npm run lint` passes (`react-compiler/react-compiler` green) — 5eb6af0
- [x] 2.3 `npm run build` passes — Astro bundles `ts-fsrs` into the Worker — 5eb6af0
- [x] 2.4 `wrangler deploy --dry-run` — no new nodejs_compat warnings — 5eb6af0

#### Manual

- [x] 2.5 `/generate` save produces a card row with `due ≈ now()`, `state = 0`, `stability = 0`, `reps = 0` — 5eb6af0
- [x] 2.6 `src/lib/review/scheduler.ts` — one file, one folder, no cross-imports outside `ts-fsrs` — 5eb6af0

### Phase 3: Review API endpoints

#### Automated

- [x] 3.1 `npm test` passes (existing + new endpoint tests)
- [x] 3.2 `npm run lint` passes
- [x] 3.3 `npm run build` passes with the new `[card_id]` dynamic route
- [x] 3.4 `npm run deploy:dry` succeeds

#### Manual

- [ ] 3.5 `curl GET /api/review/next` returns a card + preview, or `{ card: null, nextDueAt }`
- [ ] 3.6 `curl POST /api/review/<card>/rate {"rating":3}` returns updated card; `reps` incremented, `due` advanced
- [ ] 3.7 Rating a card owned by another user returns 404 (RLS-hidden)

### Phase 4: Frontend `/review` page + `ReviewSession` React island

#### Automated

- [ ] 4.1 `npm run lint` passes (including `react-compiler`)
- [ ] 4.2 `npm run build` passes
- [ ] 4.3 `npm test` passes — no regression in existing suite

#### Manual

- [ ] 4.4 Signed-in `/review` shows question → answer → 4 rating buttons with interval hints
- [ ] 4.5 Signed-out `/review` redirects to `/auth/signin`
- [ ] 4.6 Empty deck shows "Brak fiszek w talii" (or equivalent) without crash
- [ ] 4.7 Consecutive ratings advance the queue; `reps` grows in DB
- [ ] 4.8 Refresh mid-session — next-due card reappears (server-driven)

### Phase 5: End-to-end verification + roadmap update

#### Automated

- [ ] 5.1 `supabase test db` — all pgTAP assertions green
- [ ] 5.2 `npm run lint && npm run build && npm test` — all green
- [ ] 5.3 `npm run deploy:dry` succeeds
- [ ] 5.4 Git status clean outside `context/changes/first-review-session/`

#### Manual

- [ ] 5.5 Full US-02 flow: paste → accept → review → rate → next due — no errors, no dead-ends
- [ ] 5.6 Preview interval hint matches actual `due` after rating (within fuzz tolerance)
- [ ] 5.7 No browser console errors during review flow
- [ ] 5.8 Roadmap S-02 flipped to `done`; PRD Open Q1 marked resolved
