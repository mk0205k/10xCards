# Implementation Review Criteria

How to review an implementation against the plan it claims to realize: the comparison operation and the judgment criteria, end to end.

**This document assumes you already have both inputs in hand** — the plan's content, and the implementation as a set of changed files (source + tests). It does **not** cover how to find the plan, compute a diff, read files, run a harness, or publish results. It covers only the review itself: what to compare, how to judge it, and how to express the verdict and findings.

The governing principle throughout: **the plan is the ground truth.** Every judgment traces back to what the plan declared — its intended changes, its success criteria, and its explicit exclusions. Don't invent standards the plan didn't commit to; enforce the ones it did.

## Inputs

- **The plan** — its full text.
- **The implementation** — the changed files. Split them into `source_files` and `test_files`; keep the plan file itself out of both.

## Read the plan as the baseline

Before comparing anything, extract the plan's commitments. Plans follow a conventional markdown structure (heading levels may vary):

- **`## Phase N:` blocks** — each phase contains its own Changes Required and Success Criteria.
- **`### Changes Required`** (or `#### Changes`) — file paths and what should change in each. This is the authoritative list of planned work.
- **`### Success Criteria`** — usually two subsections:
  - **Automated Verification** — `` - [ ] `command` `` checkboxes: runnable commands (tests, lint, build, typecheck). Unchecked = pending; checked = author claims it passes.
  - **Manual Verification** — prose checkboxes (`- [ ] UI renders correctly`, `- [ ] Migration applied on staging`). Soft commitments; useful for observing what the author believes they did.
- **`## What We're NOT Doing`** (or "Out of scope", "Non-goals") — work the author deliberately excluded. Anything matching these is **not** scope creep.

Extract five things you'll compare against:

1. **Planned file paths** — union of all files mentioned under Changes Required across all phases.
2. **Automated Verification commands** — every backticked command under Success Criteria.
3. **Manual Verification claims** — the prose checkboxes and whether they're checked.
4. **Exclusions** — the "What We're NOT Doing" list.
5. **Architectural decisions** — callouts about patterns, constraints, or tradeoffs the plan explicitly made.

If the plan doesn't follow this shape, work with what's there — extract whatever lists of files, commands, or constraints you can find, and note that the plan structure was non-standard so findings may be less precise. Partial signal beats no signal; don't refuse to review.

### Cross-reference changed files against planned files

This is the first, coarsest comparison:

- **In plan AND in implementation** → expected change; verify the intent matches (drift check below).
- **In implementation but NOT in plan** → unplanned addition; check it against the exclusions list, then flag as scope creep if it isn't explicitly excluded.
- **In plan but NOT in implementation** → possibly missing work; flag.

## The review dimensions

Three independent analyses make up the comparison. Each looks at a different facet of "does the implementation faithfully and safely realize the plan."

### 1. Plan drift

For each planned change, read the actual file and verify the implementation matches the declared intent. Assign one verdict per planned change:

- **MATCH** — implemented as described.
- **DRIFT** — implemented differently (a semantic mismatch, not just formatting).
- **MISSING** — planned but absent from the implementation.
- **EXTRA** — present in the implementation but not in the plan, and not on the exclusions list.

Per finding, record: file path, plan quote, actual state, verdict, brief rationale.

### 2. Safety, quality, and pattern compliance

Look at the changed source files (exclude test files and the plan file). Three categories:

**Safety & quality:**

- **Security** — injection (SQL, command, XSS), hardcoded secrets, missing authn/authz at system boundaries, overly permissive CORS or file permissions.
- **Performance** — N+1 queries, unbounded iteration or recursion, missing pagination, unnecessary synchronous I/O.
- **Reliability** — missing error handling at external boundaries (API calls, file I/O, DB, network), race conditions, resource leaks.
- **Data safety** — destructive DB operations without rollback, schema changes without a migration path, data-loss potential.

