# Generation-flow Protection (Phase 1) Implementation Plan

## Overview

First rollout phase of the project's test plan (`context/foundation/test-plan.md` §3 Phase 1). Lands the two-project Vitest 4 split (node + happy-dom), installs `@testing-library/react` + `@testing-library/dom` + `happy-dom`, adds two `GENERATION_*` error codes plus a 30s abort timeout around the OpenRouter call so Risk #1 has a real JSON-shaped error oracle to assert against, then writes wire-fixture endpoint tests, client-hook tests, and a panel-level component test that together protect the two H×H risks the phase targets — **#1** silent AI-generation drift and **#2** the accept/reject/edit UI contract. Closes the phase by filling `test-plan.md §6.1` and `§6.2` cookbook entries with reference tests, flipping the `unit + integration` gate to `required` in `§5`, and adding `npm test` to the existing `.github/workflows/ci.yml`.

## Current State Analysis

**Testing stack (`vitest.config.ts:1-14`)**: single `defineConfig` with `test.environment: "node"`, `test.include: ["src/**/*.test.{ts,tsx}"]`, `resolve.alias: { "@": ./src }`. No `setupFiles`, no `projects`. Nine existing test files, all `.test.ts`, all mock at SDK/module level via `vi.hoisted` + `vi.mock`. `package.json:68` pins `vitest@^4.1.10` — `environmentMatchGlobs` is removed in Vitest 4; the migration path is `projects`. `@testing-library/react`, `@testing-library/dom`, `happy-dom`, `jsdom`, `msw` are all absent from dependencies.

**Generation endpoint (`src/pages/api/generate.ts:1-46`)**: `prerender = false`, Zod input `text: min(1).max(10_000)`, auth → JSON parse → schema validation gates, then **`generateProposals()` is called without try/catch**. A provider exception surfaces as an Astro 500 HTML page — the client sees a non-JSON response body it cannot render as an i18n message. There is **no timeout wrapper** on the AI SDK call (PRD NFR guardrail: p95 < 30s).

**OpenRouter wrapper (`src/lib/ai/generate-proposals.ts:33-42`)**: `streamText` + `Output.object({ schema: proposalsSchema })` from Vercel `ai@~7.0.18`; provider `@openrouter/ai-sdk-provider@~3.0.0`; no temperature / max_tokens / abortSignal set.

**Client stream hook (`src/components/hooks/useProposalStream.ts:11-102`)**: reads `/api/generate` response body via `TextDecoderStream`, accumulates a `buffer`, calls `parsePartialJson(buffer)` after each chunk, extracts complete `{question, answer}` pairs; on `!response.ok` dispatches `stream/abort` with the **free-form message** `"Generation failed (${response.status})"` — never reads the JSON error body; on network / decoder error dispatches `stream/abort` with the JS error message. No truncation detection (documented in research §"Silent-loss gap"; **out of scope for Phase 1** per user decision).

**Reducer (`src/components/generate/proposalsReducer.ts:34-48, 77-160`)**: 14 action types incl. `bulkRejectPending`; pure factory `makeReducer(idFactory)`. Covered by 13 unit cases in `proposalsReducer.test.ts` (223 lines). **Zero component-level tests exist.**

**Error registry (`src/lib/error-messages.ts:3-15, 19-31`)**: 11 registered codes (auth / account / password / reset paths); every code has a Paraglide `m.error_*()` resolver. **No `GENERATION_*` codes.**

**i18n (`AGENTS.md` hard rule)**: every user-visible string needs a key in **both** `messages/pl.json` and `messages/en.json`; `npm run prebuild` (`scripts/check-i18n-parity.mjs`) fails the build on any parity break.

**CI (`.github/workflows/ci.yml:9-26`)**: `npm ci → npx wrangler types → npx astro sync → npm run lint → npm run build`. **`npm test` is not wired.** The `test-plan.md §5` row for `unit + integration` says `required after §3 Phase 1 (component + endpoint tests + CI hook)`.

## Desired End State

Post-Phase-1 the repository is in a state where:

