# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-07-29

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the risk wins. Do not promote to e2e because e2e "feels safer." Do not put a vision model on top of a deterministic visual diff that already catches the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team is worried about X, and the failure would surface somewhere in <area>" carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents *what could fail* and *why we believe it's likely* — drawn from documents, interview, and codebase *signal* (churn, structure, test base). It does NOT claim to know which line owns the failure. That knowledge is produced by `/10x-research` during each rollout phase. If the plan and research disagree about where the failure lives, research is the ground truth.

Hot-spot scope used for likelihood weighting: `src/` (excluded `node_modules/`, `dist/`, `.astro/`; 43 commits/30d — sufficient history).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by risk = impact × likelihood. Risks are failure scenarios in user / business terms, not test names. The Source column cites the *evidence that surfaced this risk* — never a specific file as "where the failure lives" (that is research's job, see §1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|---|---|---|---|
| 1 | **AI-generation returns corrupted or truncated flashcards from OpenRouter response drift.** User pastes text, gets "cards that look weird" (silent degradation, not a hard error), can't validate the wedge, abandons the workflow. | High | High | interview Q1, Q3 · `context/foundation/infrastructure.md` §Risk Register (OpenRouter streaming-first drift row, pre-mortem: M×H) · hot-spot dir `src/components/generate/` (23 commits/30d) · hot-spot dir `src/pages/api/` (38 commits/30d) |
| 2 | **The accept / reject / edit contract on AI proposals is silently broken by a change to generate-flow React components — state drift between UI events, dispatched actions, and the deck actually persisted.** Breaks the human-decision layer that IS the product wedge. | High | High | interview Q3, Q4 · hot-spot dir `src/components/generate/` (23 commits/30d) · roadmap §Vision recap (wedge = "AI z inputu + accept/reject/edit") · existing test base covers the pure reducer only; component wiring is bare |
| 3 | **RLS gap leaks user A's cards or review history to user B — during normal auth or the 30-day soft-delete retention window.** Privacy NFR fails silently, no external signal. | High | Medium | PRD §Non-Functional Requirements ("Privacy of user content") · PRD §Access Control · roadmap §F-01 Risk section (silent-leak class) · `context/archive/2026-07-23-account-deletion-30d-retention/plan-brief.md` (per-policy soft-delete gate — one missed policy = leak) |
| 4 | **Logged-out or soft-deleted user reaches a protected route (dashboard / generate / review / deck / account), or a new page is added without being registered in the auth gate.** Bypasses auth and privacy simultaneously. | High | Medium | PRD §Access Control · hot-spot dir `src/pages/auth/` (21 commits/30d — sustained churn at the auth-boundary surface) · `context/archive/2026-07-23-account-deletion-30d-retention/plan-brief.md` (added a soft-deleted state → three-way gate, one of them manually maintained) |
| 5 | **Runaway AI-generation cost from a single user (no daily quota or text-length cap enforced) burns the OpenRouter budget.** Resource-abuse class; a determined user or a naïve script drives cost with no upper bound. | Medium | Medium | PRD §Open Questions #2 (owner: user, "before MVP launch" — resolution not archived) · roadmap §Open Roadmap Questions #2 · hot-spot dir `src/pages/api/` (38 commits/30d) |
| 6 | **Deck-management mutations allow malformed input, cross-user writes at the endpoint, or edit-vs-schedule semantic drift.** Corrupts a user's own deck and/or crosses the ownership boundary at write time. | Medium | Medium | interview Q3 · hot-spot dir `src/components/deck/` (15 commits/30d) · hot-spot dir `src/pages/api/` (38 commits/30d) · PRD §Open Questions #3 (edit-vs-schedule) |

**Impact × Likelihood rubric.**

| Rating | Impact | Likelihood |
|--------|--------|------------|
| High | user loses access, data, or money; failure is publicly visible | area changes weekly, or we have already been burned here |
| Medium | feature degrades, a workaround exists, only some users affected | touched occasionally, has been a source of bugs |
| Low | cosmetic, easily reverted, no data effect | stable code, rarely touched |

**Abuse-lens coverage.** Product has auth + PII (email) + paid AI API + user-generated content, so the abuse lens is required. #3 covers authorization/ownership (row-level IDOR class), #4 covers authorization/access (route-level), #5 covers resource abuse (AI cost). Three of six rows carry the abuse lens.

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|------|----|----|----|----|----|
| #1 | An endpoint test that feeds representative OpenRouter response variants (well-formed streaming, well-formed non-streaming, mid-stream truncation, malformed JSON, HTTP 5xx after partial body) and asserts the endpoint produces valid `{question, answer}` pairs **or** fails cleanly with a UI-renderable error — never silently returns "cards that look weird." | "Pin the assertion to the current OpenRouter response shape." That is the oracle problem — asserting against the current shape green-lights current behaviour, including any drift already present. | OpenRouter response contract (streaming vs non-streaming), parsing entry point in the generation route, error translation to UI state. | Integration test against a mocked OpenRouter server at the network edge (fixture responses covering the variants), NOT e2e. | Assertion copied from a current happy-path response; mocking the SDK's parsed output rather than the wire bytes (masks the failure surface). |
| #2 | A component test that mounts the candidate-review view with fixture proposals, drives accept / reject / edit-then-accept / bulk-accept / bulk-reject, and asserts (a) correct payload persisted for accepts, (b) rejected proposals never appear in the payload, (c) edited proposals carry the edited content, (d) the visible list reflects the state change. | "The existing unit test on the pure reducer already covers accept/reject/edit." The reducer covers pure state transitions; it does NOT cover UI wiring (button → dispatch), rendering (state → visible cards), or the network call to persist accepts. The wedge is the human-decision layer, not the state machine — the human interacts with the UI, not the reducer. | Component tree that owns candidate-review state, streaming-response → reducer flow, POST payload shape when accepting, S-06 bulk-action wiring. | Component test with @testing-library/react + happy-dom (requires vitest env bump — see §4). NOT e2e; the browser adds no signal here. | Snapshot tests (break constantly, prove nothing about the accept-flow contract); asserting "dispatch was called with type=ACCEPT" (implementation mirror — refactoring the reducer shape breaks the test without breaking the product). |
| #3 | An integration test with two real Supabase users (A, B) running the actual RLS-scoped `select` / `update` / `delete` — from A's JWT context — and asserting B's rows are never returned across `cards`, `review_history`, and `profiles`. Repeat with A in soft-deleted state (retention window) to exercise the per-policy soft-delete gate. | "The endpoint's ownership check is sufficient; RLS is redundant." Defence-in-depth means: if an endpoint drops the check, RLS is the last net; testing only the endpoint doesn't verify the DB gate. Roadmap F-01 explicitly names silent-leak class as the reason RLS exists. | Which policies exist per table, how the JWT is threaded through a Vitest test using the real Supabase client (not mocked), how to seed two isolated user rows, how the soft-delete gate is written into each policy. | Integration — real client hitting local Docker Supabase (per `.dev.vars` local config); cannot be caught by mocking `supabase.from().select()`. | Mocking the Supabase client to return "the right rows" (green-lights the policy without exercising it); hitting a hosted / paused free-tier Supabase from a test. |
| #4 | A test that requests every protected route with (a) no session cookie, (b) a soft-deleted-user cookie, (c) a valid-user cookie and asserts: unauth → redirect to signin; soft-deleted → redirect to restore-account; valid → 200. Any new page added later must be exercised by the same pattern. | "If the middleware compiles and the happy path works, the gate is correct." The protected-route list is a manually maintained collection; a new page added without being registered slips through with 200 and no test catches it. | How the protected-route list is defined, how soft-deleted state is detected in the middleware, how the restore-account redirect is wired, which routes count as protected vs public. | Integration against the Astro middleware with a mocked Supabase auth context — cheaper than a browser test. E2e is warranted only for the top-level smoke (signed out → hits `/dashboard` → lands on signin), which is Phase 5. | Hard-coding the current protected-route list in the test (mirrors the implementation); testing only the happy path (valid session → 200); over-mocking the middleware such that redirects aren't actually exercised. |
| #5 | An integration test that sends N generation requests as user A inside the enforcement window and asserts request N+1 is rejected with a rate-limit error; a second test sends over-cap text and asserts pre-OpenRouter rejection. | "We can add the cap later without a test." Without a test the cap regresses silently — someone bumps a limit "just for their own testing" and forgets to revert. | PRD §Open Q2 resolution (per-user vs per-IP, daily vs per-hour, character-length limit), where the cap lives (middleware, endpoint, or DB `count` scoped by RLS), what the error shape is when the boundary rejects. | Integration against the generation endpoint with a mocked Supabase user + no real OpenRouter call for the rejection path; unit on the cap-computation function if it's extracted. | Mocking OpenRouter to always succeed and only asserting the count went up (doesn't prove the cap rejects at the boundary); testing the cap constant matches a hard-coded number (test-of-constants). |
| #6 | An integration test on the deck-mutation endpoints that (a) rejects malformed inputs (empty question, oversized answer, unknown field), (b) refuses to write a card for user B while authenticated as user A, (c) verifies edit-vs-schedule semantics per PRD Open Q3 resolution (reset the schedule or persist it — the test locks in whichever was chosen). | "The existing endpoint test already covers this." Verify what the existing test actually asserts — most likely happy-path shape only; ownership and edit-schedule semantics need separate assertions. | PRD §Open Q3 resolution, validator location, ownership-check location, cross-user Supabase client setup (shared with #3). | Integration — mostly overlaps with #3's two-user infra. Unit tests on validators are cheaper for input validation. | Asserting against the request payload rather than the persisted row after mutation (tautology); only asserting response shape without checking DB state; snapshotting the whole response body. |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder via `/10x-new`. Status moves left-to-right through the fixed vocabulary; the orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|---|---|---|---|---|---|
| 1 | Generation-flow protection (endpoint + UI) | Prove the accept/reject/edit UI contract holds under exercise, and the generation endpoint tolerates a variety of OpenRouter response shapes without silent truncation | #1, #2 | integration (endpoint + fixture), component (happy-dom + @testing-library/react) | complete | `context/changes/testing-generation-flow-protection/` |
| 2 | RLS + auth two-user integration | Prove that a second-user attack (row-level select AND write-side) is blocked in code that runs against a real Supabase — normal auth path AND soft-delete retention window | #3, #6 (write-side prep) | integration (real local Supabase, two-user seed) | not started | — |
| 3 | Middleware / route-gate coverage | Prove every protected route rejects unauth'd and soft-deleted users, and lock a pattern so any new route added later can be caught | #4 | integration (Astro middleware with mocked auth context) | not started | — |
| 4 | AI-cost cap + deck-mutation validation | Prove the AI-cost cap rejects at the boundary; prove deck-management inputs are validated; lock edit-vs-schedule semantics per PRD Open Q3 | #5, #6 | integration + unit (validators) | not started | — |
| 5 (deferred) | North-star e2e smoke | One deep guard covering signin → paste → generate → accept → review — proves the islands compose correctly end-to-end after the cheap nets are in place | cross-cutting (#1, #2, #4) | e2e (Playwright — deferred: install + MCP not yet in place) | not started | — |

**Status vocabulary** (fixed — parser literals): `not started` → `change opened` → `researched` → `planned` → `implementing` → `complete`.

**Sequencing rationale.** Phases 1–2 cover the four High-impact rows (#1–#4). Phase 1 goes first because it protects both H×H risks with a single stack bump (happy-dom + @testing-library/react); it also wires `npm test` into CI, which every subsequent phase enforces. Phase 2 opens the two-user local-Supabase pattern that Phases 3 (auth) and 4 (deck mutations write-side) inherit. Phase 5 is optional and gated on Playwright availability — may be replaced by a manual smoke checklist if the after-hours budget doesn't warrant the install.

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a `checked:` date so future readers can see which lines need re-verification.

| Layer | Tool | Version | Notes |
|---|---|---|---|
| unit + integration (runner) | Vitest | 4.1 | Configured with `environment: "node"`, include `src/**/*.test.{ts,tsx}`. Component tests need env bump — see Phase 1. |
| API mocking (network edge) | none installed yet | — | MSW or a simple fetch fixture will land in Phase 1 for OpenRouter response-variant coverage. |
| component testing | none installed yet | — | @testing-library/react + happy-dom land in Phase 1 to unlock Risk #2. |
| integration DB | local Docker Supabase | matches `supabase/config.toml` | Per `.dev.vars` (local as of 2026-07-23). Tests must never hit hosted / paused free-tier Supabase. Two-user seed pattern lands in Phase 2. |
| e2e | Playwright | — | Not installed. Land or defer in Phase 5. |
| accessibility | none scheduled | — | Not in initial rollout; UI look-and-feel exclusion covers most of the visual axis (§7). |
| (optional) AI-native | none scheduled — see negative space (§7) | n/a | Q5 excluded infrastructure over-investment; classic layer covers named risks. Re-evaluate at `--refresh`. |

**Existing test surface (sparse).** 9 test files — 6 API-endpoint tests (mocked Supabase), 2 unit-logic (`scheduler`, `proposalsReducer`), 0 component, 0 e2e. Adequate as a starting point for endpoint contracts; leaves component behaviour, RLS end-to-end, and middleware gating uncovered.

**Stack grounding tools (current session):**

- Docs: **Context7 MCP** (`mcp__context7__query-docs`, `mcp__context7__resolve-library-id`) — available; use per rollout phase to ground Astro 6 middleware / Vitest 4 env config / @testing-library/react / Supabase RLS test setup / ts-fsrs / OpenRouter response contract; checked: 2026-07-29
- Search: **Exa MCP** (`mcp__exa__web_search_exa`, `mcp__exa__web_fetch_exa`) — available; validate current AI-native tool status and framework changelogs when Context7 doesn't cover; checked: 2026-07-29
- Runtime/browser: **no Playwright MCP** in current session — must be enabled (or Playwright installed locally) before Phase 5 can run; checked: 2026-07-29
- Provider/platform: **no GitHub/Cloudflare/Supabase MCPs** in current session — `gh` CLI available via Bash; Cloudflare Observability MCP mentioned in `infrastructure.md` is not exposed here; checked: 2026-07-29

Use docs MCPs for current framework/library APIs and setup details. Use search MCPs for discovery or current status only, then prefer official docs as the evidence. Do not use MCP docs/search to infer code failure anchors; those belong in per-phase `/10x-research`.

## 5. Quality Gates

The full set of gates that must pass before a change reaches production. "Required after §3 Phase N" means the gate is enforced once that rollout phase lands; before that, the gate is `planned`.

| Gate | Where | Required? | Catches |
|---|---|---|---|
| lint | local + CI | required (already wired) | syntactic drift, react-compiler safety, project rules |
| typecheck (via `astro sync`) | local + CI | required (already wired) | type drift, i18n key drift (via `prebuild` parity script) |
| i18n key parity (`scripts/check-i18n-parity.mjs`) | CI on push/PR | required (already wired via `npm run prebuild`) | missing translation keys between `messages/pl.json` and `messages/en.json` |
| unit + integration (`npm test`) | local + CI | required (this phase); scope expands with §3 Phase 2 (RLS integration) and §3 Phase 4 (validators + cap) | logic regressions, contract drift, RLS gaps, cost-cap regression, input-validation drift |
| e2e on critical flows | CI on PR | required after §3 Phase 5 (may be replaced by a manual smoke checklist if Playwright isn't wired in the after-hours budget) | broken critical user paths at the island-composition seam |
| post-edit hook | local (agent loop) | recommended local (setup lives outside this plan — configured in a later Module 3 lesson) | regressions at edit time before commit |
| visual diff (deterministic) | CI on PR | not scheduled — see §7 negative space | rendering regressions on look-and-feel |
| multimodal visual review | CI on PR | not scheduled — see §7 negative space | visual issues classic diff misses |
| pre-prod smoke | between merge + deploy | not scheduled | environment-specific failures |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once the relevant rollout phase ships; before that, the sub-section reads "TBD — see §3 Phase N."

### 6.1 Adding an integration test for an API endpoint with an external LLM call

- **Fixture location**: `src/test/fixtures/generate-stream.ts` exports named factories per wire variant — `successResponse`, `truncatedResponse`, `malformedSuffixResponse`, `errorResponse`, `partialThenErrorResponse`. Each returns a `Response` with a hand-crafted `ReadableStream<Uint8Array>` body (or a JSON error body). Add a new variant by exporting one more factory from this module.
- **Mocking rule**: mock the AI SDK's `generateProposals` module at import boundary via `vi.mock('@/lib/ai/generate-proposals')` — never mock at OpenRouter SSE / wire level (the SDK abstracts that server-side, so drift surfaces as SDK-level exceptions, not new wire formats). Endpoint tests exercise the endpoint's try/catch by stubbing `generateProposals()` return / throw signatures — the wire-fixture module supplies the `Response` bodies the *client hook* consumes, not the endpoint.
- **Reference test**: `src/pages/api/generate.test.ts` — happy path, provider throw → `502 GENERATION_FAILED`, timeout via fake timers → `504 GENERATION_TIMEOUT`.
- **How to add a variant**: export a new factory from `src/test/fixtures/generate-stream.ts`, then reference it from a test via `vi.mocked(generateProposals).mockImplementationOnce(...)` (endpoint) or `vi.stubGlobal('fetch', vi.fn().mockResolvedValue(variant()))` (client hook).
- **Project**: `node` (endpoint tests are `.test.ts`).

### 6.2 Adding a component test for a React island (accept/reject/edit-style contracts)

- **Project & naming**: component tests live in the `dom` Vitest project (`happy-dom` environment) and are named `.test.tsx`. The include-glob split in `vitest.config.ts` guarantees `.test.tsx` runs under DOM; `.test.ts` stays under `node`.
- **Rendering an island**: import the React component directly from `src/components/**/*.tsx` and mount with `render` from `@testing-library/react` — no Astro-page wrapper needed (islands are already plain React trees). Drive user actions with `userEvent` from `@testing-library/user-event`.
- **Mocking fetch**: `vi.stubGlobal('fetch', vi.fn())` in `beforeEach`; return responses via the wire-fixture module (`@/test/fixtures/generate-stream`) for `/api/generate`, and simple `Response`-wrapped JSON for other endpoints. `vi.unstubAllGlobals()` in `afterEach`.
- **Reference test**: `src/components/generate/GeneratePanel.test.tsx` — accept, reject, edit-then-accept, bulk-accept, bulk-reject.
- **Assertion style**: assert on visible UI (`screen.findByRole`, text content) and outbound fetch payloads (`vi.mocked(fetch).mock.calls`). Do **not** assert on dispatch call signatures or internal reducer state — that mirrors the implementation and breaks on refactor without breaking the product (see §2 Risk #2 anti-pattern).

### 6.3 Adding a two-user RLS regression test

- TBD — see §3 Phase 2 (real local Supabase, two-user seed helper; asserts B's rows never leak into A's queries — normal path AND retention window).

### 6.4 Adding a middleware / protected-route gate test

- TBD — see §3 Phase 3 (Astro middleware with mocked auth context; every protected route × three session states).

### 6.5 Adding an input-validator or cost-cap boundary test

- TBD — see §3 Phase 4 (unit on validator; integration on cap-boundary rejection).

### 6.6 Adding an e2e smoke of the north-star flow

- TBD — see §3 Phase 5 (deferred; may resolve to a documented manual smoke checklist if Playwright isn't wired).

### 6.7 Per-rollout-phase notes

(After each phase lands, `/10x-implement` appends a 2–3 line note here capturing anything surprising the rollout phase taught — fixture location, reusable helpers, config gotchas.)

**Phase 1 rollout note (2026-07-29)**

- Wire fixtures live in `src/test/fixtures/generate-stream.ts` — one named factory per response-body variant; both endpoint (via mocked `generateProposals` SDK-shape) and hook (via `vi.stubGlobal('fetch')`) tests consume them.
- `@testing-library/react` v16 supports React 19 but requires `@testing-library/dom` as an **explicit peer dep** (not transitive). `@testing-library/user-event` is likewise a separate install. `happy-dom` v19 covers Radix `AlertDialog` (no polyfills needed).
- Vitest 4 `projects` migration: each project entry **must** set `extends: true` so the top-level `resolve.alias` (`@` → `./src`) is inherited — without it, in-project imports break silently. Naming split: `.test.ts` → node project; `.test.tsx` → dom project.

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future contributors should respect these unless the underlying assumption changes.

- **shadcn/ui primitives under `src/components/ui/`** — variants are effectively upstream code, and the 18 commits/30d there is generator churn, not authored behaviour. Re-evaluate if we start authoring bespoke UI primitives outside the shadcn pattern. (Source: Phase 2 interview Q5 — "no infrastructure over-investment".)
- **UI look-and-feel, visual polish, theme tokens** — no automated visual regression, no snapshot tests of styling, no cross-browser matrix. Manual review is the mechanism. Re-evaluate if a shipped visual regression causes a paid-user support ticket. (Source: Phase 2 interview Q5 — "no testing UI look and feel".)
- **Marketing landing (`src/pages/index.astro`)** — no test; low blast radius, no user data. Re-evaluate if it gains user-input surface (waitlist, contact form) or a paywall CTA.
- **Meta-tests on test configuration** — no assertions that Vitest is configured, no wrapper tests around `scripts/check-i18n-parity.mjs`. The tools ARE the test. Re-evaluate never. (Source: Phase 2 interview Q5 — "no testing configuration".)
- **30-second p95 NFR (PRD §NFR "Response time")** — observability / alerting concern, not test-time. Re-evaluate if we add SLO tooling in a future lesson.
- **AI-native scenario / vision-review layer in the initial rollout** — the classic-layer nets in §3 cover the named risks cheaper and more deterministically. Re-evaluate at `--refresh` if a real signal-gap surfaces the classic layer can't reach.
- **Snapshot tests, Percy/Chromatic, cross-browser Playwright matrix** — not scheduled. Re-evaluate at `--refresh`.

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-07-29
- Stack versions last verified: 2026-07-29
- AI-native tool references last verified: 2026-07-29

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
