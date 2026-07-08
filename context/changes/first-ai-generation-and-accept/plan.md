# First AI Generation + Accept/Edit/Reject — Implementation Plan

## Overview

Ship the AI-generation + human-in-the-loop review flow (roadmap S-01). A logged-in user lands on `/generate`, pastes up to 10 000 characters of source text, and clicks **Generate**. The server calls OpenRouter through the Vercel AI SDK with a Zod-typed structured-output schema and streams question/answer proposals back one-by-one. The React island renders each proposal as it arrives; the user accepts, edits-then-accepts, or rejects each proposal. Accepted (post-edit) proposals commit individually to the `cards` table with `source='ai'` under RLS.

This slice delivers the product wedge (AI-grounded + human-in-the-loop before the deck) and unblocks S-02 by ensuring the deck can be populated at all.

## Current State Analysis

- **F-01 landed 2026-07-07** (`context/archive/2026-07-07-data-schema-and-rls/`). `cards` and `review_history` exist in `supabase/migrations/20260707200908_initial_schema.sql` with RLS enforcing `auth.uid() = user_id` for every op. Generated `Database` types live at `src/db/database.types.ts` and are wired into `createServerClient<Database>` in `src/lib/supabase.ts:10`.
- **Auth is already gated**. `src/middleware.ts:4` protects `/dashboard` via `supabase.auth.getUser()`; `App.Locals.user` typed in `src/env.d.ts:1-5`.
- **API convention** is established by the three existing auth endpoints (`src/pages/api/auth/{signin,signup,signout}.ts`): `export const prerender = false`, `createClient(request.headers, cookies)` per handler, redirect-based error responses. This slice is the first to return a streaming body — new convention territory.
- **React island convention**: `.astro` page renders `<Form client:load />` from `src/components/auth/*.tsx`; forms POST plain HTML to `/api/**`. `SubmitButton` uses `useFormStatus()` for pending UX.
- **No AI code exists yet.** No `openai`, `ai`, or `@openrouter/*` in `package.json`. No test runner either (`npm test` is absent).
- **shadcn/ui footprint is minimal** — only `Button` is in `src/components/ui/`. No `Textarea`, `Card`, or toast primitives yet; we'll add what we need.
- **Cloudflare Workers constraints**: `wrangler.jsonc` pins `compatibility_date: "2026-05-08"` and `nodejs_compat`. The infrastructure risk register (R1) mandates the OpenRouter call be `ReadableStream`-shaped from day one to avoid silent truncation when providers rev to streaming-first responses.

## Desired End State

A logged-in user visits `/generate` and completes this loop in a single session:

1. Sees a paste-box (`<Textarea>`) with a live char counter (0 / 10 000). **Generate** is disabled while empty or over cap.
2. On click, proposals stream in one-by-one within 30 seconds (p95) — each card appears the moment the server flushes its bytes.
3. Each proposal shows question + answer + three actions: **Accept**, **Edit**, **Reject**.
4. **Reject** removes the proposal from the list (local state).
5. **Edit** opens inline editing on question and answer with **Save** and **Cancel**; **Save** proceeds to the accept path.
6. **Accept** POSTs one row to `/api/cards` (`source='ai'`); UI shows a spinner then a checkmark; the card is committed to the deck.
7. If the stream aborts mid-flight, already-arrived proposals stay reviewable and a banner offers **Retry**.
8. On successful save, the proposal card remains visible but locked (checkmark, disabled buttons) — clear "this is in your deck" signal.

Verification: end-to-end walk-through under `wrangler dev`, then confirmation that inserted rows carry `source='ai'` and `user_id = auth.uid()` in Supabase.

### Key Discoveries:

- `src/lib/supabase.ts:10` already wires `createServerClient<Database>` — new endpoints just call it and get typed rows for free.
- `src/middleware.ts:4` uses a literal array `PROTECTED_ROUTES`; adding `/generate` is a one-line change.
- `astro.config.mjs:18-23` declares env via `envField.string`; extend the schema with `OPENROUTER_API_KEY` (secret) and `OPENROUTER_MODEL` (public server) rather than reading `import.meta.env`.
- `wrangler.jsonc` has `observability.enabled = true` — errors surface via `wrangler tail` and the Cloudflare Observability MCP; we don't need to bolt on Sentry for this slice.
- The AI SDK's `useObject` hook plus `streamObject` on the server is the shortest path to "objects arrive one-by-one" — the array field grows as chunks land, and React re-renders per patch.