1. `npm test` runs 9 existing tests plus new ones across two Vitest projects (`node`, `dom`), each with the correct environment. Every existing test still passes. Component-test infrastructure (`@testing-library/react` + `happy-dom`) is installed and works.
2. `POST /api/generate` returns JSON `{ error: "GENERATION_FAILED" }` (HTTP 502) when the AI SDK call throws for any reason, and JSON `{ error: "GENERATION_TIMEOUT" }` (HTTP 504) when the provider call exceeds a 30s abort deadline. Both codes are registered in `src/lib/error-messages.ts` and have i18n messages in both locales.
3. `useProposalStream.ts` on a non-2xx response reads the JSON error body and dispatches `stream/abort` with the code as `reason` (falls back to `UNKNOWN` if the body is not JSON or lacks `error`).
4. `src/pages/api/generate.test.ts` covers provider failure paths (throw, timeout, happy path returning a well-formed stream). `src/components/hooks/useProposalStream.test.tsx` covers 4 wire variants + one `it.todo` documenting the silent-truncation gap. `src/components/generate/GeneratePanel.test.tsx` mounts the panel and drives accept / reject / edit-then-accept / bulk-accept / bulk-reject with fetch stubs, asserting the four Risk #2 sub-oracles.
5. `test-plan.md §5` `unit + integration` gate is `required`. `test-plan.md §6.1` (endpoint fixture pattern) and `§6.2` (component test pattern) point at concrete reference tests. `.github/workflows/ci.yml` runs `npm test` between `lint` and `build`. Both push and PR CI runs pass.

### Key Discoveries

- **Vitest 4 `projects` migration path** requires `extends: true` at each project to inherit the top-level `resolve.alias` (`@` → `./src`) — without it, in-project imports break silently (Context7 `vitest` docs, checked 2026-07-29).
- **RTL v16 supports React 19** but `@testing-library/dom` moved to a **peer dependency** and must be installed explicitly (Context7 `@testing-library/react` docs).
- **`happy-dom` implements `ResizeObserver` and `IntersectionObserver`** — shadcn/Radix `AlertDialog` (used by `BulkRejectConfirmDialog`) works under happy-dom without additional polyfills (Context7 `happy-dom` docs).
- **Endpoint mocking strategy**: keep the existing `vi.mock('@/lib/ai/generate-proposals')` pattern from `src/pages/api/generate.test.ts:12-14` — the AI SDK abstracts OpenRouter's SSE server-side, so drift manifests as SDK-level exceptions, not new wire formats. Endpoint tests exercise the try/catch by stubbing `generateProposals()` with new failure signatures (throw sync, throw during stream iteration, return a stream whose `AbortSignal` fires).
- **Client-hook mocking strategy**: stub `global.fetch` via `vi.stubGlobal('fetch', vi.fn())` per test; return a `Response` whose body is a hand-crafted `ReadableStream<Uint8Array>` with `TextEncoder`-encoded slices. This exercises the actual `parsePartialJson` decode loop end-to-end.
- **Fixture module** (`src/test/fixtures/generate-stream.ts`) exports named factories per variant: `successResponse(proposals)`, `truncatedResponse(proposals, cutAfterBytes)`, `malformedSuffixResponse(proposals)`, `errorResponse(status, code)`, `partialThenErrorResponse(proposals, errorAfterBytes)`. Both endpoint tests (transitively, via the SDK-shaped stubs they build) and hook tests import from this module.
- **AI SDK error surface point**: `streamText(...)` returns an object with `.stream` — the return itself does not necessarily throw when the provider is unhealthy. The try/catch in the endpoint must wrap **both** the invocation and (via the returned `pipeThrough`-able stream) the iteration path. The pattern is: attach an error handler to the returned stream OR pipe through a `TransformStream` that catches downstream errors and emits a controlled `abort`.
- **`AbortSignal.timeout(30_000)` in workerd**: available under `compatibility_date` current at 2026-07 (verify against `wrangler.jsonc` during implementation); if unavailable, fall back to `AbortController` + `setTimeout(controller.abort, 30_000)` pattern.
- **Reducer test file (`proposalsReducer.test.ts`)** stays under the node project — pure JS, no DOM needed; naming convention `.test.ts` for node-only tests, `.test.tsx` for tests that need DOM (component or hook).
- **Existing endpoint tests** (all 6) work unchanged under the node project — the include-glob split (`src/**/*.test.ts` for node, `src/**/*.test.tsx` for dom) means their file names guarantee they land in the right project.

## What We're NOT Doing

