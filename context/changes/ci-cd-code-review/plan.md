# Wire `packages/code-reviewer` into CI/CD — Implementation Plan

## Overview

Wire the already-built, tested `packages/code-reviewer` CLI into GitHub Actions so that every non-fork, non-draft pull request targeting `master` triggers an automated AI review against the six criteria frozen in `context/changes/ci-cd-code-review/requirements.md`. The review lands as a single markdown comment on the PR. Version 1 is **advisory only** — the job never fails the CI check and the reviewer's verdict is not a required check.

## Current State Analysis

- **Reviewer package is CI-ready but unwired.** `packages/code-reviewer/src/cli.ts:42-45` already detects GitHub Actions (`GITHUB_ACTIONS`, `PR_NUMBER`, `GITHUB_REPOSITORY`), reads PR title/description from env (`PR_TITLE`, `PR_DESCRIPTION`), takes the unified diff from stdin, and posts back via `gh pr comment` (`packages/code-reviewer/src/tools/post-pr-comment.ts:43-56`). Default model is `anthropic/claude-sonnet-4.5` (`packages/code-reviewer/src/provider/openrouter.ts:18`).
- **The 6-criteria contract is authoritative.** `packages/code-reviewer/src/schemas/review.ts:31-62` defines the exact six criteria (implementationCorrectness, idiomaticity, complexity, testRiskCoverage, documentation, securitySafety), each with a 1/10-anchored rubric that matches `context/changes/ci-cd-code-review/requirements.md` verbatim.
- **Existing CI is minimal and healthy.** `.github/workflows/ci.yml` has one `ci` job (lint / typecheck / vitest / build on PRs + master pushes) and one `deploy` job (Cloudflare Workers on master pushes only). No `permissions:` block; no `CODEOWNERS`; no branch protection; no `OPENROUTER_API_KEY` in repo secrets.
- **The reviewer is not an npm workspace member.** Root `package.json` has no `workspaces` field; `packages/code-reviewer/package-lock.json` is independent. The workflow must run its own `npm ci` inside that package.
- **Verdict is model-authored.** `packages/code-reviewer/src/agent/review-runner.ts:125-143` reads `verdict` from the model's `postCodeReview` tool-call input; no threshold logic exists in code. Any pass/fail enforcement is a CI-side decision.
- **Truncation is caller-side.** The reviewer only *annotates* the comment when `DIFF_TRUNCATED=true` (hard-coded string `"Diff truncated at 3000 lines — this review is partial."` at `packages/code-reviewer/src/render/comment.ts:42`); the CLI itself does not truncate stdin.

### Key Discoveries

- `packages/code-reviewer/src/cli.ts:24-30` — reviewer reads diff from stdin *deliberately* to avoid argv/env size limits and shell escaping of attacker-controlled diff text. Any workflow must feed the diff on stdin, never via argv or env.
- `packages/code-reviewer/src/tools/post-pr-comment.ts:43-56` — comments are posted by shelling out to `gh pr comment <PR_NUMBER> --body-file <temp>`. `gh` authenticates from `GH_TOKEN` or `GITHUB_TOKEN` in the ambient env.
- `packages/code-reviewer/src/prompts/review-runner.md:3-13` — STEP 1 (code review) is unconditional and always posts one comment; STEP 2 (plan review) is strict-by-default and only fires when the PR body/diff contains an explicit `Plan: <id>` or `context/changes/<id>/plan.md` reference. This gate stays as-is in v1.
- `packages/code-reviewer/src/render/comment.ts:42` — the exact string `"Diff truncated at 3000 lines — this review is partial."` is the truncation convention. Our workflow truncates at 3000 lines and sets `DIFF_TRUNCATED=true` to match.
- `.github/workflows/ci.yml:1-27` — existing pipeline uses Node 22 + npm cache, ubuntu-latest, and reads secrets `SUPABASE_URL` / `SUPABASE_KEY` / `PUBLIC_SITE_URL`. No `OPENROUTER_API_KEY` and no `permissions:` block yet.

## Desired End State

When this plan is complete:

