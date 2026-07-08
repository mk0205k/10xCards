# First AI Generation + Accept — Plan Brief

> Full plan: `context/changes/first-ai-generation-and-accept/plan.md`

## What & Why

Ship roadmap slice **S-01**: a logged-in user pastes up to 10 000 characters of source text on `/generate`, sees AI-generated Q/A proposals stream in one-by-one within 30 seconds, and accepts / edits / rejects each. Accepted (or edited-then-accepted) proposals commit to the `cards` table with `source='ai'`. This is the product wedge — AI-grounded content behind a mandatory human decision gate — and it unblocks the north-star review session (S-02).

## Starting Point

F-01 landed the DB layer (`cards`, `review_history`, RLS, generated `Database` types, typed Supabase client). Auth endpoints and middleware already gate `/dashboard`. Zero AI code exists in the repo today — no `ai`, `openai`, or OpenRouter deps. No test runner is configured either; this slice introduces one.

## Desired End State

A signed-in user completes the paste → generate → review → save loop in a single session. Proposals paint one-by-one as the model streams; Accept commits a card to the deck immediately; Reject discards; Edit modifies inline before committing. If OpenRouter aborts mid-stream, already-arrived proposals stay reviewable and a retry button re-runs the input. Rows in `cards` carry `source='ai'` and are RLS-isolated per user.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Slice scope | `/generate` page only; no manual create, no deck list | Keep wedge tight; FR-008 and FR-009 belong to S-03. | Plan |
| Proposal persistence | In-memory React state; write only on accept | No shadow schema, no drafts table — accept is the commit point. | Plan |
| Input length cap | 10 000 chars, Zod-validated, UI counter | Bounds cost + latency; matches PRD "fragment of two pages". | Plan |
| AI stack | Vercel AI SDK (`ai`) + `@openrouter/ai-sdk-provider` + Zod | Zod-schema `streamObject` gives type-safe streaming, workerd-compatible, small bundle footprint. | Plan |
| Default model | `google/gemini-2.5-flash` via `OPENROUTER_MODEL` env | Fast + cheap + strong at structured extraction; overridable per deploy. | Plan |
| Streaming UX | Proposals appear one-by-one as they arrive | Perceived-latency win + aligned with infra R1 (stream from day one). | Plan (infra R1) |
| Failure recovery | Keep partial results + inline **Retry** button | Preserves tokens already spent; matches wedge (nothing wasted from human effort). | Plan |
| Testing | Add Vitest now; cover endpoint + reducer | Sets baseline once for future slices; reducer is the load-bearing piece. | Plan |

## Scope

**In scope:**

- `POST /api/generate` — streaming OpenRouter call with Zod-schema output, 10k input cap, auth guard.
- `POST /api/cards` — single-card insert with `source='ai'`, auth guard, RLS-enforced.
- `/generate` Astro page + React island: paste-box, char counter, streaming proposals list, per-card Accept / Edit / Reject.
- Vitest wired; reducer tests + endpoint contract tests.
- `astro:env/server` extended with `OPENROUTER_API_KEY` + `OPENROUTER_MODEL`.

**Out of scope:**

- Manual card creation (FR-008 → S-03).
- Deck browse / edit / delete on `/dashboard` (FR-009–FR-011 → S-03).
- Spaced-repetition scheduling / review session (US-02, FR-012–FR-015 → S-02).
- Password reset (FR-003 → S-04).
- Per-user API cost cap (PRD Open Q2 → post-MVP).
- Proposal telemetry / accept-rate analytics.
- Non-text media in cards.

## Architecture / Approach

```
Astro page (/generate, protected)
    └── React island: GeneratePanel (useReducer)
            ├── GenerateForm ──POST──> /api/generate ──streamObject──> OpenRouter (Gemini 2.5 Flash)
            │                                                                │
            │                                     (JSON-lines stream) <──────┘
            ├── ProposalsList (streams in one-by-one via useObject-shaped hook)
            │   └── ProposalCard × N
            │           Accept / Save ──POST──> /api/cards ──insert──> Supabase cards (RLS, source='ai')
            │           Reject: local state only
            └── StreamBanner (retry on aborted)
```

Two endpoints, one page, one island, one reducer. RLS is the security boundary — endpoints never bypass `auth.uid() = user_id`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Streaming generation endpoint + AI service + test infra | Verifiable `POST /api/generate`, Vitest wired, endpoint contract tested | OpenRouter SDK / workerd compat — mitigated by `deploy:dry` on every phase + version pins |
| 2. `/generate` page + streaming UI + reducer | Streaming Q/A review UX without persistence; reducer unit-tested | Streaming client + reducer stability — mitigated by exhaustive reducer tests |
| 3. `POST /api/cards` + wire per-card accept | Wedge closed: accepted proposals commit to the deck | RLS bypass or endpoint contract drift — mitigated by endpoint test + manual cross-user check |

**Prerequisites:** F-01 (done). An OpenRouter API key with credit on the account.
**Estimated effort:** ~2–3 solo evening sessions across the three phases (adjustment: the reducer + streaming hook in Phase 2 is the largest single chunk).

## Open Risks & Assumptions

- **Accept-rate risk (wedge validation).** If the AI produces low-quality Q/A pairs, the 75% acceptance secondary metric fails and the product hypothesis wobbles. Mitigated by human-in-the-loop review and prompt iteration; not blocking for MVP shipping.
- **Vercel AI SDK on workerd.** `ai` + `@openrouter/ai-sdk-provider` are workerd-compatible today; a future SDK bump could regress. Mitigated by pinning versions and running `deploy:dry` as an automated gate.
- **Per-user cost runaway (PRD Open Q2).** No throttling per user beyond the 10k-char per-request cap. A determined user could still fan out many requests. Accepted risk for MVP; revisit before public launch.
- **`useObject` DX assumption.** If the `ai/react` client hook fails on workerd for any reason, Phase 2 falls back to a hand-rolled `fetch` + JSON-lines consumer with the same reducer surface. Reducer design accommodates either.

## Success Criteria (Summary)

- A logged-in user can paste text, generate proposals, and land at least one AI-generated card in their deck end-to-end.
- Accepted rows in `cards` carry `source='ai'` and the correct `user_id`; RLS blocks cross-user reads.
- Stream aborts do not lose already-received proposals; retry restores the flow.
- All Vitest tests green, `npm run deploy:dry` passes bundle budget on every phase.