- **Truncation detection in `useProposalStream`.** Research open Q5 explicitly deferred. Phase 1 documents the gap with an `it.todo` test titled `"mid-JSON truncation should dispatch stream/abort with GENERATION_TRUNCATED"` — no product change today.
- **Rate-limit / cost-cap code and tests.** That is `test-plan.md §3 Phase 4` (Risk #5). `GENERATION_RATE_LIMITED` code is not registered in this phase.
- **Two-user RLS integration tests** (Risk #3). Owned by `test-plan.md §3 Phase 2`.
- **Middleware / protected-route gate tests** (Risk #4). Owned by `§3 Phase 3`.
- **E2E smoke tests** with Playwright. Owned by `§3 Phase 5` (deferred; may resolve to a manual smoke checklist).
- **MSW / undici mock agent.** Fetch stubs via `vi.stubGlobal` are sufficient for the 6-10 tests this phase lands. If Phase 4 finds fetch stubs repetitive, re-evaluate at `test-plan.md --refresh` time.
- **Retrofitting UPPER_SNAKE codes to existing lowercase `unauthorized` / `invalid json` / `invalid input` responses** in `generate.ts`. Pre-existing inconsistency with `AGENTS.md`; not in Phase 1's risk surface. Only new error paths added by this plan use UPPER_SNAKE.
- **Coverage tooling** (`@vitest/coverage-*`). Coverage is not the metric; risk coverage is. Cookbook §6 tracks reference tests, not percentage.
- **Test-plan §7 exclusions** (shadcn primitives, look-and-feel, marketing landing, meta-tests). Untouched.

## Implementation Approach

Four phases in strict dependency order. Phase 1 lands infrastructure so the remaining phases have somewhere to put tests. Phase 2 pairs endpoint hardening with the tests that assert against the new oracle — the phase is TDD-shaped and can be driven via `/10x-tdd` (the first red assertion "`generate.ts` returns `{ error: 'GENERATION_FAILED' }` when the AI SDK call throws" is nameable in one sentence). Phase 3 does the same for Risk #2's component-wiring contract, with a similarly nameable red assertion for the accept path. Phase 4 closes the loop: fills the cookbook entries so the next contributor knows how to add a test in this project, flips the CI gate, and marks §5 required.

Each phase ends with `npm test` (both projects) green, `npm run lint` green, `npm run build` green. Phase 4 additionally verifies the CI run on PR passes with the new gate active.

## Critical Implementation Details

**Vitest 4 `projects` alias inheritance.** Each project entry must set `extends: true` so the top-level `resolve.alias` (mapping `@` → `./src`) is inherited; without it, project-scoped configs override the alias with an empty map and every `@/*` import fails to resolve. This is the single most subtle Vitest 4 migration gotcha — verified against Context7 docs, `checked: 2026-07-29`.

**AI SDK error surface for `streamText`.** The synchronous return of `streamText(...)` does not throw on provider unavailability; errors surface (a) synchronously if `apiKey` is malformed or the model name is invalid, (b) asynchronously as the returned stream's `pipeThrough` yields error frames or rejects mid-iteration. The endpoint's try/catch must therefore wrap the *stream setup and pipe* not just the `generateProposals()` call. If the AI SDK exposes a `.finishReason` promise on the returned object, awaiting it before response construction is a reliable pattern; otherwise pipe through a `TransformStream` that catches downstream errors and emits a `GENERATION_FAILED`-tagged terminator — the implementer verifies the current SDK surface during Phase 2.

---

## Phase 1: Testing infrastructure

### Overview

Install component-testing dependencies, migrate `vitest.config.ts` to Vitest 4 `projects` split (node for `.test.ts`, dom for `.test.tsx` — both under `src/`), verify all existing tests still pass unchanged. No new test files land in this phase.

### Changes Required

#### 1. Testing dependencies

**File**: `package.json`

**Intent**: Add `@testing-library/react`, `@testing-library/dom`, and `happy-dom` as `devDependencies` so component tests can mount React 19 islands under a DOM environment.

**Contract**: Three packages added to `devDependencies` at their current latest majors (`@testing-library/react` v16.x, `@testing-library/dom` v10.x, `happy-dom` v19.x). `package-lock.json` regenerated via `npm install`. No changes to existing dependency pins. No new npm scripts.

#### 2. Vitest projects split

**File**: `vitest.config.ts`

**Intent**: Migrate the single-project config to Vitest 4 `projects` with two entries — `node` for `src/**/*.test.ts` (all existing tests plus future non-DOM tests), `dom` for `src/**/*.test.tsx` (component and hook tests introduced in Phases 2-3). Both projects inherit the top-level `resolve.alias`.

**Contract**: `defineConfig({ resolve: { alias: { "@": ... } }, test: { projects: [{ extends: true, test: { name: "node", environment: "node", include: [...] } }, { extends: true, test: { name: "dom", environment: "happy-dom", include: [...] } }] } })`. **`extends: true` is load-bearing** — see Critical Implementation Details. Each project's `include` glob is disjoint (`.test.ts` vs `.test.tsx`) so no file runs under both environments.

#### 3. Verify existing test surface

**File**: (no code change — verification step)

**Intent**: Run `npm test` after the migration and confirm all 9 existing tests pass under the `node` project with zero DOM tests initially picked up by the `dom` project. Any test that fails identifies a config regression before Phase 2 layers new work on top.

**Contract**: `npm test` exit code 0. Test summary shows `node (9 passed)` + `dom (0 tests found)` — an empty `dom` project is valid in Vitest 4 when no matching files exist yet.

### Success Criteria

#### Automated Verification

- `npm install` completes without errors and adds the three test-lib packages to `devDependencies`
- `npm test` exits 0 with all 9 existing tests passing under the `node` project
- `npm run lint` passes (no new lint errors from the config change)
- `npm run build` passes (Vitest config is not part of the Astro build, but the whole toolchain must stay green)
- `npx tsc --noEmit` passes (or `astro sync && tsc`) — happy-dom type surface must not conflict with existing types

#### Manual Verification

- `package.json` diff contains only the three new devDependencies plus lockfile changes (no drift)
- `vitest.config.ts` diff shows the two-project split with `extends: true` on both entries

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Risk #1 hardening + tests

### Overview

Add the `GENERATION_FAILED` and `GENERATION_TIMEOUT` codes with i18n messages, wrap the AI SDK call in try/catch + 30s abort timeout, teach `useProposalStream.ts` to parse the JSON error body from non-2xx responses, author the wire-fixture module, then extend the endpoint tests and add the hook test file. TDD-shaped: implementer names the red assertion for each sub-step before touching the corresponding code.

### Changes Required

#### 1. Register `GENERATION_*` error codes

**File**: `src/lib/error-messages.ts`

**Intent**: Add two new entries to `ERROR_CODES` and `RESOLVERS` so any surface returning `?error=GENERATION_FAILED` or `?error=GENERATION_TIMEOUT` renders an i18n message via `errorCodeToMessage()`.

**Contract**: `ERROR_CODES.GENERATION_FAILED = "GENERATION_FAILED"`, `ERROR_CODES.GENERATION_TIMEOUT = "GENERATION_TIMEOUT"`; resolver map keys pointing at `m.error_generation_failed` and `m.error_generation_timeout`. The `ErrorCode` union type expands to include the two new literals; downstream callers already accept `string | null | undefined` via `errorCodeToMessage()` so no other file changes.

#### 2. i18n keys in both locales

**File**: `messages/pl.json` and `messages/en.json`

**Intent**: Add `error_generation_failed` and `error_generation_timeout` message keys to both files in the same commit so `scripts/check-i18n-parity.mjs` (invoked by `npm run prebuild`) stays green.

**Contract**: Two new keys per file. Copy pragma (PL first, then EN): `"error_generation_failed": "Nie udało się wygenerować fiszek. Spróbuj ponownie za chwilę."` / `"Failed to generate flashcards. Please try again in a moment."`, `"error_generation_timeout": "Generowanie fiszek trwało zbyt długo. Skróć wklejony tekst lub spróbuj ponownie."` / `"Flashcard generation took too long. Shorten the pasted text or try again."` — exact wording is the implementer's call; the constraint is parity of keys.

#### 3. Endpoint try/catch + timeout

**File**: `src/pages/api/generate.ts`

**Intent**: Wrap the `generateProposals()` call (and the piped-through stream) in a try/catch with an `AbortSignal.timeout(30_000)` threaded into the AI SDK's `abortSignal` parameter (or `AbortController` + `setTimeout` fallback). Timeout → `jsonResponse(504, { error: "GENERATION_TIMEOUT" })`; any other thrown error → `jsonResponse(502, { error: "GENERATION_FAILED" })`. Response construction path for the happy case is unchanged.

**Contract**: The endpoint continues to return `Response` objects in every branch — either a streaming response (happy path), or a JSON error response (auth / validation / provider failure / timeout). No changes to the 401 / 400 / 405 branches (their lowercase codes stay as-is per §"What We're NOT Doing"). Timeout budget is a compile-time constant (`GENERATION_TIMEOUT_MS = 30_000`) at the top of the file, referenced once. **See "Critical Implementation Details / AI SDK error surface"** — the try/catch must span stream setup + pipe, not just the invocation.

#### 4. Client hook parses JSON error body

**File**: `src/components/hooks/useProposalStream.ts`

**Intent**: When `!response.ok`, attempt to `await response.json()` and read the `error` field; use that string as `reason` in the `stream/abort` dispatch. Fall back to `"UNKNOWN"` when the body is not JSON or lacks `error`. On network / decoder errors mid-stream, keep the current behavior (dispatch with `error.message`) since the code path there is not the JSON-error surface.

**Contract**: `dispatch({ type: "stream/abort", reason: <code-string> })` where `<code-string>` is either a recognized UPPER_SNAKE code or `"UNKNOWN"`. The reducer stores this in `state.errorMessage`, which `StreamBanner` renders via `errorCodeToMessage(state.errorMessage)` (verify the banner already routes through the registry; if not, that's a one-line adjustment in `StreamBanner.tsx`).

#### 5. Wire-fixture module

**File**: `src/test/fixtures/generate-stream.ts` (new)

**Intent**: Provide named factory functions that return `Response` objects suitable for `vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))`. Five variants covering the response-body space Risk #1 Face-B must exercise.

**Contract**: Exports `successResponse(proposals: Array<{question: string; answer: string}>)`, `truncatedResponse(proposals, cutAfterBytes: number)`, `malformedSuffixResponse(proposals)`, `errorResponse(status: number, code: string)`, `partialThenErrorResponse(proposals, errorAfterBytes: number)`. Each returns a `Response` whose body is a `ReadableStream<Uint8Array>` (encoded via `TextEncoder`) or, in the error case, a JSON body carrying `{ error: code }`. The module has no side effects and no imports from `src/pages/*` or `src/components/*` — it's a leaf test utility.

#### 6. Extend endpoint tests

**File**: `src/pages/api/generate.test.ts`

**Intent**: Add 3-4 test cases exercising the new try/catch — `generateProposals()` throws synchronously → 502 `GENERATION_FAILED`; stream iteration rejects → 502 `GENERATION_FAILED`; provider exceeds 30s (fake timers) → 504 `GENERATION_TIMEOUT`; extend the happy path to assert the response body actually contains a valid proposal envelope. Reuse the existing `vi.hoisted` mock-shape for `@/lib/ai/generate-proposals` — the mock's returned `.stream` becomes a `ReadableStream` from the fixture module (or a rejected stream for the failure paths).

**Contract**: Six existing tests unchanged; 3-4 new tests added. Each new test asserts on JSON body shape (`{ error: "GENERATION_FAILED" }` or `{ error: "GENERATION_TIMEOUT" }`) and HTTP status. Timeout test uses `vi.useFakeTimers()` + `vi.advanceTimersByTime(30_001)`.

#### 7. Client-hook test file

**File**: `src/components/hooks/useProposalStream.test.tsx` (new)

**Intent**: Render the hook via `renderHook` from `@testing-library/react`; drive it against the five wire-fixture responses; assert the reducer's terminal state per variant.

**Contract**: One `describe` block per variant. Assertions target the dispatched actions (via a spy dispatch or the reducer's derived state) — specifically the terminal `streamState` value and the count/content of dispatched `stream/chunk` payloads. The truncation case is written as `it.todo("mid-JSON truncation should dispatch stream/abort with GENERATION_TRUNCATED — deferred, see research §Silent-loss gap")` since the product change is out of scope. Other four variants are real `it(...)` tests.

### Success Criteria

#### Automated Verification

- `npm test` exits 0; test summary shows +6 to +7 new test cases across `node` (endpoint tests) and `dom` (hook tests) projects; the pre-existing 9 tests still pass
- `npm run prebuild` (i18n parity) exits 0 — both new keys present in `messages/pl.json` and `messages/en.json`
- `npm run lint` passes
- `npm run build` passes
- Two new codes appear in `errorCodeToMessage("GENERATION_FAILED")` and `errorCodeToMessage("GENERATION_TIMEOUT")` returning i18n messages (verified by the hook test asserting the resolver map path — a lightweight sanity assertion, not a full i18n suite)

#### Manual Verification

- Deliberately break OpenRouter connectivity (unset `OPENROUTER_API_KEY` in `.dev.vars`) and paste text on `/generate` in dev mode; UI shows the localized `error_generation_failed` message (both PL and EN)
- With connectivity restored, paste text and confirm proposals stream in normally — no regression on the happy path
- Inspect the network tab: failed generation returns HTTP 502 with `Content-Type: application/json` and body `{ "error": "GENERATION_FAILED" }`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Risk #2 component contract (accept / reject / edit / bulk)

### Overview

Add a panel-level component test that mounts `GeneratePanel` under happy-dom and drives the full candidate-review UX with fetch stubs for both `/api/generate` and `/api/cards`. Asserts the four Risk #2 sub-oracles (POST payload correctness, rejected exclusion, edited-content carry-through, UI state reflection). No product code changes — this phase is pure test work.

### Changes Required

#### 1. Component test file

**File**: `src/components/generate/GeneratePanel.test.tsx` (new)

**Intent**: Render `<GeneratePanel />` with `render()` from `@testing-library/react`, then use `userEvent` from `@testing-library/user-event` (dev-dep landed transitively with `@testing-library/dom`, or explicitly if the RTL install did not include it — the implementer verifies during install) to drive user flows against a `global.fetch` stub. Cases: (a) accept a single pending proposal → assert POST to `/api/cards` with `{ question, answer, source: "ai" }` and UI shows saved state; (b) reject a proposal → assert it disappears from the visible list and is *not* in any subsequent POST; (c) edit-then-accept → type new content in the textarea, save, accept, assert POST body carries the edited content; (d) bulk-accept 3 pending proposals → assert three POST calls to `/api/cards` fire and each proposal's UI transitions to saved; (e) bulk-reject 3 pending proposals → open confirm dialog, confirm, assert all three disappear from the visible list.

**Contract**: One `describe("GeneratePanel")` per case, using RTL's `screen.findByRole` / `userEvent.click` / `userEvent.type` patterns. `global.fetch` is stubbed via `vi.stubGlobal` in `beforeEach`; the first call resolves to `successResponse([...])` from `@/test/fixtures/generate-stream`; subsequent calls (to `/api/cards`) resolve to `{ card: {...} }` JSON. Bulk-accept assertion allows *up to 4 concurrent* fetch calls (the concurrency cap) — the test waits for all pending proposals to reach the `saved` state via `waitFor`.

#### 2. Add `@testing-library/user-event` if missing

**File**: `package.json`

**Intent**: `@testing-library/user-event` is not a transitive dependency of `@testing-library/react`; if the Phase 1 install did not include it, add it here so `userEvent` from `@testing-library/user-event` is importable.

**Contract**: One devDependency addition. Version at current latest major (14.x). Included in `package-lock.json`.

### Success Criteria

#### Automated Verification

- `npm test` exits 0; test summary shows +5 new test cases under the `dom` project (one per case listed above)
- All five cases pass without flakiness across 3 consecutive local runs
- `npm run lint` passes (no new lint errors in the test file — `.test.tsx` picks up React ESLint rules)
- `npm run build` passes
- No new console warnings in the test output — `act()` warnings from React 19 should be silent given RTL v16's automatic wrapping (Context7-verified, `checked: 2026-07-29`)

#### Manual Verification

- Run `npm test -- src/components/generate/GeneratePanel.test.tsx` in isolation and confirm the test suite name and case titles match the plan (readability check for future contributors)
- Skim the test file: no assertions on dispatch call signatures or internal reducer state (implementation-mirror anti-pattern per `test-plan.md §2 Risk Response Guidance row 2`); assertions are on visible UI state (roles, text) and outbound fetch payloads

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Cookbook + CI ratchet

### Overview

Fill in the two cookbook entries `test-plan.md` §6.1 and §6.2 with concrete references to the tests written in Phases 2 and 3; flip the `unit + integration` gate in §5 to `required`; wire `npm test` into `.github/workflows/ci.yml`; append a per-rollout-phase note to §6.7 capturing what this phase taught (fixture location, projects config, RTL v16 install path).

### Changes Required

#### 1. Cookbook §6.1 — endpoint test with external LLM call

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the `TBD — see §3 Phase 1` placeholder in §6.1 with a paragraph describing (i) where fixtures live (`src/test/fixtures/generate-stream.ts`), (ii) the mocking rule ("mock the AI SDK's `generateProposals` module at import boundary; never mock at OpenRouter SSE level"), (iii) the reference test (`src/pages/api/generate.test.ts` cases for provider throw / timeout / happy path), (iv) how to add a new response variant (add a factory to `generate-stream.ts`, then reference from a test's `vi.mocked(generateProposals).mockImplementationOnce(...)`).

**Contract**: One markdown sub-section, ~15 lines. Named files and function names must exist on disk. No pasted code snippets — pointers only, per Lesson 1 convention on cookbook entries.

#### 2. Cookbook §6.2 — component test for React island

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the `TBD — see §3 Phase 1` placeholder in §6.2 with a paragraph describing (i) the `dom` Vitest project and `.test.tsx` naming convention, (ii) how to `render` a React island (importing directly from `src/components/**/*.tsx`, no Astro-page wrapper needed), (iii) the mocking rule for fetch (`vi.stubGlobal('fetch', ...)`), (iv) the reference test (`src/components/generate/GeneratePanel.test.tsx`), (v) the assertion style (visible UI + outbound payloads, never dispatch spies or snapshots).

**Contract**: One markdown sub-section, ~15 lines. Same rules as §6.1.

#### 3. §5 quality-gate row + §6.7 per-phase note

**File**: `context/foundation/test-plan.md`

**Intent**: Flip the `unit + integration (npm test)` row in §5 from `required after §3 Phase 1 (component + endpoint tests + CI hook)` to `required (this phase)`. Append a 2-3 line note to §6.7 titled "Phase 1 rollout note (2026-07-29)" capturing: fixture module location, RTL v16 install path with peer dep, Vitest 4 `projects` with `extends: true` gotcha.

**Contract**: One row edit in §5, one appended entry in §6.7. No structural changes to §1-§4 or §7-§8.

#### 4. §3 rollout table status update

**File**: `context/foundation/test-plan.md`

**Intent**: Update the Phase 1 row in §3 Phased Rollout to `Status: complete` when the plan is fully implemented. (Written into the plan so `/10x-implement` marks it at closing time; not manually flipped now.)

**Contract**: Cell change in the §3 table — Phase 1 row, `Status` column. Marker for `/10x-implement`.

#### 5. CI wiring — `npm test` step

**File**: `.github/workflows/ci.yml`

**Intent**: Add `- run: npm test` between `- run: npm run lint` and `- run: npm run build` in the `ci` job. The step needs no env vars (tests don't hit Supabase or OpenRouter directly). No changes to the `deploy` job — deploy does not re-run tests; it trusts the `ci` job passed.

**Contract**: One added YAML line in the `ci.steps` list. Placement: after `npm run lint`, before `npm run build`. No reordering of other steps.

### Success Criteria

#### Automated Verification

- `npm test` exits 0
- `npm run prebuild && npm run lint && npm run build` all exit 0
- Push a branch with these changes; the CI run on GitHub Actions passes with the new `npm test` step visible in the run log
- `context/foundation/test-plan.md` linter check (if any) still passes — the markdown file is well-formed

#### Manual Verification

- Read §6.1 and §6.2 in the updated `test-plan.md` — a fresh contributor unfamiliar with this rollout can locate the reference tests within 30 seconds
- CI run on PR shows `npm test` between `lint` and `build`; both `node` and `dom` projects report passing
- Confirm the `unit + integration` row in `test-plan.md §5` reads `required (this phase)` after this phase lands
- Open the merged PR against `master`; verify the deploy job succeeds after `ci` completes (i.e. the added test step doesn't break the deploy chain)

**Implementation Note**: This is the final phase. No further phases follow. Mark §3 Phase 1 row `complete` in `test-plan.md` after all Automated + Manual criteria pass.

---

## Testing Strategy

### Unit tests

- Endpoint failure paths (`src/pages/api/generate.test.ts`): provider throws sync, stream iteration rejects, timeout fires, happy path stream contains valid proposals
- Client hook wire variants (`src/components/hooks/useProposalStream.test.tsx`): 4 real tests + 1 `it.todo` for the deferred truncation case

### Integration tests

- Panel-level component test (`src/components/generate/GeneratePanel.test.tsx`): five user-flow cases mounted end-to-end against fetch stubs

### Manual testing steps

1. Deliberately unset `OPENROUTER_API_KEY` in `.dev.vars`; visit `/generate` in dev mode; paste text; click "Generate proposals"; confirm the localized error message appears (verify in both PL and EN via language toggle)
2. Restore `OPENROUTER_API_KEY`; repeat the flow and confirm proposals stream normally
3. Simulate slow provider by adding a temporary `await new Promise(r => setTimeout(r, 31000))` to the top of `generateProposals()`; confirm the endpoint returns `GENERATION_TIMEOUT` after 30s and the UI shows the timeout message; revert the change
4. In the browser dev tools, throttle network to `Slow 3G`; verify the streaming UI behaves gracefully (no crash, no infinite spinner)

## Performance Considerations

Component tests under happy-dom have a per-file setup cost (~50-100ms). Phase 3 lands one `.test.tsx` file with 5 cases in a single `describe` — well within acceptable bounds. If future phases add many small `.test.tsx` files, consider a shared setup file (`vitest.config.ts` `test.projects[dom].setupFiles`) that pre-imports RTL to amortize the cost.

`AbortSignal.timeout(30_000)` at the endpoint keeps the p95 NFR guarantee active without extra CPU cost — Workers only bills CPU time, and waiting on the abort is I/O (per `context/foundation/infrastructure.md` §Recommendation).

## References

- Related research: `context/changes/testing-generation-flow-protection/research.md`
- Test plan §3 Phase 1 row: `context/foundation/test-plan.md:61`
- Risk #1 response guidance: `context/foundation/test-plan.md:48`
- Risk #2 response guidance: `context/foundation/test-plan.md:49`
- Wedge context (roadmap): `context/foundation/roadmap.md:24`
- Streaming-first pre-mortem: `context/foundation/infrastructure.md:78`
- Prior generation slice: `context/archive/2026-07-07-first-ai-generation-and-accept/plan.md`
- Prior bulk-actions slice: `context/archive/2026-07-23-ux-improvements/plan.md`
- Endpoint under test: `src/pages/api/generate.ts:1-46`
- Client hook under test: `src/components/hooks/useProposalStream.ts:1-102`
- Reducer already tested: `src/components/generate/proposalsReducer.test.ts`
- Error registry pattern: `src/lib/error-messages.ts:1-48`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Testing infrastructure

#### Automated

- [x] 1.1 npm install adds @testing-library/react, @testing-library/dom, happy-dom to devDependencies — 40c5831
- [x] 1.2 npm test exits 0 with 9 existing tests passing under the node project — 40c5831
- [x] 1.3 npm run lint passes after config change — 40c5831
- [x] 1.4 npm run build passes after config change — 40c5831
- [x] 1.5 npx tsc --noEmit (or astro sync && tsc) passes — 40c5831

#### Manual

- [x] 1.6 package.json diff contains only the three new devDependencies plus lockfile changes — 40c5831
- [x] 1.7 vitest.config.ts diff shows two-project split with extends: true on both entries — 40c5831

### Phase 2: Risk #1 hardening + tests

#### Automated

- [x] 2.1 npm test exits 0 with the new endpoint + hook cases passing — 060a8c6
- [x] 2.2 npm run prebuild (i18n parity) passes with both new keys in messages/pl.json and messages/en.json — 060a8c6
- [x] 2.3 npm run lint passes — 060a8c6
- [x] 2.4 npm run build passes — 060a8c6
- [x] 2.5 errorCodeToMessage("GENERATION_FAILED") and errorCodeToMessage("GENERATION_TIMEOUT") return i18n messages — 060a8c6

#### Manual

- [x] 2.6 Unsetting OPENROUTER_API_KEY in dev renders localized error_generation_failed on /generate in both PL and EN — 060a8c6
- [x] 2.7 Restoring the key restores the happy path with no regression — 060a8c6
- [x] 2.8 Failed generation returns HTTP 502 with Content-Type application/json and body { "error": "GENERATION_FAILED" } — 060a8c6

### Phase 3: Risk #2 component contract

#### Automated

- [x] 3.1 npm test exits 0 with the five new GeneratePanel cases passing — e79ad6f
- [x] 3.2 GeneratePanel test suite passes without flakiness across 3 consecutive local runs — e79ad6f
- [x] 3.3 npm run lint passes — e79ad6f
- [x] 3.4 npm run build passes — e79ad6f
- [x] 3.5 No React 19 act() warnings surface in test output — e79ad6f

#### Manual

- [x] 3.6 Running the GeneratePanel test file in isolation shows readable case titles — e79ad6f
- [x] 3.7 Test file assertions target visible UI and outbound fetch payloads, never dispatch spies or snapshots — e79ad6f

### Phase 4: Cookbook + CI ratchet

#### Automated

- [x] 4.1 npm test exits 0 — 5935853
- [x] 4.2 npm run prebuild && npm run lint && npm run build all exit 0 — 5935853
- [x] 4.3 CI run on a pushed branch passes with the new npm test step visible in the run log — 5935853

#### Manual

- [x] 4.4 A fresh contributor can locate the reference tests within 30 seconds of reading §6.1 / §6.2 — 5935853
- [x] 4.5 CI run on PR shows npm test between lint and build with both node and dom projects reporting passing — 5935853
- [x] 4.6 test-plan.md §5 unit + integration row reads required (this phase) — 5935853
- [x] 4.7 deploy job succeeds after ci completes on merge to master — 5935853
- [x] 4.8 test-plan.md §3 Phase 1 row marked complete — 5935853