- A new workflow file `.github/workflows/pr-review.yml` exists and is enabled.
- On every non-draft, non-fork PR opened (or synchronized, reopened, or converted to ready-for-review) against `master`, a new job named "AI code review (advisory)" runs. It computes a filtered unified diff of the PR (excluding `**/package-lock.json`, `src/paraglide/**`, `messages/*.json`, and `worker-configuration.d.ts`), truncates at 3000 lines with `DIFF_TRUNCATED=true` when applicable, and invokes `packages/code-reviewer` via `npx tsx src/cli.ts`.
- The reviewer posts exactly one markdown comment to the PR (or two, if the PR body explicitly references a plan), containing the six-criteria table, per-criterion rationale, the model's verdict, and its summary.
- The job step is `continue-on-error: true`, so a reviewer failure or a `verdict: "fail"` never blocks the required `ci` check.
- A single new secret `OPENROUTER_API_KEY` is added to the repository at Settings → Secrets and variables → Actions.
- No changes are made to `.github/workflows/ci.yml`, to `packages/code-reviewer/` source, to `requirements.md`, or to branch protection.

Verification: open a trivial PR against `master`, wait ≤ 3 minutes, observe the reviewer comment with the six-criteria table and a verdict badge; the `ci` job stays required and green; the new "AI code review (advisory)" job appears as informational.

## What We're NOT Doing

- **No changes to the reviewer package code.** No new tools, no schema tweaks, no prompt edits. If a v2 wants `--edit-last-comment` or a score-threshold rule, that lands as a separate change.
- **No changes to `.github/workflows/ci.yml`.** The new workflow is a sibling, not a replacement or an extension.
- **No blocking / required-check enforcement.** V1 is advisory only. Flipping to required is a separate future change after ~10 real PRs of observed behavior.
- **No branch protection setup.** Repository has none today; introducing it is out of scope.
- **No `CODEOWNERS`, PR template edits, or `dependabot.yml`.** Nice-to-have but not needed to land the reviewer.
- **No model swap or `OPENROUTER_MODEL` pin.** We accept the package default (`anthropic/claude-sonnet-4.5`).
- **No fork-PR support.** Cross-fork PRs are explicitly skipped via a job-level `if:`. Enabling forks would require `pull_request_target` with hardened checkout, which is a separate risk conversation.
- **No comment idempotency / dedup.** V1 accepts append-on-rerun; if noise becomes a problem, dedup lands as a follow-up.
- **No hoisting of `impl-review-instructions.md` out of the package.** The reviewer resolves that path relative to its own package root; leaving it in place is the cheapest v1.
- **No cost budgeting or per-PR spend cap in CI.** OpenRouter usage is monitored out-of-band.
- **No e2e integration.** Playwright e2e in CI is deferred to a separate follow-up change.

## Implementation Approach

Three phases, in order:

1. **Repo prep** — add the `OPENROUTER_API_KEY` secret and verify the reviewer runs end-to-end locally in a CI-shape (no external calls beyond OpenRouter and no comment posted).
2. **Workflow file** — write `.github/workflows/pr-review.yml` with the triggers, permissions, fork-guard, diff-computation, truncation, and reviewer invocation. Commit and push.
3. **Live smoke test** — open a trivial doc-only PR against `master` and verify the reviewer comment lands with the expected shape.

Everything else the reviewer needs (Node 22, `tsx`, OpenRouter client, `gh` CLI) is either pre-installed on `ubuntu-latest` runners or brought in by `npm ci` in the reviewer package.

## Critical Implementation Details

- **Never interpolate `${{ github.event.pull_request.title }}` or `.body` directly into `run:` shell.** PR title and body are attacker-controlled — any `${{ ... }}` inside a `run:` script is a shell-injection vector. Both must be passed via the step's `env:` block (GitHub Actions escapes env values correctly); the reviewer CLI reads `PR_TITLE` and `PR_DESCRIPTION` from `process.env`, so no CLI flags are needed.
- **Feed the diff on stdin.** `packages/code-reviewer/src/cli.ts:24-30` is the load-bearing choice — argv/env would truncate on large diffs and shell-escape unpredictably on attacker-controlled diff hunks. The workflow pipes into `npx tsx src/cli.ts`.
- **Truncate at exactly 3000 lines with `DIFF_TRUNCATED=true`.** The reviewer's own render layer hard-codes the string `"Diff truncated at 3000 lines"` (`packages/code-reviewer/src/render/comment.ts:42`); using a different cap makes the annotation lie.
- **Base ref must be fetched.** `actions/checkout@v4` with `fetch-depth: 0` fetches history for the checked-out ref, but the base branch tip may still be absent. An explicit `git fetch --no-tags --depth=100 origin "$BASE_REF"` before the diff is safer than relying on `fetch-depth: 0` alone.
- **Fork guard is a two-condition `if:`.** `!github.event.pull_request.draft` (skip drafts) *and* `github.event.pull_request.head.repo.full_name == github.repository` (skip cross-fork PRs). Both belong on the *job*, not the step, so the entire runner is spared on skips.

