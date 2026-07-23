<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: UX Improvements (S-06)

- **Plan**: context/changes/ux-improvements/plan.md
- **Scope**: Full plan (4 of 4 phases)
- **Date**: 2026-07-23
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — `aria-live` region conditionally mounted; early progress updates may not be announced

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/generate/GeneratePanel.tsx:110, 116, 134
- **Detail**: `showBulkBar = pendingCount > 0 || bulkAcceptInProgress !== null`. The `aria-live="polite"` progress region on line 134 sits inside the `{showBulkBar && ...}` guard, so it mounts at the same tick as its first content (`Saving: 0 / N`). Several screen readers only announce **changes** to an already-observed live region — the initial announcement can be dropped. The plan explicitly called for a persistent progress region.
- **Fix**: Hoist the `aria-live` region above the `showBulkBar` conditional so it's always mounted (empty string when idle). Alternatively, render the bar itself unconditionally with the buttons disabled when `pendingCount === 0` and `bulkAcceptInProgress === null`.
- **Decision**: FIXED — persistent `aria-live` region wyniesiony poza `showBulkBar`, umieszczony jako `sr-only` obok panelu bulk.

### F2 — `ReviewSession` reset race with in-flight `fetchNext` / `rateCard`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/review/ReviewSession.tsx:74-95, 105-114 (onReset, loadNext, onRate)
- **Detail**: `onReset` dispatches `reset` then fires `void loadNext()` — no cancellation. If a request from the initial `useEffect` or a mid-`onRate` `loadNext` is still in-flight when the user clicks reset, its response will land after the reset dispatch and overwrite the freshly-reset state. In practice both requests hit the same endpoint and typically resolve to the same card, so the user rarely notices — but a slow network + reset + rating in flight can render an unexpected card or override the reset. `DeckPanel` already has the same pattern solved with a `cancelled` closure flag (line 87-101).
- **Fix**: Add a monotonically-increasing generation counter (`useRef(0)`) captured at each request; on `loaded`/`error` dispatch, ignore results whose generation doesn't match current. Or use an `AbortController` per request and abort on reset.
  - Strength: Deterministic — matches `DeckPanel`'s cancelled-flag idiom already in the codebase.
  - Tradeoff: Adds one ref + a check at each dispatch site. Small.
  - Confidence: HIGH — well-understood pattern.
  - Blind spot: If the endpoint has side effects on the server per fetch, aborting client-side still leaves those; not our concern today.
- **Decision**: FIXED — dodany `generationRef = useRef(0)`; `onReset` inkrementuje generation przed dispatch; `loadNext` i `onRate` capturują generation na starcie i porzucają dispatch, gdy nie odpowiada bieżącej.

### F3 — `Spinner` hardcodes `text-white/70`; breaks contrast on light surfaces

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/ui/spinner.tsx:21
- **Detail**: The wrapper icon uses a hardcoded color: `className={cn("animate-spin text-white/70", SIZE_CLASSES[size])}`. All current call sites live on the glassmorph dark surface where this happens to work, but any future light background use will produce a near-invisible spinner. The caller's `className` prop can add classes but cannot override the color cleanly (Tailwind merge is via `cn`, so `text-*` from caller wins, but the pattern makes color-override footgun-y).
- **Fix**: Replace `text-white/70` with `text-current` on the `Loader2`; let callers set color via the wrapper's `className` if they want. Same visual result today; portable.
- **Decision**: FIXED — `text-white/70` → `text-current`; kolor dziedziczony od rodzica.

### F4 — `Alert` warning variant defaults to `role="alert"` (assertive/interrupts)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/ui/alert.tsx:29
- **Detail**: `const resolvedRole = role ?? (variant === "info" ? "status" : "alert");` — `warning` falls into `alert` (assertive AT interrupt). Warnings are usually informational rather than interruption-worthy. The plan didn't explicitly disambiguate warning; the safety review flagged this as a real ambiguity.
- **Fix**: Change the fallback so only `error` defaults to `role="alert"`; both `warning` and `info` default to `role="status"`. Callers can pass `role="alert"` explicitly for critical warnings.
- **Decision**: FIXED — `role ?? (variant === "error" ? "alert" : "status")`; tylko `error` przerywa domyślnie.

### O1 — `Spinner` emits `role="status"` with no accessible content when `label` omitted

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/ui/spinner.tsx:18-25
- **Detail**: Every Spinner emits `role="status"` on its wrapper even when `label` is undefined (e.g. inline inside a labeled button in `ProposalCard.tsx:108`). Empty live regions can be announced as noise by some screen readers. Not broken — the surrounding button carries the visible label — but avoidable.
- **Fix**: Only set `role="status"` when `label` is provided; when the spinner is decorative inside a labeled parent, mark the wrapper `aria-hidden="true"`.
- **Decision**: FIXED — `role="status"` renderowane tylko gdy label; bez label wrapper dostaje `aria-hidden="true"`.

### O2 — `EmptyState` title renders as `<p>`, not a heading

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/ui/empty-state.tsx:21
- **Detail**: `<p className="text-lg font-medium text-white">{title}</p>`. Since `title` is a required field expressing the empty state's meaning ("Session complete", "Your deck is empty"), screen-reader users cannot reach it via heading navigation. shadcn conventions vary here, so it's a judgment call.
- **Fix**: Render title as `<h2>` (or expose an `as` prop for callers to opt into the right heading level). Non-blocking.
- **Decision**: FIXED — title renderowany jako `<h2>`.

### O3 — `Math.min` clamp on bulk-accept progress hides potential drift

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/generate/GeneratePanel.tsx:93-95
- **Detail**: `setBulkAcceptInProgress((prev) => prev ? { ...prev, done: Math.min(prev.done + chunk.length, prev.total) } : null);` — the `Math.min` clamp against `prev.total` is defensive but structurally unnecessary: `pending.length === Σ chunk.length` by construction. If the numbers ever diverge (bug in slicing/loop), the clamp would silently mask it in the announcement.
- **Fix**: Drop the `Math.min`; keep the raw sum. Optional cleanup.
- **Decision**: FIXED — usunięty `Math.min`; postęp to czysta suma `prev.done + chunk.length`.
