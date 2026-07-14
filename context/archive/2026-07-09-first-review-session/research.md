---
date: 2026-07-09T00:00:00Z
researcher: Claude (Opus 4.7)
git_commit: 39b6765a2314ff69579b9aa5f55432afd47a4c05
branch: master
repository: 10xdevs
topic: "Is `ts-fsrs` compatible with this codebase for implementing S-02 (first-review-session)?"
tags: [research, compatibility, ts-fsrs, s-02, review-session, cloudflare-workers, supabase]
status: complete
last_updated: 2026-07-09
last_updated_by: Claude (Opus 4.7)
---

# Research: `ts-fsrs` compatibility for S-02

**Date**: 2026-07-09
**Researcher**: Claude (Opus 4.7)
**Git Commit**: 39b6765a2314ff69579b9aa5f55432afd47a4c05
**Branch**: master
**Repository**: 10xdevs

## Research Question

Is `ts-fsrs` (as documented in `context/changes/first-review-session/ts-fsrs-api-docs.md`) compatible with the current codebase, given that S-02 ("first-review-session") from `context/foundation/roadmap.md` is the next slice to plan?

## Summary

**Verdict: compatible — go ahead with `ts-fsrs`.** No runtime or bundler blockers. Every convention the docs assume (server-side Supabase factory, Zod validation, RLS + per-op policies, pgTAP tests, `astro:env/server`, ESM, per-request client) is already in place. The library is 0-runtime-dep pure TS and Node ≥ 20 — `nodejs_compat` is **already set** in `wrangler.jsonc:6`, so no wrangler patch is needed.

There is **one meaningful gap**: the F-01 migration created a `review_history` table with a **minimal shape** (`id, card_id, user_id, reviewed_at, rating, next_review_at`) that pre-dated the FSRS decision. It does **not** match the ts-fsrs `ReviewLog` interface. `cards` similarly lacks all FSRS state columns. S-02 must ship a new migration that (a) adds ~10 FSRS columns to `cards`, (b) expands `review_history` to the full ReviewLog shape, (c) backfills existing rows (S-01 is `done`, so live rows exist), and (d) extends `supabase/tests/rls.test.sql`.

There is also **one novel-for-this-repo pattern** in the ts-fsrs docs: a dynamic API route (`src/pages/api/review/[card_id]/rate.ts`). No `[param]` route exists in the project yet — the first one to write. Low risk, standard Astro syntax, but worth flagging for `/10x-plan`.

## Detailed Findings

### 1. Runtime / bundler compatibility — GREEN

- **`nodejs_compat` already enabled** at `wrangler.jsonc:6` — no change needed. `compatibility_date: 2026-05-08` at `wrangler.jsonc:5` is well past Node-20 support.
- **`ts-fsrs`** ships ESM + CJS + UMD, 0 runtime deps, MIT — bundles cleanly under Astro + `@astrojs/cloudflare`.
- **Astro 6.3.1 SSR** (`astro.config.mjs:11` `output: "server"`), **React 19.2.6**, **TS 5.9.3 strict** — all match the docs' assumed stack (per `package.json:19-64`).
- **Postgres 17** locally (`supabase/config.toml:36`) — supports `timestamptz`, `double precision`, `smallint` and enums with no reservation.
- No env vars required by `ts-fsrs`; `astro.config.mjs` `env.schema` (per prior sub-agent) already declares `SUPABASE_URL`, `SUPABASE_KEY`, `OPENROUTER_API_KEY` — no additions needed.

### 2. Database schema gap — NEEDS MIGRATION

Current shape (`supabase/migrations/20260707200908_initial_schema.sql`):