## Phase 1: Repo Prep — `OPENROUTER_API_KEY` Secret

### Overview

Add the OpenRouter API key to GitHub repository secrets so the future workflow can authenticate against `openrouter.ai`. Verify the reviewer runs end-to-end against a synthetic PR shape without posting a comment.

### Changes Required

#### 1. New GitHub Actions secret

**File**: Repository settings (no file in the repo).

**Intent**: Make `OPENROUTER_API_KEY` available to the `pr-review` workflow as `${{ secrets.OPENROUTER_API_KEY }}`. Without this the reviewer errors immediately at provider setup (`packages/code-reviewer/src/provider/openrouter.ts:31-36`).

**Contract**: A repository-level secret named exactly `OPENROUTER_API_KEY` with a value that is a valid OpenRouter API key (`sk-or-v1-...`). Not an environment or organization secret. Command:

```bash
gh secret set OPENROUTER_API_KEY --repo mk0205k/10xCards --body '<paste-key-here>'
# Sanity check (does not print the value):
gh secret list --repo mk0205k/10xCards | grep OPENROUTER_API_KEY
```

#### 2. Local dry-run of the reviewer CLI

**File**: No file changes; a local verification step only.

**Intent**: Confirm the CLI works end-to-end on the developer's machine with the same env variables the workflow will provide, minus the ones that would cause a real PR comment. This catches "wrong Node version" / "missing gh auth" / "wrong key" *before* the workflow lands.

**Contract**: `packages/code-reviewer/src/cli.ts` runs, prints `{"verdict": "..."}` to stdout, and exits 0. Because `PR_NUMBER` is unset and `GITHUB_ACTIONS` is unset, the `postCodeReview` tool call is expected to still be made by the model but the underlying `gh pr comment` may fail — this is fine for a dry-run. Command (from the repo root):

```bash
cd packages/code-reviewer
export OPENROUTER_API_KEY="sk-or-v1-..." # local, not committed
export PR_TITLE="dry-run test"
export PR_DESCRIPTION="local verification of the reviewer CLI"
# No PR_NUMBER, no GITHUB_ACTIONS — this simulates a non-CI invocation.
git -C .. diff HEAD~1...HEAD -- . ':(exclude)**/package-lock.json' | npx tsx src/cli.ts
```

Success is: process exits 0 within a couple of minutes, stdout contains a `{"verdict":"pass"|"fail"}` JSON line. `gh pr comment` errors are acceptable in this step.

### Success Criteria

#### Automated Verification

- `gh secret list --repo mk0205k/10xCards` includes `OPENROUTER_API_KEY`.
- `cd packages/code-reviewer && npm ci` completes without error on Node 22.
- The local dry-run command above exits 0 within 3 minutes and prints a JSON object with a `verdict` key.

#### Manual Verification

- The value stored in the secret is a fresh OpenRouter key with sufficient credit for at least ~50 PRs of Sonnet 4.5 reviews.
- The key is *not* accidentally committed to any `.env` file inside the repo (grep for the prefix `sk-or-v1-` returns nothing under version control).

**Implementation Note**: After Phase 1 passes and manual verification confirms the key works and is not committed, proceed to Phase 2.

---

## Phase 2: New Workflow `.github/workflows/pr-review.yml`

### Overview

Author a new GitHub Actions workflow that runs the reviewer on every eligible PR. Advisory only: the reviewer's failure or `verdict: "fail"` never blocks the required `ci` check.

### Changes Required

#### 1. New workflow file

**File**: `.github/workflows/pr-review.yml`

**Intent**: On every non-draft, non-fork PR against `master`, install the reviewer's deps, compute a filtered diff, truncate at 3000 lines if needed, and pipe it into `packages/code-reviewer` via stdin. The reviewer posts a comment back to the PR. The job step is `continue-on-error: true` so its result never blocks merge.

**Contract**: A workflow named `PR Review` with a single job `review` gated by two `if:` conditions (skip drafts and skip forks). Job needs `permissions: pull-requests: write, contents: read`. Concurrency group per PR with `cancel-in-progress: true`. Timeout 10 minutes. Full file (verbatim):

