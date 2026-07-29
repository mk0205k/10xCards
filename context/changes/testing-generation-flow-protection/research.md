---
date: 2026-07-29T00:00:00+02:00
researcher: mk
git_commit: 3f2eb7ac62ea498481851a93fd2fa8aa2a318eeb
branch: master
repository: mk0205k/10xCards
topic: "Testing rollout Phase 1 — Generation-flow protection (endpoint + UI)"
tags: [research, testing, generation, openrouter, react, accept-reject-edit, phase-1]
status: complete
last_updated: 2026-07-29
last_updated_by: mk
---

# Research: Testing rollout Phase 1 — Generation-flow protection

**Date**: 2026-07-29
**Researcher**: mk
**Git Commit**: 3f2eb7ac62ea498481851a93fd2fa8aa2a318eeb
**Branch**: master
**Repository**: mk0205k/10xCards

## Research Question

Ground the oracle and codebase surface for the first rollout phase of the test plan (`context/foundation/test-plan.md` §3 Phase 1): protect Risks **#1** (silent AI-generation drift from OpenRouter) and **#2** (accept / reject / edit UI contract). Deliver enough evidence for `/10x-plan` to write ordered phases, decide which oracle is asserted where, and pick the cheapest test layer per risk.

## Summary

The generation surface splits at two wires: (a) **OpenRouter ↔ endpoint**, where Vercel AI SDK's `streamText` + `Output.object` handles OpenAI-compatible SSE, and (b) **endpoint ↔ client**, where `toTextStream` emits a plain-text growing-JSON payload that `useProposalStream.ts` decodes via `parsePartialJson` — the client never sees raw OpenRouter SSE. Both boundaries need protection, but the mocking targets differ (provider factory at (a); `fetch` response body at (b)).

**Two faces of Risk #1.** Face-A is upstream drift (OpenRouter changes response shape/model). Face-B is *silent truncation* on the endpoint→client wire: if the response body ends mid-JSON, `parsePartialJson` still returns the leading complete pairs and the hook dispatches `stream/done`. The user sees N-1 cards instead of N with **zero UI signal** — exactly the scenario the risk names ("cards that look weird"). No `GENERATION_*` error code exists in `src/lib/error-messages.ts` yet, and the endpoint does not try/catch `generateProposals()` — a provider exception surfaces as an Astro 500 HTML page, not a JSON error the client can render.

**Two faces of Risk #2.** Face-A is the pure state machine (`proposalsReducer.ts`) — already covered by 223 lines of unit tests. Face-B is the component wiring (button → dispatch → render → `POST /api/cards`) — **zero coverage today**; `vitest.config.ts` still runs `environment: "node"` and `@testing-library/react`/`happy-dom` are not installed. The reducer test proves state transitions in isolation; it does not prove that clicking Accept persists the correct payload, that rejected proposals are truly hidden from the persisted list, that edits carry through to the POST body, or that S-06 bulk actions dispatch what they claim.

**What Phase 1 must land as infrastructure.** Vitest 4 `projects` split (node-env for `src/pages/api/**/*.test.ts`, happy-dom-env for `src/components/**/*.test.tsx`), install `@testing-library/react@^16` + `@testing-library/dom` + `happy-dom` (three packages, React 19-compatible), and a wire-level fixture layer for the `/api/generate` response (JSON-lines body, not SSE). This is the stack bump `test-plan.md §4` calls out.

## Detailed Findings

### Risk #1 — Silent AI-generation drift

#### Oracle sources (what the endpoint MUST do)

- **`context/foundation/prd.md`** — FR-005 (user pastes text and requests generation), FR-006 (user sees list of `{question, answer}` proposals *before* they enter the deck), NFR "Response time" (p95 < 30s), NFR "Privacy of user content".
- **`context/foundation/infrastructure.md` §Risk Register row R1** (pre-mortem, M×H): *"OpenRouter switches to streaming-first responses; non-streaming handler returns truncated cards. Mitigation: Build the OpenRouter call as a `ReadableStream` from day one even if the UI consumes the full body; rerun an end-to-end card-generation test on every OpenRouter SDK bump."*
- **Contract summary (assembled from sources — not from code):** endpoint must (i) accept text within the announced bounds, (ii) either return a stream that resolves to at least one valid `{question, answer}` pair, or (iii) fail cleanly with a UI-renderable error code and never silently return "cards that look weird".