**Pattern compliance** — for each changed file, find 1–2 similar existing files in the same package/module and compare naming conventions, error-handling style, module structure, imports/exports, test structure, and config patterns. Report only **substantive** mismatches (a new module using a different case convention than its siblings; a new endpoint skipping the auth middleware the rest of the API uses). Skip trivial style differences.

**Scale pattern depth to change size** — with ≤3 files changed, pattern comparison has little signal; spend minimal effort there.

Per finding: file, line number, category (security / perf / reliability / data / pattern), severity (CRITICAL / WARNING / OBSERVATION), description, suggested fix.

### 3. Test coverage

The operating principle: **the plan declares what "tested" means for this PR.** Enforce the commitments the author made; don't impose coverage standards they didn't.

1. **Extract test commitments from Success Criteria:**
   - Each Automated Verification `` - [ ] `<command>` `` whose command looks test-related (contains `test`, `spec`, `vitest`, `jest`, `pytest`, `go test`, `cargo test`, `rspec`, etc.).
   - Each Manual Verification phrase mentioning tests ("added unit test for X", "integration test covers Y", "all tests pass").

2. **Match each commitment to implementation artifacts.** For every test command naming a specific file, that file must appear in `test_files`. If the plan says `pnpm test -- src/auth/handler.test.ts` but that file isn't among the changed files, that's a **MISSING TEST** (severity FAIL).

3. **Scan for uncovered new behavior.** For each file in `source_files`, identify new exported functions, new branches/error paths, new endpoints, new public interfaces. For each, search `test_files` for the symbol, endpoint path, or behavior keyword. Gaps → **UNCOVERED BEHAVIOR** (severity WARNING). Be judicious: trivial additions (a new constant, a one-line helper) don't need tests; new behavior does.

4. **Run the plan's automated test commands.** Run each test-related command and capture its exit code. Non-zero → **FAILING TEST** (severity FAIL).

5. **Respect explicit opt-outs.** If the exclusions list says "no tests for this migration, verified manually" or similar, don't flag the absence of tests for the named work.

Per finding: category (MISSING TEST / UNCOVERED BEHAVIOR / FAILING TEST / SHALLOW TEST), severity, location (source `file:line` where the untested behavior lives, or the expected test-file path for MISSING TEST), description, recommendation.

## Verify the success criteria

Beyond the test commands handled in dimension 3, run the plan's remaining Automated Verification commands — lint, build, format-check, typecheck. Record each command's pass/fail and a truncated output excerpt. A failing non-test check is a Success Criteria FAIL.

For Manual Verification checkboxes: note which are `- [x]` vs. `- [ ]`. A checked item with no observable evidence in the implementation (e.g. the author claims "UI tested on Safari" but there are no UI changes) is worth flagging as an OBSERVATION. Unchecked items are simply pending — not a failure.

## Grade each dimension

Assign PASS / WARNING / FAIL to each of seven dimensions:

- **Plan Adherence** — FAIL on any MISSING or major DRIFT finding. WARNING on minor DRIFT.
- **Scope Discipline** — FAIL if substantive unplanned changes contradict the exclusions list. WARNING if EXTRA changes exist but are benign (e.g. a helper used only by planned code).
- **Safety & Quality** — FAIL on any CRITICAL finding. WARNING on WARNING-severity findings only.
- **Architecture** — FAIL on module boundary violations, dependency-direction violations, or unjustified new abstractions that contradict the plan.
- **Pattern Consistency** — WARNING on substantive inconsistencies with sibling code. Rarely a FAIL unless the inconsistency breaks something.
- **Test Coverage** — FAIL on any MISSING TEST or FAILING TEST. WARNING on UNCOVERED BEHAVIOR or SHALLOW TEST. PASS when the plan's test commitments are all met and no obvious gaps remain.
- **Success Criteria** — FAIL on any non-test automated check failing. WARNING on suspicious Manual Verification claims.

### Overall verdict

- **APPROVED** — all PASS, or PASS with at most 2 minor warnings total.
- **NEEDS ATTENTION** — multiple warnings, or a single non-critical FAIL.
- **REJECTED** — any critical FAIL: a security issue, major plan drift, a data-safety problem, failing tests, or missing tests the plan committed to.