- `public.cards` (`:20-28`): `id, user_id, question, answer, source, created_at, updated_at` — **zero FSRS state columns**.
- `public.review_history` (`:30-37`): `id, card_id, user_id, reviewed_at, rating (smallint), next_review_at` — **does not match the ts-fsrs `ReviewLog` interface** (missing `state`, `stability`, `difficulty`, `elapsed_days`, `last_elapsed_days`, `scheduled_days`, `learning_steps`, `due-before`).
- Indexes present: `cards_user_created_idx (user_id, created_at desc)`; `review_history_user_due_idx (user_id, next_review_at)` (`:41-43`). The FSRS "next due" query wants `cards(user_id, due)` — new index.
- RLS + per-op-per-role policies already correct pattern (`:79-129`).

**Migration delta S-02 must ship** (single new file, e.g. `supabase/migrations/YYYYMMDDHHmmss_fsrs_state.sql`):

- `ALTER TABLE cards ADD COLUMN due timestamptz`, `stability double precision`, `difficulty double precision`, `elapsed_days integer`, `scheduled_days integer`, `learning_steps integer`, `reps integer`, `lapses integer`, `state smallint` (or a `card_state` enum matching the `card_source` pattern at `:16`), `last_review timestamptz`.
- **Backfill** for existing S-01 rows: either seed via `createEmptyCard()` values (`due = now()`, `state = 0`, `stability = 0`, `difficulty = 0`, `reps = 0`, `lapses = 0`, ...) or make columns nullable and add a `NOT NULL` follow-up after backfill. S-01 is `done` (roadmap:37), so live rows exist — a naked `ADD COLUMN NOT NULL` will fail without a `DEFAULT` or backfill step.
- `ALTER TABLE review_history` to add: `state smallint`, `due_before timestamptz`, `stability double precision`, `difficulty double precision`, `elapsed_days integer`, `last_elapsed_days integer`, `scheduled_days integer`, `learning_steps integer`. Existing `reviewed_at` maps to ReviewLog `review`; existing `rating` stays. `next_review_at` becomes redundant (post-review due lives on `cards`) — decision point: keep as denormalized snapshot vs drop. Recommend keep for the transaction sanity check.
- `CREATE INDEX cards_user_due_idx ON cards (user_id, due)` — powers the `GET /api/review/next` query.
- Extend `supabase/tests/rls.test.sql` — existing pgTAP conventions (`select plan(N)`, `select is(...)`, `select throws_ok(...)`, role switching via `set local request.jwt.claims`) transfer directly. Add assertions that the new columns are RLS-isolated on `user_id`.

### 3. Service + endpoint conventions — GREEN, minor precedent gap

- `src/lib/services/` **does not exist yet**. The established sibling is `src/lib/ai/generate-proposals.ts` (service module with Zod schemas + typed exports), consumed by `src/pages/api/generate.ts:5`. Creating `src/lib/services/review-scheduler.ts` follows the same shape.
- `src/pages/api/cards.ts` (S-01 output):
  - Exports `const prerender = false` (`:5`) — hard rule per `AGENTS.md` respected.
  - Uses `createClient(context.request.headers, context.cookies)` per-request (`:38`) from `src/lib/supabase.ts` — typed with `Database` generic; retrofit for FSRS insert stays inside this pattern.
  - Zod `bodySchema` validation (`:7-11`); response `{ card: CardRow }` on 201, `{ error, issues? }` on failure. Reuse for `POST /api/review/[card_id]/rate`.
  - **Currently inserts only `{ user_id, question, answer, source }`** (`:44-51`). Must be retrofitted to spread `createEmptyCard()` FSRS fields on insert.
- `src/pages/api/generate.ts` shows the service-vs-endpoint split (endpoint = HTTP + auth + validation; service = domain logic + typed schemas). Follow verbatim for review.
- **Dynamic route precedent**: none. No `src/pages/api/**/[param]/**` exists. The proposed `src/pages/api/review/[card_id]/rate.ts` is the first — standard Astro `context.params.card_id`, but no in-repo template to copy. Worth a `/10x-plan` note.
- Auth: middleware (`src/middleware.ts`) only gates *pages* via `PROTECTED_ROUTES` (currently `["/dashboard", "/generate"]`) — API endpoints authenticate via `context.locals.user` inside the handler (`src/pages/api/cards.ts:21` pattern). Add `"/review"` to `PROTECTED_ROUTES` for the frontend page; do the `locals.user` check inside the two new endpoints.