## What We're NOT Doing

- **No manual card creation (FR-008)** — that's roadmap S-03. This slice has one entry point: pasted text → AI.
- **No deck list on `/dashboard`** — S-03 owns FR-009 through FR-011 (browse, edit, delete). Dashboard stays as-is (sign-out only).
- **No spaced-repetition scheduling** — S-02 territory. `review_history` is unused in this slice; `cards.next_review_at` is not yet a concept.
- **No API cost cap enforcement per user** — PRD Open Q2, deferred until after MVP validation. We do enforce a per-request 10 000-char input cap, which bounds worst-case token spend but does not throttle a determined user across many requests.
- **No proposal persistence** — proposals live in browser state; reloading the tab discards unreviewed ones. Users must re-generate.
- **No password reset flow** — S-04 territory.
- **No non-text media in cards** — PRD Non-Goals: plain text Q/A only.
- **No accept-rate telemetry / analytics** — the PRD secondary metric ("75% of AI-generated cards accepted") is out of scope for this slice; we can add it later without schema changes because `cards.source='ai'` already labels the input.

## Implementation Approach

Three phases, each independently deployable and reversible.

**Phase 1 (backend)** introduces the AI dep surface and test infrastructure, and ships the streaming endpoint. We can verify the endpoint end-to-end via `curl` or the Vitest suite before any UI exists. This isolates the "does OpenRouter integration work on workerd" question from UI concerns.

**Phase 2 (frontend)** builds `/generate` and its React island: form + streaming consumer + reducer + proposal cards. Accept/Reject/Edit actions manipulate local state only — no writes yet. This lets us tune the streaming UX in isolation.

**Phase 3 (wiring)** adds `POST /api/cards`, wires per-card **Accept** and **Save (from edit)** buttons to it, and closes the wedge: proposals now enter the deck.

Each phase's Success Criteria has clear automated verification (typecheck, lint, unit tests, dry-deploy) and an explicit manual step. The manual step at the end of Phase 3 is the north-star waypoint that unblocks `/10x-implement` on S-02.

## Critical Implementation Details

- **Streaming from day one.** Per `context/foundation/infrastructure.md` Risk Register R1, the OpenRouter call must return a `ReadableStream` even if the client did not stream. `streamObject` from the `ai` package satisfies this and is the recommended surface.
- **`astro:env/server` for OpenRouter secrets.** Do not read `import.meta.env.OPENROUTER_API_KEY` — declare the field in `astro.config.mjs` (`env.schema`) and import from `astro:env/server`. Workers rehydrates secrets via `wrangler secret put OPENROUTER_API_KEY` in production; local dev reads `.dev.vars` (also copy to `.env` for parity per AGENTS.md).
- **`nodejs_compat` is required** and already set in `wrangler.jsonc:6`. The `ai` package uses `TextDecoder` / `ReadableStream`; both are native to workerd, but the compat flag prevents surprises on transitive deps.
- **RLS is the security boundary.** Do NOT filter by `user_id` in the WHERE clause of the insert — RLS policy `cards_insert_own` (with `check (auth.uid() = user_id)`) validates the row shape. Pass `user_id = user.id` in the insert body; the DB rejects mismatches. Explicitly do not use the service-role key from any handler.

## Phase 1: Streaming generation endpoint + AI service + test infra

### Overview

Add the AI dep surface (`ai`, `@openrouter/ai-sdk-provider`, `zod`), the test runner (`vitest`), declare OpenRouter env fields, and ship `POST /api/generate`: authenticated, Zod-validated, streaming a `{ proposals: [{ question, answer }] }` object via `streamObject`.

### Changes Required:

#### 1. Dependencies

**File**: `package.json`

**Intent**: Add the AI SDK, OpenRouter provider, Zod validator, and Vitest runner. Introduce an `npm test` script.

**Contract**: Runtime deps — `ai`, `@openrouter/ai-sdk-provider`, `zod`. Dev deps — `vitest`, `@vitejs/plugin-react` (only if a React reducer test needs JSX). Scripts — add `test: "vitest run"` and `test:watch: "vitest"`. Version-pin all three runtime deps to the minor to protect the workerd compatibility window (infra R6).

#### 2. Environment schema

**File**: `astro.config.mjs`

**Intent**: Extend `env.schema` with the two new server-side variables the generation endpoint needs.

