# S-02: First Review Session — Plan Brief

> Full plan: `context/changes/first-review-session/plan.md`
> Research: `context/changes/first-review-session/research.md`

## What & Why

Deliver the north-star slice from `context/foundation/roadmap.md`: a logged-in user opens `/review`, sees a due card, reveals the answer, rates difficulty on the FSRS 4-button scale, and the algorithm writes a new `due` date. Closing this flow is what validates the whole product hypothesis (AI-generated cards + spaced repetition) end-to-end — S-01 alone only proves half of it.

## Starting Point

`cards` and `review_history` exist from F-01 but with algorithm-agnostic shapes (no FSRS state on `cards`; `review_history` is a 6-column placeholder that was never written to). `POST /api/cards` from S-01 is live and has produced rows. Cloudflare Workers config already has `nodejs_compat` — no runtime work needed. Endpoint, service, pgTAP, React-island, and Zod conventions are all established (`src/lib/ai/generate-proposals.ts`, `src/pages/api/cards.ts`, `supabase/tests/rls.test.sql`, `src/pages/generate.astro`).

## Desired End State

A user with at least one due card can open `/review`, work through the queue one card at a time with visible interval hints on each rating button, and see a "session complete + next card ready at …" state when the queue empties. Card state and full FSRS ReviewLog rows are persisted per rating via a single atomic Postgres RPC. Manual walkthrough of PRD Success Criteria steps 1–7 completes without dead-ends.

## Key Decisions Made

| Decision                         | Choice                                                    | Why (1 sentence)                                                                                                          | Source   |
| -------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------- |
| SRS algorithm / library          | FSRS-6 via `ts-fsrs`                                      | Canonical, active, 0-dep pure TS, `next()` matches FR-014 1:1                                                             | Research |
| `review_history` migration shape | DROP + CREATE in ReviewLog shape                          | Table was empty; a clean rebuild is cheaper than incremental ALTER + placeholder columns                                  | Plan     |
| `state` representation           | `smallint` + `CHECK (state BETWEEN 0 AND 3)`              | ts-fsrs emits int; enum would force round-trip mapping and break `TypeConvert.card()` directly                            | Plan     |
| Backfill for live `cards` rows   | `ADD COLUMN NOT NULL DEFAULT` matching `createEmptyCard`  | One atomic migration, no follow-up ALTER, no downtime, existing rows become "due now" (acceptable for MVP)                | Plan     |
| Card-update ↔ log-insert atomicity | Postgres RPC `commit_review` (`SECURITY INVOKER`)         | Workers/Supabase JS client can't open client-side transactions; RPC keeps RLS enforcement and gives one atomic write path | Plan     |
| Scheduler service location       | `src/lib/review/scheduler.ts`                             | Matches existing `src/lib/ai/` domain-per-folder convention                                                               | Plan     |
| Preview interval delivery        | Inline in `GET /api/review/next` payload                  | Zero `ts-fsrs` bytes on the client, server-clock-authoritative, no extra round-trip                                       | Plan     |
| Empty-queue UX                   | `{ card: null, nextDueAt }` + "Session complete + …"      | Closes the loop cleanly, supports the retention success metric (returns 3× in first week) without push notifications     | Plan     |
| Test determinism                 | `createScheduler({ enableFuzz? })` + `defaultScheduler`   | Prod keeps `enable_fuzz: true` (avoids review pile-ups); tests import a deterministic scheduler with fuzz disabled        | Plan     |

## Scope

**In scope:**

- Migration: FSRS columns on `cards`, redesigned `review_history`, `commit_review` RPC, `cards(user_id, due)` index.
- pgTAP rewrite: existing RLS suite adapted to the new `review_history` shape + coverage for the RPC.
- Regenerated `Database` types (via `npm run db:types`).
- New service module `src/lib/review/scheduler.ts`.
- Retrofit `POST /api/cards` to include the FSRS state explicitly.
- Two new API endpoints: `GET /api/review/next`, `POST /api/review/[card_id]/rate` (first `[param]` route in the repo).
- Frontend: `/review` page + `ReviewSession.tsx` React island + `src/lib/api/review.ts` wrapper.
- Middleware: `PROTECTED_ROUTES += "/review"`.
- Roadmap update: S-02 → `done`; PRD Open Q1 resolved.