### 4. Supabase types + client — GREEN

- `Database` types are generated (`src/db/database.types.ts`, script `npm run db:types` at `package.json:15`). After the new migration, one `npm run db:types` run refreshes the FSRS columns automatically.
- Client factory `src/lib/supabase.ts` returns `createServerClient<Database>(...)` per-request from headers + cookies — no module-scope caching. Fine for Workers.
- No Supabase client stored in `App.Locals` (`src/env.d.ts` exposes only `user: User | null`). Endpoints re-instantiate. No change needed for review endpoints.
- DTO convention: `src/lib/api/cards.ts` re-exports `CardRow = Database["public"]["Tables"]["cards"]["Row"]` and defines `CreateCardParams` inline. Mirror this: `ReviewHistoryRow`, `RateCardParams`, `NextDueResponse` (with optional `preview` field).
- **Date handling**: types come back as `string` (ISO). Docs' `TypeConvert.card(row)` normalizes strings → `Date` before calling `scheduler.next()`. Apply in the service module, not the endpoint.

### 5. Test infrastructure — GREEN

- pgTAP live at `supabase/tests/rls.test.sql`; conventions extendable per §2.
- Endpoint tests via vitest (`src/pages/api/cards.test.ts`, `src/pages/api/generate.test.ts`) use `vi.mock()` on the Supabase client + a hand-built `{ request, locals, cookies, url }` context. Extend for `[card_id]` dynamic routes by adding `params: { card_id: "..." }` to the context object.

## Code References