```yaml
name: PR Review

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
    branches: [master]

permissions:
  pull-requests: write
  contents: read

concurrency:
  group: pr-review-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  review:
    name: AI code review (advisory)
    if: >-
      !github.event.pull_request.draft &&
      github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Checkout PR head
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Fetch base ref
        env:
          BASE_REF: ${{ github.event.pull_request.base.ref }}
        run: git fetch --no-tags --depth=100 origin "$BASE_REF"

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: packages/code-reviewer/package-lock.json

      - name: Install reviewer dependencies
        working-directory: packages/code-reviewer
        run: npm ci

      - name: Run AI code review
        id: review
        continue-on-error: true
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
          GITHUB_TOKEN: ${{ github.token }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
          PR_TITLE: ${{ github.event.pull_request.title }}
          PR_DESCRIPTION: ${{ github.event.pull_request.body }}
          BASE_REF: ${{ github.event.pull_request.base.ref }}
        run: |
          set -euo pipefail

          DIFF="$(git diff --no-color "origin/${BASE_REF}...HEAD" -- . \
            ':(exclude)**/package-lock.json' \
            ':(exclude)src/paraglide/**' \
            ':(exclude)messages/*.json' \
            ':(exclude)worker-configuration.d.ts')"

          LINE_COUNT="$(printf '%s\n' "$DIFF" | wc -l)"
          if [ "$LINE_COUNT" -gt 3000 ]; then
            DIFF="$(printf '%s\n' "$DIFF" | head -n 3000)"
            export DIFF_TRUNCATED=true
          fi

          printf '%s\n' "$DIFF" | (cd packages/code-reviewer && npx tsx src/cli.ts)

      - name: Advisory outcome (informational)
        if: always()
        run: |
          echo "Reviewer step outcome: ${{ steps.review.outcome }}"
          echo "This job is advisory-only in v1 — it never blocks the required ci check."
```

Why the shape above matters:

- Every `${{ ... }}` inside `run:` is either a number (`PR_NUMBER`) or otherwise safe. Attacker-controlled fields (`title`, `body`) never appear in `run:` — they're only in `env:`, where GitHub Actions escapes them.
- `working-directory:` on the install step but *not* on the review step is deliberate — the review step needs to run `git diff` against the whole repo, then `cd` into the package for `npx tsx`.
- `continue-on-error: true` on the reviewer step means the reviewer *step* can fail (`verdict: "fail"` produces exit 0 anyway, but any thrown exception exits 1), and the *job* still succeeds. Combined with GitHub's default of not gating merges on non-required checks, this is the "advisory only" contract.
- The final "Advisory outcome" step logs the reviewer step's outcome to the job summary so a rerun history is legible even when the reviewer errored out.

### Success Criteria

#### Automated Verification

- `.github/workflows/pr-review.yml` exists at the exact path.
- The workflow parses without errors: `gh workflow list --repo mk0205k/10xCards` shows `PR Review` after push.
- `actionlint .github/workflows/pr-review.yml` (or `npx @rhysd/actionlint-installer && ./actionlint`) reports zero errors.
- After commit + push, `gh run list --workflow=pr-review.yml --limit 1` returns an entry within a minute of pushing a change that would open a PR (or verified against `--json event,status` on a workflow_dispatch dry-run once opened as a PR).

#### Manual Verification

- Reading `.github/workflows/pr-review.yml`, no `${{ ... }}` interpolation of `github.event.pull_request.title` or `.body` appears inside any `run:` script — they only appear in `env:` blocks.
- The `if:` on the `review` job contains both the draft check and the fork check.
- `permissions:` is set at the workflow level; the block contains `pull-requests: write` and `contents: read` and nothing broader.
- `timeout-minutes: 10` is present on the job.

**Implementation Note**: Once Phase 2 lands on master (via a small self-review or a fixup PR), proceed to Phase 3 to validate the pipeline end-to-end.

---

## Phase 3: Live Smoke Test on a Trivial PR

### Overview

Prove the workflow works end-to-end on a real PR before trusting it in day-to-day flow. This is the only phase where we cannot verify automatically — the outcome is a working PR comment on `github.com`.

### Changes Required

#### 1. Open a doc-only smoke-test PR

**File**: A trivial PR — for example, one non-load-bearing edit under `context/foundation/` or a new placeholder file at `.github/pr-review-smoke.md`.

**Intent**: Trigger the new workflow with a minimal, obviously-safe diff so we can validate the whole pipeline (checkout → diff → truncate check → CLI → `gh pr comment`) without confusing the signal with the substance of the change under review.