**Contract**: `OPENROUTER_API_KEY` → `envField.string({ context: "server", access: "secret" })` (required). `OPENROUTER_MODEL` → `envField.string({ context: "server", access: "public", default: "google/gemini-2.5-flash" })`. Do not mark either optional; the endpoint should fail loudly at boot when misconfigured.

#### 3. Local secrets

**File**: `.dev.vars.example`, `.dev.vars`, `.env`

**Intent**: Document the new variable in the example file and hand-copy real values into the two dev-side files (per AGENTS.md, both must be kept in sync).

**Contract**: Add `OPENROUTER_API_KEY=your-key-here` and (optional) `OPENROUTER_MODEL=google/gemini-2.5-flash` entries to `.dev.vars.example`. The actual secret files stay gitignored.

#### 4. AI service (generation logic)

**File**: `src/lib/ai/generate-proposals.ts` (new)

**Intent**: Own the OpenRouter integration end-to-end — model client construction, Zod output schema, system prompt, and the `streamObject` invocation. Keep the endpoint thin; keep this file testable in isolation.

**Contract**:
- Export a `proposalsSchema` (Zod) shaped as `z.object({ proposals: z.array(z.object({ question: z.string().min(1), answer: z.string().min(1) })).min(1).max(15) })`. The `.max(15)` bounds worst-case fan-out on a 10k input.
- Export a `generateProposals({ text, apiKey, model }: { text: string; apiKey: string; model: string })` function that returns whatever `streamObject` returns (its `toTextStreamResponse()` / raw stream will be composed by the endpoint).
- The system prompt instructs the model: extract standalone Q/A pairs grounded strictly in the input; keep questions self-contained; answers ≤ 3 sentences; skip trivia not in the text; emit no more than 15 proposals.
- User prompt is the raw pasted `text`.

#### 5. Generation endpoint

**File**: `src/pages/api/generate.ts` (new)

**Intent**: The public server surface for AI generation. Auth-guarded, input-validated, returns the AI SDK's streaming response.