## Express the findings

Normalize the three dimensions' output into a single findings list. Sort by severity (CRITICAL → WARNING → OBSERVATION). Cap at 10 — consolidate related issues ("6 files use the wrong case convention" → one finding, not six).

### Finding shape

Each finding records:

- **ID** — F1, F2, F3, …
- **Severity** — CRITICAL / WARNING / OBSERVATION (how bad if ignored).
- **Impact** — LOW / MEDIUM / HIGH (how much reviewer attention the decision needs). Orthogonal to severity.
- **Dimension** — one of the seven above.
- **Title** — one short line.
- **Location** — `file:line` or `file` (or "N/A" when the issue is something missing).
- **Detail** — what's wrong, with evidence: plan quote vs. actual behavior, or code excerpt vs. expected.
- **Fix** — one or two options (grammar below).

### Impact grammar

| Impact | Meaning |
|---|---|
| 🏃 **LOW** | Quick decision. Fix is obvious and narrowly scoped. Safe to batch. |
| 🔎 **MEDIUM** | Worth pausing. Real tradeoff or non-trivial edit — think before deciding. |
| 🔬 **HIGH** | Architectural stakes. Wide blast radius, strategic implications, or unclear best path. |

Always pair the impact level with its one-line meaning — a reader shouldn't need to memorize a table.

### Fix-options grammar

**Default to one fix.** Offer two only when there's a genuine tradeoff a thoughtful reviewer would weigh ("patch the call site" vs. "fix at the source"). Inventing a weak second option is noise.

**LOW-impact findings** — a single one-line fix, nothing more:

```markdown
- **Fix**: Replace the template literal with a parameterized query using db.query($1, [value]).
```

**MEDIUM or HIGH impact** — each option gets structured reasoning:

```markdown
- **Fix**: [one-sentence approach]
  - Strength: [the advantage, grounded in code or plan evidence]
  - Tradeoff: [cost, risk, or caveat]
  - Confidence: HIGH | MEDIUM | LOW — [one line why]
  - Blind spot: [what you haven't verified, or "None significant"]
```

When offering two options, mark exactly one as `⭐ Recommended`:

```markdown
- **Fix A ⭐ Recommended**: [approach]
  - Strength: …
  - Tradeoff: …
  - Confidence: HIGH — …
  - Blind spot: …
- **Fix B**: [alternative approach]
  - Strength: …
  - Tradeoff: …
  - Confidence: MEDIUM — …
  - Blind spot: …
```

### Why this grammar

Severity says "how bad"; Impact says "how hard to decide". Pairing them lets a reviewer triage fast: CRITICAL + LOW is an obvious one-line fix to batch; WARNING + HIGH is an architectural conversation that deserves careful thought. Without the split, reviewers either treat every finding as urgent (noise) or dismiss warnings as low-priority (missing the genuine strategic calls).

The Strength / Tradeoff / Confidence / Blind spot template forces explicit reasoning — it's too easy to write a fix that hides its assumptions. Naming what you haven't verified ("Blind spot") is often the most important field.

### Severity / impact icons (always paired with words)

- Severity: ❌ CRITICAL · ⚠️ WARNING · 👁 OBSERVATION
- Impact: 🏃 LOW · 🔎 MEDIUM · 🔬 HIGH

Never use a bare icon without its label.

## Summarize the verdict

Present the seven dimension verdicts as a table, alongside the overall verdict and the finding counts:

```markdown
| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS / WARNING / FAIL |
| Scope Discipline | PASS / WARNING / FAIL |
| Safety & Quality | PASS / WARNING / FAIL |
| Architecture | PASS / WARNING / FAIL |
| Pattern Consistency | PASS / WARNING / FAIL |
| Test Coverage | PASS / WARNING / FAIL |
| Success Criteria | PASS / WARNING / FAIL |
```

The table always lists all seven dimensions even when some have zero findings; the findings list shows only the dimensions that produced findings.