**Contract**: A branch off `master` with a single-file change of < 20 lines; PR opened against `master`, not marked as draft, opened from the same repo (not a fork).

#### 2. Observe and verify

**File**: No file changes.

**Intent**: Confirm the workflow produced the expected side effect (comment on PR) with the expected content and within a reasonable time.

**Contract**: Within 3 minutes of PR open, a single new comment from `github-actions[bot]` appears on the PR body. The comment contains a verdict badge (`✅ Pass` or `❌ Fail`), a 6-row criteria table, per-criterion rationale bullets, and a summary. No `"Diff truncated"` note (this test PR is well under 3000 lines).

#### 3. Document the rollback path in change notes

**File**: `context/changes/ci-cd-code-review/change.md` (Notes section).

**Intent**: Leave a one-line rollback plan for future us so nobody has to reverse-engineer it under stress.

**Contract**: A single line added under `## Notes` of the form:

```
Rollback: `gh workflow disable pr-review.yml --repo mk0205k/10xCards` disables the reviewer without touching the workflow file. Re-enable with `gh workflow enable pr-review.yml --repo mk0205k/10xCards`.
```

### Success Criteria

#### Automated Verification

- `gh run list --workflow=pr-review.yml --limit 5` returns at least one run whose `conclusion` is `success` and whose `event` is `pull_request`.
- `gh pr view <smoke-pr-number> --json comments --jq '.comments[] | select(.author.login == "github-actions[bot]") | .body' | head -c 100` returns non-empty output containing either `Pass` or `Fail`.

#### Manual Verification

- The reviewer comment renders correctly on `github.com` (table formatting intact, verdict badge visible, no raw markdown escape artifacts).
- The `ci` job on the smoke-test PR remains required and green — the new reviewer job is present as a separate, non-required check.
- Rerun of the workflow via `gh run rerun` produces a *second* comment (confirming the accepted append-only v1 behavior — not a bug).
- OpenRouter usage dashboard shows exactly one review-shaped call per PR event (± reruns), so cost expectations are realistic.

**Implementation Note**: If any manual verification fails, disable the workflow with `gh workflow disable pr-review.yml`, open a bug-shape change (`/10x-new pr-review-<symptom>`), and diagnose before re-enabling.

---

## Testing Strategy

### Unit Tests

The reviewer package already ships with unit tests (`packages/code-reviewer/src/**/*.test.ts`) that cover schemas, rendering, tool authoring, and the agent runner. This plan adds no code to the package and therefore no new unit tests. The existing tests run under the reviewer's own `npm test` — they are not (and do not need to be) invoked from the new workflow.

### Integration Tests

The workflow itself is the integration test. `actionlint` validates syntax; Phase 3's live smoke test validates behavior. There is no cheaper integration harness for a GitHub Actions workflow that talks to `gh` and OpenRouter — attempting one (e.g., `act`) would recreate half of GitHub Actions locally without covering the parts that matter (secrets resolution, PR event payload shape, `gh` auth).

### Manual Testing Steps

1. Open the Phase 3 smoke-test PR against `master` (non-draft, from a same-repo branch).
2. Watch `gh run watch --workflow=pr-review.yml` and confirm the job appears within ~30s of PR open.
3. Once the run completes, refresh the PR page and confirm exactly one new comment from `github-actions[bot]`.
4. Inspect the comment: verdict badge, 6-row criteria table, per-criterion rationale, summary.
5. Push a follow-up commit to the same PR; confirm the concurrency group cancels the in-progress run and a new run starts (with a *new* comment — append-only in v1).
6. Convert the PR to draft; push another commit; confirm the reviewer job is skipped (draft guard works).
7. Convert back to ready-for-review; confirm the reviewer fires again (`ready_for_review` trigger works).

## Performance Considerations

- **Latency envelope:** `checkout` ~5s + `npm ci` on `packages/code-reviewer` ~15-30s cold / ~5s warm (npm cache scoped to that lockfile) + OpenRouter round-trip 30-90s + `gh pr comment` ~1s ≈ 1-2 minutes typical, 3 minutes worst case on a large diff. Well inside the 10-minute job timeout.
- **Cost envelope:** Sonnet 4.5 on a 500-line diff runs ~$0.02-0.10 per PR (rough — depends on how much rationale text the model emits). Two comments (if STEP 2 fires) roughly doubles that. This is not budgeted in CI; monitor via OpenRouter dashboard.
- **Concurrency:** `cancel-in-progress: true` on the per-PR concurrency group means a rapid succession of pushes on the same PR only pays for the last review. This is the right default for advisory reviews.
- **npm cache scoping:** cache key derived from `packages/code-reviewer/package-lock.json` so warm-cache installs are fast and cache doesn't collide with the root project's cache in the existing `ci` job.

