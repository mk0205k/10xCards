---
change_id: first-review-session
doc: library-research
created: 2026-07-09
source: exa web_search (mcp__exa__web_search_exa)
purpose: Shortlist spaced-repetition libraries compatible with 10xCards tech stack, to inform PRD Open Q1 resolution before /10x-plan.
---

# Spaced-repetition libraries for S-02

Research feeding PRD Open Q1 ("Wybór algorytmu SR — binary vs SM-2 vs FSRS vs inny"). Filtered for compatibility with `context/foundation/tech-stack.md`: Astro 6 SSR + React 19 + TypeScript strict, Cloudflare Workers runtime, Supabase Postgres, npm.

## Compatibility constraints

- **Runtime**: Cloudflare Workers (edge). Node-only packages need `compatibility_flags: ["nodejs_compat"]` in `wrangler.jsonc`.
- **Language**: TypeScript strict — first-class TS types are a hard requirement.
- **Persistence**: Card state must be JSON-serializable to fit the `review_history` schema in Supabase Postgres (F-01).
- **Bundle**: ESM preferred for Astro SSR + React 19 islands.

## FSRS (modern, evidence-based)

### `ts-fsrs` — recommended if going FSRS
- Repo: https://github.com/open-spaced-repetition/ts-fsrs
- npm: https://www.npmjs.com/package/ts-fsrs
- FSRS v6, TS-native, ESM+CJS+UMD, 0 runtime deps, ~97K weekly downloads, MIT
- **Node ≥ 20 required** → needs `nodejs_compat` on Workers
- API: `fsrs()`, `createEmptyCard()`, `Rating`, `scheduler.next(card, date, rating)` → maps 1:1 to FR-014 rating flow
- Ratings: 1–4 (Again / Hard / Good / Easy)
- Serializable card state (`stability`, `difficulty`, `due`, `state`, `reps`, `lapses`, ...) → fits `review_history` cleanly
- Companion `@open-spaced-repetition/binding` package if user-specific parameter training becomes relevant later

### `quanta-fsrs`
- Repo: https://github.com/ammmcreativetech-dot/quanta-fsrs
- FSRS v4.5/5, 0 deps, edge-ready (explicit CF Workers / Vercel Edge support), Node ≥ 18
- Smaller/newer than `ts-fsrs`, used in production at quanta-study.de (single-vendor)
- Simpler surface: `updateFSRS(state, grade, now?, weights?)`, `calculateRetrievability(...)`

### `@squeakyrobot/fsrs`
- npm: https://www.npmjs.com/package/@squeakyrobot/fsrs
- FSRS v4.5 + optional v6, pure functions, 0 deps, explicit CF Workers / Vercel Edge / Deno Deploy support
- Very low adoption (~7 weekly downloads) — viable but less battle-tested; would depend heavily on the maintainer

## SM-2 (classic, auditable)

### `@open-spaced-repetition/sm-2` — recommended if going SM-2
- Repo: https://github.com/open-spaced-repetition/sm-2-ts
- Same org as `ts-fsrs`, TypeScript, MIT
- JSON-serializable `Card` and `ReviewLog` objects
- API: `new Scheduler()`, `card = new Card()`, `scheduler.reviewCard(card, rating)`
- Minimal surface, no training data needed

### `@monkey-dev-vibes/spaced-repetition`
- Repo: https://github.com/Monkey-Dev-Vibes/spaced-repetition
- Pure SM-2 function `(card, rating) → card`, ~95 LoC, 0 runtime deps, dual ESM+CJS
- Works on Node ≥ 18, browsers, Workers, Deno, Bun (no peer deps, no native modules)
- Best fit if the goal is a fully auditable, single-vendor-independent SM-2

## Recommendation for 10xCards

Given `main_goal: speed`, `top_blocker: time`, 3-week solo after-hours budget:

- **FSRS path → `ts-fsrs`**. Closest to canonical, actively maintained, `next()` matches FR-014 one-to-one. Better retention accuracy but ratings-scale of 4 adds one UI decision.
- **SM-2 path → `@open-spaced-repetition/sm-2`**. Same org quality, minimal surface, cheaper to reason about at MVP scale where no per-user training data exists yet.

FSRS's accuracy advantage over SM-2 (~22–81% on log-loss benchmarks vs. Anki data) only materializes once the deck has meaningful review history. For an MVP with zero prior data, both are defensible.

## Actions before `/10x-plan`

- [ ] Resolve PRD Open Q1 (algorithm choice) — owner: user, blocks S-02
- [ ] Lock rating scale (FSRS 1–4 vs SM-2 0–5) — determines FR-014 UI and `review_history` schema shape
- [ ] If Workers deploy: add `compatibility_flags: ["nodejs_compat"]` to `wrangler.jsonc` (required by `ts-fsrs`, optional for edge-native alternatives)