**Contract**:
- `export const prerender = false` (mandatory — see AGENTS.md hard rules).
- `POST` handler. Rejects other methods with a 405.
- Reads `context.locals.user`; returns 401 JSON `{ error: "unauthorized" }` when null (this endpoint returns JSON, not a redirect — it's a fetch target, not a form target).
- Parses request body as JSON. Validates against `z.object({ text: z.string().min(1).max(10_000) })`. On failure returns 400 JSON `{ error: "invalid input", issues: [...] }`.
- Reads `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` from `astro:env/server`.
- Calls `generateProposals(...)` and returns `result.toTextStreamResponse()` (the AI SDK helper that produces the JSON-lines stream `useObject` consumes).

#### 6. Vitest configuration

**File**: `vitest.config.ts` (new), `tsconfig.json` (adjust `include` if needed)

**Intent**: Wire Vitest for TypeScript ESM tests co-located with source (`*.test.ts`) or under `test/`. Match the ESLint + Prettier ignores.

**Contract**: Node environment for the endpoint tests. `resolve.alias['@']` → `./src` to match `tsconfig` path alias. Register `astro:env/server` as a manual mock (see next entry) so tests don't need a real Astro runtime.

#### 7. Endpoint test

**File**: `src/pages/api/generate.test.ts` (new)

**Intent**: Lock the endpoint contract: auth guard, method guard, input validation, and successful stream shape.

**Contract**: Four scenarios — (a) missing user → 401; (b) `PUT` → 405; (c) `text` empty or >10 000 → 400 with `issues`; (d) valid input → 200 with `content-type: text/event-stream` or the AI SDK's actual header + a stubbed AI provider that yields two proposals. Mock the AI SDK's provider factory (not the whole `ai` module) to avoid real HTTP calls.

### Success Criteria:

#### Automated Verification:

- Deps install cleanly: `npm ci`
- Type checking passes: `npm run astro sync && npx tsc --noEmit`
- Linting passes: `npm run lint`
- Unit tests pass: `npm test`
- Dry-deploy passes bundle budget: `npm run deploy:dry`

#### Manual Verification:

- `wrangler dev` boots without missing-env errors.
- `curl -X POST http://localhost:8788/api/generate -d '{}'` returns 401 (no cookie); with a real signed-in cookie + `{"text": "..."}` returns a streaming JSON body that contains at least one Q/A object.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the endpoint responds correctly before proceeding to the UI phase.

---

## Phase 2: `/generate` page + streaming proposals UI + reducer

### Overview

Add the `/generate` protected route, the React island that consumes the stream, and the proposal-review UI. All actions in this phase are local-only (state manipulation) — Accept/Edit/Reject do not yet hit the DB. This isolates the streaming and interaction UX from the persistence path.

### Changes Required:

#### 1. Middleware protection

**File**: `src/middleware.ts`

**Intent**: Add `/generate` to `PROTECTED_ROUTES` so the middleware redirects unauthenticated users to sign-in.

**Contract**: Extend the string-literal array at `src/middleware.ts:4` to `["/dashboard", "/generate"]`. No new logic — the existing `context.locals.user` check handles the rest.

#### 2. Astro page shell

**File**: `src/pages/generate.astro` (new)

**Intent**: Server-render the page frame + title + auth-derived greeting; mount the React island with `client:load`. Match the layout convention of `src/pages/dashboard.astro`.

**Contract**: Uses the shared `Layout` component. Reads `Astro.locals.user` for greeting text. Renders `<GeneratePanel client:load />` with no server props (the island fetches on demand).

#### 3. shadcn primitives we're missing

**File**: `src/components/ui/textarea.tsx` (new), `src/components/ui/card.tsx` (new)

**Intent**: Add the two shadcn primitives this UI needs. Match the CVA + `cn()` style already used by `src/components/ui/button.tsx`.

**Contract**: Standard shadcn `Textarea` (`<textarea>` with Tailwind + focus ring) and `Card` (root + `CardHeader` / `CardContent` / `CardFooter`) — nothing bespoke. If a future shadcn CLI is wired later, these are drop-in replacements.

#### 4. Proposal state reducer

**File**: `src/components/generate/proposalsReducer.ts` (new)

**Intent**: Model the finite states of a proposal-review session so the UI can be pure. This is the load-bearing piece of the phase and is unit-tested.

**Contract**:
- Stream states: `idle | streaming | done | aborted`.
- Per-proposal states: `pending | editing | rejected` (Accepted state and saving state are added in Phase 3 — this phase's reducer stops at `pending` / `editing` / `rejected`, matching the "no writes yet" scope).
- Actions: `stream/start`, `stream/chunk({ proposals })`, `stream/done`, `stream/abort({ reason })`, `reject(id)`, `editStart(id)`, `editChange(id, patch)`, `editSave(id)` (returns to `pending` post-save-in-Phase-3), `editCancel(id)`, `reset()`.
- IDs are assigned client-side (`crypto.randomUUID()`) as chunks arrive, not by the server — the stream may replay partial arrays; the reducer keys new items by array position and stabilizes IDs on first sighting.

#### 5. Streaming hook

**File**: `src/components/hooks/useProposalStream.ts` (new)

**Intent**: Wrap `useObject` from `ai/react` (or an equivalent fetch-based consumer if the SDK's React helper is workerd-incompatible in the browser) into a project-specific hook that dispatches into the reducer.

**Contract**: `useProposalStream(dispatch)` returns `{ start(text: string), abort() }`. Under the hood, calls `POST /api/generate`, subscribes to the JSON-lines stream, dispatches `stream/chunk` on every array-length increase, `stream/done` on completion, `stream/abort` on error or user cancel.

#### 6. The island

**File**: `src/components/generate/GeneratePanel.tsx` (new)

**Intent**: Compose the reducer, the stream hook, and the child components into the top-level React island.

**Contract**: Renders `<GenerateForm>` at top, `<StreamBanner>` (retry/abort UI) below, and a `<ProposalsList>` grid. Delegates all interaction to child components via typed callbacks. Owns the reducer state via `useReducer`.

#### 7. Form

**File**: `src/components/generate/GenerateForm.tsx` (new)

**Intent**: Paste-box + char counter + submit; enforces the 10 000-char cap client-side (server also enforces).

**Contract**: Controlled `<Textarea>` with `maxLength={10_000}`. Displays `{value.length} / 10 000`. Submit button disabled when `value.length === 0` or `state !== 'idle' && state !== 'done' && state !== 'aborted'`. Calls the `onSubmit(text)` prop.

#### 8. Proposals list

**File**: `src/components/generate/ProposalsList.tsx` (new)

**Intent**: Iterate proposals, render one `<ProposalCard>` each. Show a subtle "still generating…" indicator while `state === 'streaming'`.

**Contract**: Pure presentational. Takes `proposals`, `streamState`, and per-card action callbacks (`onAccept(id)`, `onReject(id)`, `onEditStart(id)`, `onEditChange(id, patch)`, `onEditSave(id)`, `onEditCancel(id)`). In this phase, `onAccept` is a no-op stub; wired for real in Phase 3.

#### 9. Proposal card

**File**: `src/components/generate/ProposalCard.tsx` (new)

**Intent**: Render one proposal in view or edit mode; expose Accept, Reject, Edit / Save, Cancel.

**Contract**:
- View mode: `Card` with question (heading) + answer (body) + three buttons: **Accept**, **Edit**, **Reject**.
- Edit mode: two `Textarea`s for question/answer (question 2 rows, answer 4), buttons **Save** and **Cancel**. Save is disabled when either field is empty.
- Rejected proposals unmount from the list (list filters them out).

#### 10. Stream banner

**File**: `src/components/generate/StreamBanner.tsx` (new)

**Intent**: When `state === 'aborted'`, show a red banner: "Generation interrupted — some proposals may be missing. Retry?" with a **Retry** button that re-submits the last-known input.

**Contract**: No-op when `state !== 'aborted'`. Consumes `retry()` callback from parent (re-invokes `start(text)` with the last submitted text).

#### 11. Reducer tests

**File**: `src/components/generate/proposalsReducer.test.ts` (new)

**Intent**: Lock reducer transitions.

**Contract**: Cases — initial state; `stream/start` → `streaming` with empty proposals; `stream/chunk` inserts new proposals and stabilizes IDs on subsequent chunks; `stream/done` sets `done` while preserving proposals; `stream/abort` retains proposals and sets `aborted`; `reject(id)` filters the proposal out; `editStart` → `editing`; `editChange` mutates only the target proposal's staged edit; `editSave` returns proposal to `pending` with new question/answer; `editCancel` returns proposal to `pending` with original question/answer; `reset()` returns to `idle` with empty proposals.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Reducer tests pass: `npm test`
- Dry-deploy passes bundle budget: `npm run deploy:dry`

#### Manual Verification:

- `wrangler dev`, sign in, navigate to `/generate`.
- Paste ~2 pages of source text, click **Generate**; proposals appear one-by-one within 30s.
- Reject one proposal; it disappears from the list.
- Edit one proposal (change wording), Save; the card returns to view mode with the new text.
- Kill the OpenRouter key temporarily (`wrangler secret delete OPENROUTER_API_KEY`) and retry — banner appears with retry button; restoring the key + retry recovers.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the streaming UX and edit/reject flows work as expected before proceeding to the persistence phase.

---

## Phase 3: `/api/cards` insert endpoint + wire per-card accept

### Overview

Close the loop: add `POST /api/cards` (auth-guarded, RLS-enforced, `source='ai'`) and wire the **Accept** button (view mode) and **Save** button (from edit mode) to persist the proposal to the deck. Optimistic UI: pending → checkmark on success, retry chip on failure.

### Changes Required:

#### 1. Cards insert endpoint

**File**: `src/pages/api/cards.ts` (new)

**Intent**: Persist a single accepted proposal to the `cards` table with `source='ai'` and the caller's `user_id`.

**Contract**:
- `export const prerender = false`.
- `POST` handler; other methods → 405.
- Auth: reads `context.locals.user`; 401 JSON when null.
- Body: `z.object({ question: z.string().min(1), answer: z.string().min(1), source: z.enum(['ai', 'manual']).default('ai') })`. `source` is present so the manual-create endpoint in S-03 can reuse this handler; for S-01 the client always sends `'ai'`.
- Insert via `supabase.from('cards').insert({ user_id: user.id, question, answer, source }).select().single()`.
- Success → 201 JSON `{ card: <Row> }`. Supabase error → 500 JSON with a sanitized message (do not leak PG errors verbatim).

#### 2. Client-side cards service

**File**: `src/lib/api/cards.ts` (new)

**Intent**: Typed fetch wrapper for the endpoint, so components don't hand-write fetch calls.

**Contract**: Exports `createCard({ question, answer }): Promise<CardRow>`. Uses `credentials: 'include'` to send cookies. Throws a typed error on non-2xx that carries the endpoint's `{ error }` message for the UI to display.

#### 3. Reducer additions

**File**: `src/components/generate/proposalsReducer.ts` (modify)

**Intent**: Add the save lifecycle. A proposal now has `pending | editing | rejected | saving | saved | error` states.

**Contract**: New actions — `saveStart(id)`, `saveSuccess(id, savedCardId)`, `saveError(id, message)`. `saveStart` locks the buttons; `saveSuccess` transitions to `saved`; `saveError` transitions to `error` with the message and allows retry. `saveSuccess` also stores the DB row id so the UI can distinguish saved cards from proposals.

#### 4. Panel wiring

**File**: `src/components/generate/GeneratePanel.tsx` (modify)

**Intent**: Wire the `onAccept` and `onEditSave` callbacks through the cards service.

**Contract**: Both callbacks dispatch `saveStart`, call `createCard(...)`, and dispatch `saveSuccess` or `saveError` on the result. Editing from view-mode Accept sends the current (unedited) question/answer; from edit-mode Save it sends the staged edit.

#### 5. Proposal card visuals for save states

**File**: `src/components/generate/ProposalCard.tsx` (modify)

**Intent**: Reflect `saving | saved | error` states in the UI.

**Contract**:
- `saving`: buttons disabled, spinner on the primary button.
- `saved`: buttons hidden, small green check + "Added to deck" caption; card body remains visible (locked).
- `error`: red banner inside the card with the message + a **Retry** button that re-issues the save.

#### 6. Endpoint test

**File**: `src/pages/api/cards.test.ts` (new)

**Intent**: Lock the endpoint contract.

**Contract**: Three scenarios — (a) missing user → 401; (b) empty `question` or `answer` → 400; (c) valid input → 201 with a mocked Supabase client that returns the inserted row. RLS enforcement itself is validated by the F-01 pgTAP suite; this test verifies the endpoint doesn't bypass auth.

#### 7. Reducer save-lifecycle tests

**File**: `src/components/generate/proposalsReducer.test.ts` (modify)

**Intent**: Cover the new actions.

**Contract**: Cases — `saveStart` → `saving`; `saveSuccess` → `saved` with the DB card id captured; `saveError` → `error` with the message; second `saveStart` after `error` clears the message and re-enters `saving` (retry path).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- All tests pass: `npm test`
- Dry-deploy passes bundle budget: `npm run deploy:dry`

#### Manual Verification:

- Full flow at `wrangler dev`: sign in, `/generate`, paste text, click Generate, wait for stream, click **Accept** on one proposal → spinner → checkmark. Query Supabase (`select * from cards where user_id = <me>`) and confirm the row has `source='ai'` and matches the accepted proposal.
- Edit one proposal, click **Save** → saved row reflects the edited text.
- Sign out, try `POST /api/cards` via curl → 401.
- Sign in as user B, try to read user A's cards via Supabase JS in the browser console → RLS blocks (0 rows).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the end-to-end flow (paste → generate → accept → deck) works before closing the slice.

---

## Testing Strategy

### Unit Tests:

- `proposalsReducer.test.ts` — every transition; the reducer is pure and easy to exhaustively cover.
- `generate.test.ts` — endpoint contract: auth, method, input validation, stream shape (mocked provider).
- `cards.test.ts` — endpoint contract: auth, validation, insert path (mocked Supabase client).

### Integration Tests:

Deferred. The pgTAP RLS suite from F-01 (`supabase/tests/rls_cards_isolation.test.sql`) already covers cross-user isolation at the DB layer; a Node-level integration test that boots the endpoint against a real Supabase would be premature for this slice.

### Manual Testing Steps:

1. Sign in, navigate to `/generate` — form renders, char counter at 0.
2. Paste 200 chars, submit — first proposal arrives within a few seconds; the rest stream in.
3. Reject one, edit one (change wording), leave others untouched.
4. Accept 2 proposals — spinners resolve to checkmarks.
5. Save the edited one — checkmark appears with the edited text.
6. Refresh `/generate` — unsaved proposals are gone (expected); accepted ones are in the DB.
7. Query `select question, answer, source from cards where user_id = auth.uid()` in Supabase Studio — accepted + edited rows are present with `source='ai'`.
8. Trigger a stream abort by killing the network mid-generation — banner appears, retry restores flow.
9. Sign out, hit `/generate` — middleware redirects to sign-in.

## Performance Considerations

- **30s p95 NFR** is met by streaming; even a 20-25s total generation feels responsive because proposals paint incrementally.
- **10 000-char cap** bounds worst-case cost at roughly 3k input tokens + 1.5k output tokens per request on Gemini 2.5 Flash — well under $0.001 per generation at listed prices.
- **Bundle budget** (Cloudflare 10 MB compressed, infra R5): `ai` + `@openrouter/ai-sdk-provider` add ~300 KB minified; well within budget. `deploy:dry` is a Success Criteria gate on every phase.
- **Streaming keeps CPU-time billing cheap on Workers** — the handler idles on I/O while OpenRouter streams; only the pass-through pipe consumes CPU.

## Migration Notes

- No DB schema changes. F-01's `cards` and `review_history` are sufficient.
- `.dev.vars.example` gains one new required key (`OPENROUTER_API_KEY`); anyone pulling the branch must add it to their `.dev.vars` and `.env`.
- Rollback: `wrangler rollback` reverts the deploy; no data migration to undo. Cards inserted during the slice's lifetime remain in the DB (they're user-owned and valid regardless of code version).

## References

- Change identity: `context/changes/first-ai-generation-and-accept/change.md`
- Roadmap slice: `context/foundation/roadmap.md#s-01-pierwsza-generacja-ai-akceptacja-fiszek`
- PRD user story: `context/foundation/prd.md#us-01-generating-the-first-deck-from-pasted-text`
- Infra risk register (streaming, bundle, secrets): `context/foundation/infrastructure.md#risk-register`
- F-01 archive (schema, RLS, types): `context/archive/2026-07-07-data-schema-and-rls/`
- Existing endpoint pattern to mirror: `src/pages/api/auth/signin.ts`
- Existing React-island pattern: `src/pages/auth/signin.astro` + `src/components/auth/SignInForm.tsx`
- Middleware protection convention: `src/middleware.ts:4`
- Env schema convention: `astro.config.mjs:18-23`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Streaming generation endpoint + AI service + test infra

#### Automated

- [x] 1.1 Deps install cleanly: `npm ci` — b9c4f53
- [x] 1.2 Type checking passes: `npm run astro sync && npx tsc --noEmit` — b9c4f53
- [x] 1.3 Linting passes: `npm run lint` — b9c4f53
- [x] 1.4 Unit tests pass: `npm test` — b9c4f53
- [x] 1.5 Dry-deploy passes bundle budget: `npm run deploy:dry` — b9c4f53

#### Manual

- [x] 1.6 `wrangler dev` boots without missing-env errors — b9c4f53
- [x] 1.7 `POST /api/generate` returns 401 without cookie; returns streaming Q/A body with a valid cookie + 10k-char text — b9c4f53

### Phase 2: `/generate` page + streaming proposals UI + reducer

#### Automated

- [x] 2.1 Type checking passes: `npx tsc --noEmit` — 0df9320
- [x] 2.2 Linting passes: `npm run lint` — 0df9320
- [x] 2.3 Reducer tests pass: `npm test` — 0df9320
- [x] 2.4 Dry-deploy passes bundle budget: `npm run deploy:dry` — 0df9320

#### Manual

- [x] 2.5 Signed-in user sees `/generate`; unauthenticated user is redirected — 0df9320
- [x] 2.6 Paste + Generate: proposals stream in one-by-one within 30s — 0df9320
- [x] 2.7 Reject removes a proposal from the list — 0df9320
- [x] 2.8 Edit-then-Save updates the card body in view mode — 0df9320
- [x] 2.9 Simulated stream abort surfaces the retry banner and recovers on retry — 0df9320

### Phase 3: `/api/cards` insert endpoint + wire per-card accept

#### Automated

- [x] 3.1 Type checking passes: `npx tsc --noEmit` — 64db736
- [x] 3.2 Linting passes: `npm run lint` — 64db736
- [x] 3.3 All tests pass: `npm test` — 64db736
- [x] 3.4 Dry-deploy passes bundle budget: `npm run deploy:dry` — 64db736

#### Manual

- [x] 3.5 Accept persists the card; row lands in `cards` with `source='ai'` and correct `user_id` — 64db736
- [x] 3.6 Save (from edit mode) persists the edited text, not the original — 64db736
- [x] 3.7 `POST /api/cards` without cookie returns 401 — 64db736
- [x] 3.8 Cross-user read is blocked by RLS (0 rows for user B when reading user A's data) — 64db736
- [x] 3.9 End-to-end: paste → generate → accept 2 → cards visible in Supabase Studio — 64db736