## Migration Notes

No data migration. No deprecation of any existing behavior. The new workflow is additive; the existing `ci` and `deploy` workflows are untouched.

**If we later want to flip to blocking**, the delta is small: change `continue-on-error: true` to `false` on the reviewer step, add a downstream step that reads `{"verdict":"..."}` from stdout and `exit 1` on `fail`, and mark the check as required in branch protection. That is a separate change; land it only after ~10 real PRs have shown consistent behavior.

**If we later want fork PR support**, the delta is significant: change `pull_request` to `pull_request_target`, remove the fork guard, and add strict rules against executing any code from the head SHA (no `npm ci` in `packages/code-reviewer/` if the fork could tamper with its lockfile). This is not trivially safe and should not be attempted for cost/convenience.

## References

- Research: `context/changes/ci-cd-code-review/research.md`
- Requirements (frozen criteria contract): `context/changes/ci-cd-code-review/requirements.md`
- Reviewer schema (source of truth for criteria): `packages/code-reviewer/src/schemas/review.ts:31-62`
- Reviewer CLI (entry point): `packages/code-reviewer/src/cli.ts`
- Reviewer render layer (truncation constant): `packages/code-reviewer/src/render/comment.ts:42`
- Reviewer runner prompt (STEP 1 mandatory, STEP 2 gated): `packages/code-reviewer/src/prompts/review-runner.md`
- Existing CI workflow: `.github/workflows/ci.yml`
- Related historical work: `context/archive/2026-07-29-testing-generation-flow-protection/plan.md` (added `npm test` to CI); `context/archive/2026-08-03-testing-north-star-e2e-smoke/plan.md` (Playwright installed, CI wiring deferred)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Repo Prep — `OPENROUTER_API_KEY` Secret

#### Automated

- [x] 1.1 `gh secret list` includes `OPENROUTER_API_KEY` — eda5e3e
- [x] 1.2 `cd packages/code-reviewer && npm ci` completes without error on Node 22
- [x] 1.3 Local dry-run exits 0 within 3 minutes and prints a JSON object with a `verdict` key

#### Manual

- [x] 1.4 Secret value is a fresh OpenRouter key with enough credit for ~50 PRs
- [x] 1.5 Key is not committed to any `.env` under version control (grep of `sk-or-v1-` under tracked files is empty)

### Phase 2: New Workflow `.github/workflows/pr-review.yml`

#### Automated

- [x] 2.1 `.github/workflows/pr-review.yml` exists at the exact path
- [ ] 2.2 `gh workflow list` shows `PR Review` after push
- [x] 2.3 `actionlint .github/workflows/pr-review.yml` reports zero errors
- [ ] 2.4 `gh run list --workflow=pr-review.yml --limit 1` returns an entry within a minute of the trigger

#### Manual

- [x] 2.5 No `${{ ... }}` interpolation of `pull_request.title` or `.body` inside any `run:` script
- [x] 2.6 Job `if:` contains both the draft check and the fork check
- [x] 2.7 `permissions:` at workflow level contains only `pull-requests: write` and `contents: read`
- [x] 2.8 `timeout-minutes: 10` present on the `review` job

### Phase 3: Live Smoke Test on a Trivial PR

#### Automated

- [ ] 3.1 `gh run list --workflow=pr-review.yml` returns at least one `pull_request` run with `conclusion: success`
- [ ] 3.2 `gh pr view <smoke-pr> --json comments` returns a `github-actions[bot]` comment containing `Pass` or `Fail`

#### Manual

- [ ] 3.3 Reviewer comment renders correctly on `github.com` (table, badge, no escape artifacts)
- [ ] 3.4 `ci` job remains required and green on the smoke-test PR; reviewer job is present as non-required
- [ ] 3.5 Workflow rerun produces a second comment (confirming append-only v1 is behaving as designed)
- [ ] 3.6 OpenRouter dashboard shows one review-shaped call per PR event
- [ ] 3.7 Rollback line added under `## Notes` in `context/changes/ci-cd-code-review/change.md`