#### Wire architecture (two boundaries, both testable)

**Boundary A — OpenRouter → endpoint.** OpenAI-compatible chat completions API; when `stream: true`, response is SSE with `data: <chunk-json>\n\n` lines and terminal `data: [DONE]` sentinel. Usage is emitted exactly once in a final chunk whose `choices` array is empty — non-obvious contract detail consumers must handle (source: OpenRouter docs, checked 2026-07-29 — see §OpenRouter contract below).

**Boundary B — endpoint → client.** `createTextStreamResponse({ stream: toTextStream({ stream: result.stream }) })` produces a plain-text response whose body is a **progressively-growing JSON payload** (the structured `Output.object` schema serialised as it fills). Client reads via `TextDecoderStream` → accumulates `buffer` → calls `parsePartialJson(buffer)` after each chunk → extracts complete `{question, answer}` items.

The client contract with the endpoint is therefore *not* SSE — this matters for fixture design: a wire-level fixture for `/api/generate` is a `ReadableStream` of JSON text fragments, not `data: …` SSE lines.

#### Live-code map

| Concern | File | Anchor | Fact |
|---|---|---|---|
| Endpoint (POST, streaming) | [`src/pages/api/generate.ts`](https://github.com/mk0205k/10xCards/blob/3f2eb7a/src/pages/api/generate.ts) | L7, L9-11, L20-46 | `prerender=false` ✓; Zod input `text: 1..10_000`; auth 401 → JSON parse 400 → schema 400 → **no try/catch around `generateProposals()`** → `createTextStreamResponse(toTextStream(result.stream))`; `ALL` returns 405. |
| OpenRouter wrapper | [`src/lib/ai/generate-proposals.ts`](https://github.com/mk0205k/10xCards/blob/3f2eb7a/src/lib/ai/generate-proposals.ts) | L1-2, L5-15, L17-25, L33-42 | Uses `streamText` + `Output.object({ schema: proposalsSchema })` from `ai`; provider `@openrouter/ai-sdk-provider`; system prompt hard-coded; **no temperature / max_tokens set** (SDK/provider defaults); Zod schema caps output `proposals.min(1).max(15)`. |
| API-key + model env | [`astro.config.mjs`](https://github.com/mk0205k/10xCards/blob/3f2eb7a/astro.config.mjs) + `astro:env/server` | env schema | `OPENROUTER_API_KEY` (secret), `OPENROUTER_MODEL` (default `google/gemini-2.5-flash`). |
| Client parsing hook | [`src/components/hooks/useProposalStream.ts`](https://github.com/mk0205k/10xCards/blob/3f2eb7a/src/components/hooks/useProposalStream.ts) | L11-29, L47-95 | `extractCompleteProposals` iterates items, `break`s on first incomplete pair; `for(;;)` loop reads decoder chunks + calls `parsePartialJson`; on `!response.ok` dispatches `stream/abort` with `"Generation failed (${status})"`; on network/abort → `stream/abort` with free-form message. |
| Error-code registry | [`src/lib/error-messages.ts`](https://github.com/mk0205k/10xCards/blob/3f2eb7a/src/lib/error-messages.ts) | L3-15, L19-31 | Registered codes: `UNKNOWN, SUPABASE_NOT_CONFIGURED, INVALID_CREDENTIALS, PASSWORD_TOO_WEAK, PASSWORD_SAME_AS_OLD, RESET_SESSION_EXPIRED, RESET_TOO_MANY_ATTEMPTS, ACCOUNT_DELETE_FAILED, ACCOUNT_RESTORE_FAILED, ACCOUNT_PENDING_DELETION, EMAIL_REQUIRED`. **No `GENERATION_*` codes.** Unknown → `m.error_unknown()` fallback. |
| Reducer error field | [`src/components/generate/proposalsReducer.ts`](https://github.com/mk0205k/10xCards/blob/3f2eb7a/src/components/generate/proposalsReducer.ts) | L20-25, L94-95 | `ProposalsState.errorMessage: string \| null`; `stream/abort` writes `errorMessage` = free-form `reason`. |
| Existing endpoint test | [`src/pages/api/generate.test.ts`](https://github.com/mk0205k/10xCards/blob/3f2eb7a/src/pages/api/generate.test.ts) | L55-116 (6 cases) | Mocks `@/lib/ai/generate-proposals` at module level via `vi.hoisted`; stub returns a canned `ReadableStream`. Bypasses OpenRouter provider entirely; **cannot detect drift** because it never exercises the wire. |
| Test config | [`vitest.config.ts`](https://github.com/mk0205k/10xCards/blob/3f2eb7a/vitest.config.ts) | L11-12 | `environment: "node"`, `include: ["src/**/*.test.{ts,tsx}"]`; no `setupFiles`, no `projects`. |

#### Silent-loss gap (the core discovery)

`useProposalStream.ts` treats *any* clean termination of `response.body` as a legitimate end-of-stream: the loop breaks on `done: true`, one last `parsePartialJson(buffer)` runs, and `stream/done` is dispatched. Nothing compares "cards received" against a promised count (OpenRouter has no such contract for structured output), and nothing detects a buffer that ends mid-JSON — `parsePartialJson` gracefully returns whatever prefix is well-formed. So a stream cut after the second of five proposals looks identical to a stream that legitimately produced two proposals. **This is the failure mode the risk names.**

Two design choices could close it, but they belong in Phase 1's *plan*, not this research: (i) let the AI SDK's `.finishReason` / `.totalUsage` surface reach the endpoint response as a footer marker; (ii) require an "envelope closes cleanly" contract (final `}]}` sentinel) and dispatch a distinct `GENERATION_TRUNCATED` code when absent. Naming the fix now is out of scope — research surfaces the gap; the plan resolves it.

#### Two faces of Risk #1 (for the plan to sequence)

- **Face-A — upstream drift.** OpenRouter changes envelope shape, chunk cadence, or model output structure. Testable by fixturing the provider (mock the `createOpenRouter().chat()` return value) or by intercepting `fetch` at the OpenRouter URL. Signal: does the endpoint's own error path fire when the provider emits malformed / partial content?
- **Face-B — endpoint→client silent loss.** Endpoint response body is cut mid-payload (client-side network drop, Worker CPU cutoff, provider 5xx after partial body). Testable by fixturing `fetch("/api/generate")` at the browser level with a `ReadableStream` that emits a valid prefix and then errors or closes early. Signal: does the reducer end up in `aborted` with a code, or in `done` with a partial list?

#### What existing tests cover (baseline)

- `src/pages/api/generate.test.ts` — 6 tests: 401 unauth, 405 wrong method, 400 empty text, 400 text >10 000, 400 invalid JSON, 200 with stubbed stream. All mock `generateProposals` at SDK level; none exercise wire bytes or specific proposal shapes.
- No client-side hook test for `useProposalStream.ts`.

### Risk #2 — Accept / reject / edit UI contract

#### Oracle sources (what the UI MUST do)

- **`context/foundation/prd.md`** — FR-005 through FR-007 (paste → generate → accept/reject/edit each proposal individually; accepted cards land in deck), Success Criteria step 5.
- **`context/foundation/roadmap.md` §Vision recap** — "Klinem produktu jest to, że fiszki muszą być jednocześnie ugruntowane w tekście użytkownika (AI z inputu) i przepuszczone przez decyzję człowieka (accept/reject/edit) zanim wejdą do talii" — the human-decision layer *is* the product.
- **`context/archive/2026-07-23-ux-improvements/plan.md`** (S-06) — bulk accept: iterate pending proposals, concurrency cap 4, `Promise.allSettled` per chunk, **re-uses single-card `POST /api/cards`**; bulk reject: one new reducer action `bulkRejectPending`, gated by confirmation dialog; no backend batch endpoint.
- **`context/archive/2026-07-07-first-ai-generation-and-accept/plan.md`** (S-01) — proposal states: `pending | editing | rejected | saving | saved | error`; client-side UUIDs assigned on chunk arrival; stream may replay partial arrays → reducer stabilises IDs by array position.
- **Contract summary** (assembled from sources): a component-level test must prove
  (a) accepted proposals persist with correct payload,
  (b) rejected proposals never appear in the persisted payload,
  (c) edited proposals carry the *edited* content, not the original,
  (d) the visible list reflects the state change (buttons disabled, spinner during save, ✓ mark on success, error alert on failure).

#### Component tree + reducer (live-code map)

| Concern | File | Anchor | Fact |
|---|---|---|---|
| Astro page + island | [`src/pages/generate.astro`](https://github.com/mk0205k/10xCards/blob/3f2eb7a/src/pages/generate.astro) | L20 | `<GeneratePanel client:load />` (no props threaded from Astro — `user.email` used only in welcome header). |
| Root component (state owner) | [`src/components/generate/GeneratePanel.tsx`](https://github.com/mk0205k/10xCards/blob/3f2eb7a/src/components/generate/GeneratePanel.tsx) | L24-158 | `useReducer(proposalsReducer)` + 2× `useState` (`bulkRejectOpen`, `bulkAcceptInProgress`); 10 `useCallback` handlers wire dispatch + POST. |
| Input form | `src/components/generate/GenerateForm.tsx` | L15, L34, L41-43 | Textarea with `maxLength={MAX_CHARS=10_000}` + counter; receives `streamState`, `onSubmit`, `onAbort`. |
| Proposals list | `src/components/generate/ProposalsList.tsx` | L27 | Filters `status === "rejected"` from visible; renders `<ProposalCard>` per proposal. |
| Single card | `src/components/generate/ProposalCard.tsx` | L29-80 (edit mode), L101-110 (accept), L115-118 (edit start), L133-150 (error alert), L140-143 (retry) | Two `<Textarea>` (question, answer) during edit; buttons for accept, reject, edit-start, edit-save, edit-cancel; retry button on error state. |
| Stream banner | `src/components/generate/StreamBanner.tsx` | — | Shown only when `streamState === "aborted"`; displays `errorMessage`. |
| Bulk-reject dialog | `src/components/generate/BulkRejectConfirmDialog.tsx` | L20-44 | shadcn AlertDialog; shows pending count; requires confirm. |
| Reducer + actions | [`src/components/generate/proposalsReducer.ts`](https://github.com/mk0205k/10xCards/blob/3f2eb7a/src/components/generate/proposalsReducer.ts) | L34-48, L77-160 | 14 action types incl. `bulkRejectPending`; pure factory `makeReducer(idFactory)` + prod `proposalsReducer = makeReducer(crypto.randomUUID)`. |
| Reducer test | `src/components/generate/proposalsReducer.test.ts` | L1-223, 13 cases | Deterministic `makeReducer` with counter; covers every action, id stability across chunks, editing-preserves-edits across replayed chunks, error clearing on retry. **Zero component wiring.** |

#### Accept-path chain (verbatim)

1. `ProposalCard.tsx:103` — `<Button onClick={() => onAccept(proposal.id)}>` (disabled when `isSaving`).
2. `GeneratePanel.tsx:53-60` — `onAccept(id)` → `findProposal(state, id)` → `void persist(id, proposal.question, proposal.answer)`.
3. `GeneratePanel.tsx:42-51` — `persist()` dispatches `saveStart` → `await createCard({ question, answer, source: "ai" })` → dispatches `saveSuccess` (with `savedCardId`) or `saveError` (with message).
4. [`src/lib/api/cards.ts`](https://github.com/mk0205k/10xCards/blob/3f2eb7a/src/lib/api/cards.ts) L42 — typed `fetch("/api/cards", { method: "POST", body: JSON.stringify({ question, answer, source }) })`.
5. [`src/pages/api/cards.ts`](https://github.com/mk0205k/10xCards/blob/3f2eb7a/src/pages/api/cards.ts) L6, L8-14, L52-98 — `prerender=false`; Zod `{ question:min(1), answer:min(1), source:enum["ai","manual"].default("ai") }`; response `{ card: CardRow }`.

**Failure semantics** — no automatic rollback; the proposal sits in `status: "error"` with the message; the user re-clicks Accept (`ProposalCard.tsx:140-143`) which re-enters `persist()`.

#### Edit-then-accept chain

1. `ProposalCard.tsx:115` — click "Edit" → `onEditStart(id)` → dispatch `editStart` → `status: "editing"`, `draft: { question, answer }` mirror created (`proposalsReducer.ts:101-107`).
2. Textareas at `ProposalCard.tsx:37-57` fire `onEditChange(id, patch)` per keystroke → dispatch `editChange` → merges `patch` into `proposal.draft` (`proposalsReducer.ts:108-113`).
3. Click "Save" → `GeneratePanel.tsx:62-71` — dispatches `editSave` which copies `draft` to `question/answer` and clears `draft` (`proposalsReducer.ts:115-122`); **then in the same handler** calls `persist(id, editedQuestion, editedAnswer)` using values captured *before* dispatch (line 68 in the archive plan snippet), or reads back from state — this is the subtle line the plan must call out as an oracle-anchoring test target.

#### Bulk-actions chain (S-06)

- **Bulk-accept** — `GeneratePanel.tsx:86-96`; loops `pending` proposals with `BULK_ACCEPT_CONCURRENCY = 4`; calls `persist()` per card; local state `bulkAcceptInProgress` gates the button; **no reducer action** — the existing per-card `saveStart / saveSuccess / saveError` dispatches carry the flow.
- **Bulk-reject** — `GeneratePanel.tsx:98-104`; opens `BulkRejectConfirmDialog`; on confirm dispatches single action `{ type: "bulkRejectPending" }` which flips all `status === "pending"` to `"rejected"` (`proposalsReducer.ts:152-156`).

#### Two faces of Risk #2 (for the plan to sequence)

- **Face-A — reducer contract.** Already covered by 223 lines of unit tests. No new tests needed unless the reducer changes.
- **Face-B — component wiring.** Buttons → dispatch → render → POST. Zero coverage. Testable with `@testing-library/react` + `happy-dom`; wire-level fixture for `POST /api/cards` (e.g. stub `global.fetch` or route via MSW). This is where Phase 1's four sub-assertions land (a/b/c/d above).

## Testing stack ground-truth

### Current state (verbatim from `package.json` + `vitest.config.ts`)

- Runner: `vitest@^4.1.10`; transitive `vite@^7.3.2`.
- Config: single `defineConfig` with `test.environment: "node"`, `test.include: ["src/**/*.test.{ts,tsx}"]`, `resolve.alias: { "@": ./src }`. No `setupFiles`, no `projects`, no `environmentMatchGlobs`.
- Scripts: `"test": "vitest run"`, `"test:watch": "vitest"`; no `test:ui`, no coverage.
- **Not installed:** `@testing-library/react`, `@testing-library/dom`, `happy-dom`, `jsdom`, `msw`, `@vitest/coverage-*`, `@vitest/ui`.
- All 9 existing test files import from `"vitest"` explicitly (globals off). All are `.test.ts`; the `.tsx` glob is currently unused.

### What Phase 1 needs (grounded from Context7, `checked: 2026-07-29`)

- **Add packages:** `@testing-library/react@^16` (React 18 & 19), `@testing-library/dom` (peer dep — required to install explicitly in v16), `happy-dom` (latest 19.x). No adapter package needed for Vitest 4.
- **Split environments via `projects`** (Vitest 4 — `environmentMatchGlobs` is removed; `workspace` renamed to `projects`):

  ```ts
  // vitest.config.ts (target shape — not to be pasted verbatim; plan owns the exact form)
  test: {
    projects: [
      { extends: true, test: { name: "node", environment: "node",
        include: ["src/pages/api/**/*.test.ts", "src/lib/**/*.test.ts"] } },
      { extends: true, test: { name: "dom", environment: "happy-dom",
        include: ["src/components/**/*.test.{ts,tsx}"] } },
    ],
  }
  ```

  Alternative for one-offs: `/** @vitest-environment happy-dom */` docblock — simpler but doesn't scale to a component suite.
- **React 19 + RTL v16 specifics:** RTL wraps `render`/`rerender`/`unmount` in `React.act` (native to React 19); `IS_REACT_ACT_ENVIRONMENT` is set automatically; no manual setup needed for the `act` warning path.
- **happy-dom limitations to know:** `getComputedStyle` doesn't take pseudo-element; `matchMedia` is regex-based; `ResizeObserver`/`IntersectionObserver` are implemented. shadcn/Radix dialogs (used by `BulkRejectConfirmDialog`) work under happy-dom. If a test needs to await promise-microtask-driven UI settles, use RTL's `findBy*` / `waitFor` — happy-dom's own timers don't get driven by Vitest.
- **Wire-level fixture for `/api/generate`:** the client contract is a growing JSON body, not SSE. A minimal fixture is a `ReadableStream` (from `ReadableStream.from(iter)` or manual `controller.enqueue(new TextEncoder().encode(chunk))`) whose chunks are progressive slices of a well-formed JSON envelope. Variants worth covering per Risk #1 Face-B: full success, valid prefix + abrupt close (truncation), valid prefix + malformed suffix, HTTP 5xx after partial body, HTTP 4xx pre-body. MSW is one option but not required for hook-level tests — stubbing `global.fetch` for the hook under test is sufficient at this stage.

## OpenRouter response contract (`checked: 2026-07-29`)

Source: Context7 `/llmstxt/openrouter_ai_llms_txt` (High reputation, benchmark 81.11). Confirmed against `https://openrouter.ai/docs/api/reference/overview` and `https://openrouter.ai/docs/api/reference/streaming`.

- Response envelope is OpenAI Chat API-compatible: `{ id, choices: [...], created, model, object, system_fingerprint?, usage? }`.
- Non-streaming: `object === "chat.completion"`, choice has `message: { content, role, tool_calls? }`.
- Streaming: `object === "chat.completion.chunk"`, choice has `delta: { content, role?, tool_calls? }`; wire format is SSE (`data: <json>\n\n`), terminal `data: [DONE]`.
- **Non-obvious**: usage is emitted exactly once in a final chunk with an empty `choices` array. Consumers reading `chunk.choices[0].delta` must handle the empty case.
- Path in this repo: `@openrouter/ai-sdk-provider` + `ai` (Vercel AI SDK) — the SDK abstracts SSE parsing server-side. **The client hook never sees SSE**; it sees a plain-text response body whose payload grows over time and is parsed by `parsePartialJson`.

## Historical Context (from prior changes)

- **`context/archive/2026-07-07-first-ai-generation-and-accept/plan.md`** — S-01, three phases (schema/env, streaming UI, cards API). Explicit decision: stream from day one per infrastructure R1; `streamObject`/`streamText` + `Output.object` with Zod schema; client-side UUIDs assigned on chunk arrival; reducer tolerates replayed partial arrays. Integration tests explicitly deferred: *"a Node-level integration test that boots the endpoint against a real Supabase would be premature for this slice"* — Phase 2 of the current test rollout picks this back up.
- **`context/archive/2026-07-23-ux-improvements/plan.md`** — S-06, four phases (empty/loading states, reset session, error banners, bulk actions). Bulk-accept re-uses `POST /api/cards` with concurrency cap 4; bulk-reject adds one reducer action gated by confirmation dialog. Test decision explicit: *"nie wprowadzamy nowej warstwy w S-06 — trzymamy się konwencji projektu"* — component-test layer deferred to Module 3 (this phase).
- **`context/archive/2026-07-07-data-schema-and-rls/`** — F-01 landed pgTAP RLS suite (`supabase/tests/rls_cards_isolation.test.sql`). Phase 2 of the current test rollout (Risk #3 / #6) will replace/supplement with Vitest-level integration against local Docker Supabase. Not this phase.

## Code References

- `src/pages/api/generate.ts:20-46` — POST handler (no try/catch on `generateProposals()` — provider exception surfaces as Astro 500 HTML)
- `src/pages/api/generate.ts:43` — `createTextStreamResponse({ stream: toTextStream({ stream: result.stream }) })`
- `src/lib/ai/generate-proposals.ts:33-42` — `streamText` + `Output.object({ schema: proposalsSchema })`
- `src/lib/ai/generate-proposals.ts:10-12` — `proposalsSchema` caps proposals to `.min(1).max(15)`
- `src/components/hooks/useProposalStream.ts:11-29` — `extractCompleteProposals` (breaks on first incomplete pair)
- `src/components/hooks/useProposalStream.ts:65-82` — decoder loop + final `parsePartialJson`; **no truncation flag**
- `src/components/hooks/useProposalStream.ts:55-57` — `!response.ok` → `stream/abort` with free-form message `"Generation failed (${status})"`
- `src/components/generate/proposalsReducer.ts:34-48` — 14 action types incl. `bulkRejectPending`
- `src/components/generate/proposalsReducer.ts:50-75` — `assignIds` (position-based ID stabilisation + editing-preserves-edits across replayed chunks)
- `src/components/generate/GeneratePanel.tsx:42-51` — `persist()` (dispatch saveStart → createCard → saveSuccess/saveError)
- `src/components/generate/GeneratePanel.tsx:53-60` — accept handler
- `src/components/generate/GeneratePanel.tsx:62-71` — editSave-then-persist
- `src/components/generate/GeneratePanel.tsx:86-96` — bulk-accept (concurrency=4, per-card persist)
- `src/components/generate/GeneratePanel.tsx:98-104` — bulk-reject (dispatch `bulkRejectPending`)
- `src/components/generate/ProposalCard.tsx:37-57` — edit textareas
- `src/pages/api/cards.ts:52-98` — POST /api/cards; returns `{ card: CardRow }`
- `src/lib/error-messages.ts:3-15` — code registry (no `GENERATION_*` entries)
- `src/pages/api/generate.test.ts:55-116` — 6 existing endpoint tests (mock at SDK level)
- `src/components/generate/proposalsReducer.test.ts:1-223` — 13 reducer cases
- `vitest.config.ts:11-12` — `environment: "node"`, single-project config

## Architecture Insights

- **AI SDK abstracts the SSE seam.** The server-side abstraction (`streamText` + `Output.object` + `toTextStream`) means the endpoint-to-client wire is JSON-text, not SSE. Fixture design must match: a `ReadableStream` of progressive JSON slices, not `data: …` frames. Testing at the OpenRouter wire needs a *different* fixture (SSE frames with `[DONE]` sentinel) and probably a provider-level mock rather than a `fetch` mock.
- **Client-side ID stability by position.** `assignIds` in the reducer preserves IDs by array index across replayed chunks and preserves in-flight edits — this is subtle and a plausible break-point when the AI SDK changes emission cadence. Any test that asserts "editing a proposal then receiving a later chunk keeps my edit" must exercise `stream/chunk` twice with the second call containing more items *and* the first item's text changed.
- **No universal error-code layer for AI failures.** Every other subsystem (`account/*`, `auth/*`, password reset) already routes through `error-messages.ts`. Generation is the odd one out — free-form English strings surface in `state.errorMessage`, which means the UI cannot render an i18n message for AI failures today. This is a *product* gap (visible via the i18n parity script that runs in `prebuild`), not just a test gap; Phase 1's plan should decide whether to add `GENERATION_FAILED`, `GENERATION_TRUNCATED`, `GENERATION_TIMEOUT` codes now (small change, unlocks proper UI messaging) or defer to a follow-up.
- **`Promise.allSettled` in bulk-accept isolates per-card failures.** One failing POST does not block the remaining chunk; each proposal's state transitions independently. Any bulk-accept test therefore has to assert per-proposal state after all four concurrent calls settle, not just the aggregate.
- **`vitest.config.ts` includes `.tsx` in its glob today** — the glob is ready; only the environment split and package installs stand between the current stack and component tests.

## Open Questions

1. **Should Phase 1 land `GENERATION_*` error codes in `src/lib/error-messages.ts` now, or defer?** Adding codes tightens the UI error surface and gives tests a code-based assertion target (better oracle than free-form string comparison). Not adding codes keeps Phase 1 scoped to test infrastructure. Owner: user, before `/10x-plan`.
2. **Where should the `/api/generate` wire fixture live?** Options: `src/pages/api/__fixtures__/openrouter-streams.ts` (co-located, discoverable) vs. `src/test/fixtures/…` (dedicated tree). The test-plan §6.1 cookbook entry will point at this location — decide once, use it in §6 for future AI-response tests. Owner: `/10x-plan`.
3. **Component-test naming: `.test.tsx` alongside the component, or `__tests__/` folder?** Convention is not yet set in the codebase (no component tests today). Reducer test is co-located as `proposalsReducer.test.ts`; extending the same rule to `.tsx` is the low-friction default. Owner: `/10x-plan` — should land in the §6.2 cookbook entry.
4. **Should we install MSW at Phase 1, or start with `global.fetch` stubs?** MSW's request-handler model would generalise across Phase 1 (generate), later Phase 4 (cost cap, deck-mutation validators), and a future e2e (Phase 5 deferred). Direct `global.fetch` stubs are simpler for hook-level unit tests but don't compose. Owner: `/10x-plan` — cost × signal decision.
5. **How should `useProposalStream.ts` distinguish truncation from legitimate short output?** Options: (a) rely on AI SDK `finishReason` propagated as a footer marker; (b) require an envelope-close sentinel; (c) accept the ambiguity and require the OpenRouter provider to be the sole source of "why less than expected". This is a **product design decision** the plan surfaces but does not resolve. Owner: user, may inform Phase 1's scope (test-only vs. test + minimal remediation).

## Related Research

- `context/archive/2026-07-07-first-ai-generation-and-accept/plan.md` — S-01 implementation plan (streaming from day one; reducer state model; deferred integration tests)
- `context/archive/2026-07-23-ux-improvements/plan.md` — S-06 implementation plan (bulk accept concurrency=4; bulk-reject reducer action; deferred component tests)
- `context/foundation/test-plan.md` §2 rows 1–2 (Risk Response Guidance), §3 Phase 1 (this change), §4 (stack bump), §6.1 + §6.2 (cookbook entries this phase must fill in)

## Follow-up handoff to `/10x-plan`

The next step (`/10x-plan testing-generation-flow-protection`) can decompose Phase 1 into ordered sub-phases. A defensible sequence (research surfacing, not planning — the plan may re-order):

1. **Testing infrastructure** — install `@testing-library/react` + `@testing-library/dom` + `happy-dom`; migrate `vitest.config.ts` to `projects` with node + happy-dom environments; keep every existing test green.
2. **Endpoint hardening for Risk #1** — decide on `GENERATION_*` codes (open question 1); wrap `generateProposals()` in try/catch; add the wire-level fixture layer for provider variants; write the endpoint-level response-variant tests.
3. **Client-hook contract for Risk #1 Face-B** — wire-level fixture for `/api/generate` response body (`ReadableStream` variants); assert `useProposalStream.ts` reaches the correct terminal reducer state per variant.
4. **Component-level contract for Risk #2 Face-B** — mount `GeneratePanel`, drive accept / reject / edit-then-accept / bulk-accept / bulk-reject; assert (a) POST payload correctness, (b) rejected proposals excluded from persistence, (c) edited content carried through, (d) UI reflects state transitions.
5. **Cookbook update** — fill `test-plan.md` §6.1 (endpoint + fixture pattern) and §6.2 (component test pattern) with the reference tests from steps 2–4.
6. **CI wiring** — ensure `npm test` runs both projects in the existing GitHub Actions workflow; add to the required gate list in `test-plan.md §5`.

Steps 3 and 4 are TDD-shaped (each has a namable first red assertion — e.g. "the reducer ends in `aborted` when `/api/generate` returns a body cut mid-JSON"). Steps 1, 2, 5, 6 are `/10x-implement`-shaped (environment setup, wiring, docs).
