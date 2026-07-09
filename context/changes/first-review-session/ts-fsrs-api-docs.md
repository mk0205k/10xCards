---
change_id: first-review-session
doc: library-docs-ts-fsrs
created: 2026-07-09
source: Context7 MCP (/open-spaced-repetition/ts-fsrs)
purpose: API surface and data model reference for implementing S-02 with ts-fsrs. Consume during /10x-plan and /10x-implement so we don't re-fetch docs mid-run.
---

# ts-fsrs — implementation reference for S-02

Companion to `library-research.md` (which shortlisted candidates). This doc assumes `ts-fsrs` is the chosen library and captures the exact API surface needed to implement the review session (FR-012 through FR-015) and to shape the migration for `review_history`.

Package: `/open-spaced-repetition/ts-fsrs` — official, TS-native, FSRS-6 defaults, 0 runtime deps, MIT. Requires Node ≥ 20 → set `compatibility_flags: ["nodejs_compat"]` in `wrangler.jsonc` before wiring.

## Core imports

```ts
import { fsrs, createEmptyCard, Rating, State, generatorParameters, TypeConvert } from 'ts-fsrs'
```

## Card data model (persist per card)

The `Card` interface holds everything FSRS needs. These fields become columns on the `cards` table (or a `card_state` sidecar, depending on migration decision):

| Field | Type | DB mapping | Notes |
|---|---|---|---|
| `due` | `Date` | `timestamptz` | next review — index this; queries "cards due today" filter on it |
| `stability` | `number` | `double precision` | memory stability |
| `difficulty` | `number` | `double precision` | card difficulty |
| `elapsed_days` | `number` | `integer` | deprecated on interface but still emitted; store for round-trip fidelity |
| `scheduled_days` | `number` | `integer` | current interval in days |
| `learning_steps` | `number` | `integer` | position within learning steps |
| `reps` | `number` | `integer` | total reviews |
| `lapses` | `number` | `integer` | failed reviews (Again count) |
| `state` | `State` (0–3) | `smallint` | 0=New, 1=Learning, 2=Review, 3=Relearning |
| `last_review` | `Date?` | `timestamptz null` | nullable until first review |

**New card creation** (call from S-01's `POST /api/cards` insert endpoint):

```ts
const card = createEmptyCard()
// { due: now, state: State.New, stability:0, difficulty:0, reps:0, lapses:0, ... }
```

**Reconstructing after DB read** — dates come back as strings, state as int:

```ts
const card = TypeConvert.card(row)  // normalizes strings → Date, ints → State enum
```

## ReviewLog (persist per rating action → `review_history`)

Every `scheduler.next()` call returns a `log`. Store the full shape — enables retraining FSRS weights later without losing history (FR-013).

```ts
interface ReviewLog {
  rating: Rating          // 1=Again, 2=Hard, 3=Good, 4=Easy
  state: State            // state BEFORE the review
  due: Date               // due BEFORE the review
  stability: number
  difficulty: number
  elapsed_days: number
  last_elapsed_days: number
  scheduled_days: number
  learning_steps: number
  review: Date            // when this review happened (server clock)
}
```

`review_history` columns should map 1:1 to these fields, plus `id`, `user_id`, `card_id`, and FK constraints. RLS: user owns own rows (per F-01 pattern).

## The two scheduler calls

**Preview** — before user rates. Returns updated card + log for all four ratings without mutating anything. Use client-side to show interval hints on each button ("Again → 1m", "Good → 4d"):

```ts
const preview = scheduler.repeat(card, new Date())
preview[Rating.Again].card.due   // "if user picks Again, next due is..."
preview[Rating.Hard].card.due
preview[Rating.Good].card.due
preview[Rating.Easy].card.due
```

**Commit** — after user rates. Single call returns updated card + log:

```ts
const { card: updated, log } = scheduler.next(card, new Date(), Rating.Good)
// persist `updated` back to cards; insert `log` into review_history — same transaction
```

## Ratings (maps to FR-014 UI)

```
Rating.Manual (0)  — special; not a user action, ignore in UI
Rating.Again  (1)  — user failed
Rating.Hard   (2)  — difficult but correct
Rating.Good   (3)  — correct, expected difficulty
Rating.Easy   (4)  — very easy
```

Four buttons — resolves PRD Open Q1's rating-scale sub-decision.

## Recommended MVP config

```ts
const scheduler = fsrs(generatorParameters({
  request_retention: 0.9,   // default; target recall probability
  maximum_interval: 36500,  // default; 100y cap
  enable_fuzz: true,        // ON — avoids review-day pileups by randomizing intervals ±5%
  enable_short_term: true,  // default; keeps same-day learning steps
  // learning_steps: ['1m', '10m'],   // default
  // relearning_steps: ['10m'],       // default
}))
```

Leave `w` (21 FSRS weights) at defaults. Retraining is out of scope for MVP — deferred until enough review history accumulates (via `@open-spaced-repetition/binding`, not needed at launch).

## Timezone / date handling

- All FSRS math is UTC-based on JS `Date` objects.
- Store `due`, `last_review`, `review` as `timestamptz` in Postgres.
- Convert to user-local only at render time (frontend).
- `now` passed to `scheduler.next()` should be the server-issued rating timestamp, not client — prevents clock skew from writing bad due dates.

## Suggested wiring for S-02

1. **Migration (extends F-01):**
   - Add FSRS columns to `cards` (nullable defaults only for pre-existing rows; new inserts always populate via `createEmptyCard()`).
   - Create `review_history` with columns matching `ReviewLog` 1:1, plus `id`, `user_id`, `card_id` FK, `created_at`. Enable RLS, add user-owns-own-rows policies (per-op, per-role) in the same migration.
   - Index `cards(user_id, due)` for the "next due" query.

2. **Card insert (retrofit S-01's `POST /api/cards`):** populate FSRS columns from `createEmptyCard()`.

3. **`GET /api/review/next`:**
   ```sql
   SELECT * FROM cards
   WHERE user_id = auth.uid() AND due <= now()
   ORDER BY due
   LIMIT 1;
   ```
   Return the row plus (optionally) precomputed `scheduler.repeat(card, now)` preview so the client can render interval hints without shipping ts-fsrs to the browser. Decision point during `/10x-plan`.

4. **`POST /api/review/:card_id/rate` `{ rating }`:**
   - Load card (RLS filters to owner).
   - `const { card: updated, log } = scheduler.next(card, now, rating)`.
   - Single transaction: `UPDATE cards ... WHERE id = ?` + `INSERT INTO review_history ...`.
   - Return updated card (so client can immediately fetch next or show "next due" toast).

5. **Frontend** (`/review` page, React island):
   - Fetch next due card, show question, "Show answer" reveals answer, then 4 rating buttons.
   - Buttons display interval hints from preview.
   - Submit rating → refetch next due card until queue empty → "Session complete" state.

## Files this doc feeds

- `context/changes/first-review-session/plan.md` (to be created by `/10x-plan`).
- `supabase/migrations/YYYYMMDDHHmmss_review_history.sql`.
- `src/lib/services/review-scheduler.ts` (new — wraps `fsrs()` singleton).
- `src/pages/api/review/next.ts`, `src/pages/api/review/[card_id]/rate.ts`.
- `src/pages/review.astro` + `src/components/ReviewSession.tsx`.
