# Wire `packages/code-reviewer` into CI/CD — Plan Brief

> Full plan: `context/changes/ci-cd-code-review/plan.md`
> Research: `context/changes/ci-cd-code-review/research.md`

## What & Why

Wire the already-built, tested `packages/code-reviewer` CLI into GitHub Actions so that every non-fork, non-draft PR targeting `master` triggers an automated AI review against the six criteria frozen in `requirements.md`. The review lands as a single markdown comment on the PR. Version 1 is **advisory only** — the reviewer's verdict never blocks a merge and is not a required check. This is the "start collecting real signal" landing; blocking enforcement is a later, separate decision.

## Starting Point

`packages/code-reviewer/` is CI-ready but unwired: its CLI (`src/cli.ts`) already detects GitHub Actions, reads PR title/description from env, takes the diff from stdin, and posts back via `gh pr comment`. The six criteria in `src/schemas/review.ts:31-62` match `requirements.md` verbatim. Existing CI (`.github/workflows/ci.yml`) runs lint / typecheck / vitest / build on every PR to `master` and is untouched by this plan. Repo has no `OPENROUTER_API_KEY` secret, no `permissions:` block on the existing workflow, no `CODEOWNERS`, and no branch protection.

## Desired End State

Every eligible PR to `master` gets exactly one markdown comment from `github-actions[bot]` within ~3 minutes of open, containing a verdict badge, a 6-row criteria table, per-criterion rationale, and a summary. The comment is visible on the PR page next to the existing `ci` check. The existing required `ci` check is unchanged. The reviewer's outcome never blocks merge. Rerunning the workflow appends a new comment (accepted as v1 behavior). Cross-fork PRs and drafts are silently skipped.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Workflow location | New file `.github/workflows/pr-review.yml` | Isolates `pull-requests: write` from the `ci`/`deploy` workflow's blast radius. | Plan |
| Verdict enforcement (v1) | Advisory only (`continue-on-error: true`; job always exits 0) | Safe landing — collect signal on ~10 real PRs before considering blocking. | Plan |
| Model | Package default `anthropic/claude-sonnet-4.5` (no `OPENROUTER_MODEL` pin) | Best signal-to-noise on the 6 criteria; matches how `evals/` was validated. | Plan |
| Fork PR policy | Skip via `if: head.repo.full_name == github.repository` | Zero security exposure; single-user repo has no fork traffic. | Plan |
| Diff scope | Filtered: exclude `**/package-lock.json`, `src/paraglide/**`, `messages/*.json`, `worker-configuration.d.ts` | Cheaper and higher signal — reviewer never grades generated code or lockfiles. | Plan |
| Comment idempotency (v1) | Append-only | Zero extra code; noise is acceptable in v1 and dedup can land later if needed. | Plan |
| Truncation cap | 3000 lines with `DIFF_TRUNCATED=true` | Matches the hard-coded convention in `render/comment.ts:42`. | Research |
| STEP 2 (plan-review) gate | Left as-is (fires only on explicit `Plan: <id>` in PR body) | Reviewer already ships strict-by-default; no change needed. | Research |

## Scope

**In scope:**
- New workflow file `.github/workflows/pr-review.yml`.
- Add `OPENROUTER_API_KEY` to repository secrets.
- Live smoke test on one trivial PR.

**Out of scope:**
- Any change to `.github/workflows/ci.yml`.
- Any change to `packages/code-reviewer/` source, schemas, prompts, or tests.
- Branch protection setup / required checks / `CODEOWNERS` / PR template edits.
- Model swap or `OPENROUTER_MODEL` pin.
- Fork PR support (would require `pull_request_target` + hardened checkout).
- Comment dedup / idempotency logic.
- Cost budgeting or per-PR spend cap.
- e2e (Playwright) wiring into CI — deferred to its own change.

## Architecture / Approach

Single new workflow `pr-review.yml` on `pull_request` events (`opened`, `synchronize`, `reopened`, `ready_for_review`) targeting `master`. Job-level `if:` skips drafts and cross-fork PRs. Workflow-level `permissions:` grants only `pull-requests: write` and `contents: read`; per-PR `concurrency` group with `cancel-in-progress: true`; job `timeout-minutes: 10`.

Steps: checkout (`fetch-depth: 0`) → `git fetch origin ${base}` to guarantee base ref present → Node 22 setup with npm cache scoped to `packages/code-reviewer/package-lock.json` → `npm ci` inside the reviewer package → compute filtered `git diff origin/${base}...HEAD` → truncate at 3000 lines and set `DIFF_TRUNCATED=true` if needed → pipe to `npx tsx src/cli.ts` with PR metadata passed via `env:` block (never via `${{ ... }}` in `run:` — PR body is attacker-controlled). Reviewer step is `continue-on-error: true`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Repo prep | `OPENROUTER_API_KEY` secret in GH + local dry-run confirms CLI works end-to-end | Wrong key value / insufficient OpenRouter credit — caught by dry-run |
| 2. Workflow file | `.github/workflows/pr-review.yml` committed, parses cleanly, listed by `gh workflow list` | Shell injection via PR body — mitigated by passing title/body only through `env:`, never interpolated into `run:` |
| 3. Live smoke test | One real PR gets one real reviewer comment; rollback line added to `change.md` | OpenRouter transient failure or `gh` auth issue on first live invocation — rollback = `gh workflow disable pr-review.yml` |

**Prerequisites:** admin access to `mk0205k/10xCards` GH settings (to add the secret); a valid OpenRouter API key with credit for ~50 Sonnet 4.5 reviews; local Node 22 for the dry-run.

**Estimated effort:** ~1 session across 3 short phases. Phase 1 is 15 minutes (add secret + dry-run). Phase 2 is 30-45 minutes (author yaml + commit + push + `actionlint`). Phase 3 is 15 minutes plus wait time for one review round-trip.

## Open Risks & Assumptions

- **Sonnet 4.5 cost per PR is not budgeted in CI.** Rough estimate ~$0.02-0.10 per average PR, doubled if STEP 2 fires. Monitored out-of-band via OpenRouter dashboard.
- **`gh pr comment` may occasionally fail with a network flake.** V1 accepts this — `continue-on-error: true` swallows it; the PR is unaffected.
- **Append-only comments create noise on PRs with many rerun cycles.** Accepted for v1; revisit if it becomes a real problem.
- **`ready_for_review` transition will fire the reviewer.** This is intentional — a PR that leaves draft status is a real reviewable event. If it turns into noise, tighten the trigger types in a follow-up.
- **No fork-PR path.** If the project ever accepts external contributions, this plan needs a second pass with `pull_request_target` and a hardened diff/checkout dance.

## Success Criteria (Summary)

- On a trivial doc-only PR, a `github-actions[bot]` comment appears within 3 minutes containing a verdict badge, the six-criteria table with 1-10 scores, per-criterion rationale, and a summary.
- The existing required `ci` check remains green and unaffected; the new "AI code review (advisory)" job appears as a separate, non-required check.
- Draft PRs and cross-fork PRs produce no workflow run at all (job-level `if:` skips before any runner is provisioned).