**Out of scope:**

- Per-user FSRS weight retraining (no `@open-spaced-repetition/binding`).
- Push / email due-card notifications (PRD Non-Goals).
- Client-side FSRS math — `ts-fsrs` stays server-only.
- Batch prefetching or client-side queue caching.
- UI theming variant, custom review layout.
- CRUD on `review_history` from the UI.
- Renaming `review_history` (dropped and recreated with the same name).

## Architecture / Approach

Bottom-up in 5 phases. DB migration + RPC + regenerated types land first so all downstream code compiles against the final schema. The scheduler service wraps `ts-fsrs` into two exports: `defaultScheduler` (fuzz on, endpoints) and `createScheduler` (fuzz off, tests). `POST /api/cards` is retrofitted so freshly-created cards get FSRS state explicitly in code — DB DEFAULT-s are the safety net, not the mechanism. Two review endpoints follow the same shape as `cards.ts` (Zod, `context.locals.user`, `prerender = false`) and hit Supabase via the per-request `createClient(headers, cookies)` factory. Rating goes through the `commit_review` RPC so the card UPDATE and log INSERT are atomic. React island owns the linear state machine (`loading → question → answer → rating → next`), fetches preview data server-side, and renders 4 rating buttons with interval hints.

## Phases at a Glance

| Phase                                       | What it delivers                                                                                     | Key risk                                                                                                    |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1. Migration + RPC + pgTAP                  | Redesigned schema, `commit_review` function, updated tests, regenerated types                        | Backfill DEFAULT-s or JSON→columns projection in the RPC wrong → cascade of type errors in phases 2–3       |
| 2. `ts-fsrs` + scheduler + cards retrofit   | Library installed, `src/lib/review/scheduler.ts`, updated `POST /api/cards`, deterministic unit tests | `enable_fuzz` accidentally on in tests → flaky assertions                                                   |
| 3. Review API endpoints                     | `GET /api/review/next` + `POST /api/review/[card_id]/rate` + endpoint tests                          | First dynamic route in repo — Astro `[param]` conventions untested; endpoint test context needs new `params` |
| 4. Frontend `/review` + `ReviewSession.tsx` | Page, React island, client wrapper, protected route                                                  | React-compiler safety on the state machine; empty-state rendering                                           |
| 5. E2E verification + roadmap update        | Full US-02 walkthrough, S-02 marked done, PRD Q1 resolved                                            | Manual walkthrough reveals a regression not caught by unit/pgTAP tests                                      |

**Prerequisites:** F-01 (done), S-01 (done), Node ≥ 20 via `nodejs_compat` (set). Supabase local stack running for `db reset` / `test db`.
**Estimated effort:** ~3-4 focused sessions across the 5 phases; migration + endpoints are the largest chunks.

## Open Risks & Assumptions

- **`SECURITY INVOKER` RLS behaviour**: assumes `auth.uid()` inside the RPC returns the caller's uid — matches Supabase docs for `security invoker` functions, but Phase 1 pgTAP must explicitly test the "user A calls RPC on user B's card → 42501" path or the assumption is unverified.
- **`nodejs_compat` bundle size**: `ts-fsrs` is 0-dep pure TS, but `deploy:dry` in Phase 3 is the check-in point. If bundle bloats unexpectedly, investigate before Phase 4.
- **Existing card rows have `due = migration_apply_time`** — every legacy card becomes immediately due on deploy. Acceptable for MVP (no legacy schedule to preserve), but if the user has piloted with many cards, the first `/review` session will be a long queue. Not a bug, just a heads-up.
- **`enable_fuzz` variance in Phase 5 manual test**: preview interval and actual `due` may differ by ±5%. Assertions in unit tests are deterministic (fuzz off); manual verification just needs a rough match, not exact equality.

## Success Criteria (Summary)

- User can complete PRD Success Criteria steps 1–7 in a single session with no errors or dead-ends.
- Every rating writes both an updated `cards` row and a matching `review_history` row atomically (proven by pgTAP + manual DB inspection).
- `/review` is protected: unauthenticated redirect to `/auth/signin`; authenticated queue advances one card at a time until empty, then shows next-due timestamp.