- `wrangler.jsonc:5-6` — `compatibility_date` + `nodejs_compat` — **already satisfies ts-fsrs Node ≥ 20**.
- `supabase/migrations/20260707200908_initial_schema.sql:20-28` — current `cards` (no FSRS columns).
- `supabase/migrations/20260707200908_initial_schema.sql:30-37` — current `review_history` (minimal, doesn't match `ReviewLog`).
- `supabase/migrations/20260707200908_initial_schema.sql:41-43` — indexes; needs new `cards(user_id, due)`.
- `supabase/migrations/20260707200908_initial_schema.sql:79-129` — RLS policy pattern to reuse.
- `src/pages/api/cards.ts:5,7-11,38,44-51` — insert path to retrofit with `createEmptyCard()`.
- `src/pages/api/generate.ts:5` + `src/lib/ai/generate-proposals.ts` — template for `src/lib/services/review-scheduler.ts`.
- `src/lib/supabase.ts` — `createServerClient<Database>()` factory to reuse in review endpoints.
- `src/db/database.types.ts` — regenerate via `npm run db:types` after new migration.
- `src/middleware.ts:4` — add `"/review"` to `PROTECTED_ROUTES`.
- `src/lib/api/cards.ts` — DTO re-export convention to mirror for review endpoints.
- `supabase/tests/rls.test.sql` — pgTAP conventions to extend for new columns.
- `package.json:15,17,63` — `db:types` script, vitest, supabase CLI 2.109 present.

## Architecture Insights

- Service modules live under `src/lib/<domain>/` (currently `ai/`, `api/`). `src/lib/services/review-scheduler.ts` per the docs is a new sub-tree — either add `services/` as the docs suggest or place under `src/lib/review/` for parity with `src/lib/ai/`. Either is fine; the docs' path is a suggestion. Recommend `src/lib/review/scheduler.ts` for consistency with existing `ai/` sibling.
- The `ts-fsrs` singleton (`fsrs(generatorParameters({...}))`) is module-scope safe on Workers — pure function factory, no I/O. Instantiate once at import time in the service module.
- `enable_fuzz: true` (docs' MVP config) adds ±5% randomization to intervals. Deterministic-testing implication: use `enable_fuzz: false` in test doubles, or inject `now` and seed. Note for `/10x-plan`.
- The docs propose `state` as `smallint (0–3)`. The repo has precedent for enums (`card_source at :16`). A `card_state` enum (`'new' | 'learning' | 'review' | 'relearning'`) would be more idiomatic here than `smallint`, but `ts-fsrs` emits ints — an enum requires round-trip mapping. Recommend `smallint` + a `check (state between 0 and 3)` constraint for MVP; upgrade to enum later if it becomes load-bearing.
- Transactional commit (`UPDATE cards + INSERT review_history` in one round-trip) — Supabase JS client can't easily open a transaction from the edge. Two options: (a) call a Postgres RPC that wraps both, (b) do two sequential writes and rely on RLS + FK to keep the invariant. The docs assume single-transaction; if we accept two-step, we should document the invariant and add a pgTAP check that no orphaned `review_history` rows exist without a matching `cards` update. `/10x-plan` decision.

## Historical Context (from prior changes)

- **F-01 (`data-schema-and-rls`, done 2026-07-07)** — created the initial migration and pgTAP tests. It made the algorithm-agnostic choice for `review_history` (`rating` + `next_review_at`), which is the source of the schema gap here. See archive at `context/archive/2026-07-07-data-schema-and-rls/`.
- **S-01 (`first-ai-generation-and-accept`, done 2026-07-08)** — added `POST /api/cards` insert path and `src/lib/ai/generate-proposals.ts` service pattern. S-02's `cards.ts` retrofit inherits this endpoint. See archive at `context/archive/2026-07-07-first-ai-generation-and-accept/`.
- **Library shortlist** — `context/changes/first-review-session/srs-library-research.md` already down-selected candidates. `ts-fsrs` is the chosen candidate; this research confirms the fit against live code.
- **Roadmap Open Q1** — the algorithm choice that blocked S-02 (`context/foundation/roadmap.md:100-102, 142`) is implicitly resolved by picking `ts-fsrs`. Confirm with user before `/10x-plan`.
- **Lessons** — `context/foundation/lessons.md` contains one active rule ("kill date on feature flags") — not directly load-bearing here since S-02 doesn't need a flag, but if the plan introduces one (e.g., toggle FSRS vs. no-op scheduler during rollout), it must carry a kill date.

## Related Research

- `context/changes/first-review-session/srs-library-research.md` — library shortlist that selected `ts-fsrs`.
- `context/changes/first-review-session/ts-fsrs-api-docs.md` — the API doc under review.
- `context/foundation/roadmap.md#s-02` — slice being planned.
- `context/foundation/tech-stack.md` — stack constraints assumed by both docs above.

## Open Questions

1. **Backfill strategy for existing `cards` rows.** S-01 already merged and live users may have cards. Option A: `ADD COLUMN ... NOT NULL DEFAULT` with a values derived from `createEmptyCard()` semantics in SQL. Option B: nullable columns + a one-shot `UPDATE` + follow-up `ALTER ... SET NOT NULL`. Owner: user / `/10x-plan`. Not blocking; a `/10x-plan` decision.
2. **Enum vs `smallint` for `card_state`.** See Architecture Insights. `/10x-plan` decision.
3. **Transactional commit strategy.** RPC vs two-writes-with-RLS. See Architecture Insights. `/10x-plan` decision.
4. **Service module location** — `src/lib/services/review-scheduler.ts` (per docs) vs `src/lib/review/scheduler.ts` (per repo `src/lib/ai/` convention). Cosmetic; user preference.
5. **Preview response shape** — return `scheduler.repeat()` result inline with `GET /api/review/next`, or expose a separate endpoint. Docs flag this as a `/10x-plan` decision point; noted here for continuity.
6. **`enable_fuzz` in tests** — deterministic testing requires either disabling fuzz in the test scheduler or injecting `now`. Confirm test strategy at `/10x-plan`.
