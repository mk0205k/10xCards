---
date: 2026-08-13
researcher: "@mkról"
git_commit: 8e5bd0eb28fc6c33609f13ff38f22f0af1721b8e
branch: master
repository: mk0205k/10xCards
topic: "Wire packages/code-reviewer into CI/CD for automated PR review against the 6-criteria contract"
tags: [research, ci-cd, code-review, github-actions, packages/code-reviewer, openrouter, gh-cli]
status: complete
last_updated: 2026-08-13
last_updated_by: "@mkról"
---

# Research: Wire `packages/code-reviewer` into CI/CD

**Date**: 2026-08-13
**Researcher**: @mkról
**Git Commit**: `8e5bd0e`
**Branch**: master
**Repository**: mk0205k/10xCards

## Research Question

We have (a) an existing, tested reviewer package at `packages/code-reviewer/` that scores PR diffs against 6 criteria and posts one or two markdown comments back to the PR, and (b) an existing GitHub Actions workflow at `.github/workflows/ci.yml` that runs lint / typecheck / vitest / build on every PR to `master`. We want to wire the reviewer into CI so that every PR against `master` triggers an automated review that produces the `ReviewResult` shape frozen in `requirements.md` (six criteria, each 1–10, plus `verdict` and markdown `summary`).

Before writing a plan we need a precise map of: what the reviewer already does end-to-end, what the current CI looks like, what the criteria contract and verdict logic actually enforce, and what historical priors constrain the wiring.

## Summary

- **The reviewer is CI-ready and self-contained.** `packages/code-reviewer/src/cli.ts` already detects GitHub Actions (`GITHUB_ACTIONS`, `PR_NUMBER`, `GITHUB_REPOSITORY`), reads PR metadata from env/flags, streams the diff from stdin, uses OpenRouter via the Vercel `ai` SDK (default model `anthropic/claude-sonnet-4.5`), and posts comments back via the `gh` CLI. No SDK rewiring is needed — this is a workflow-authoring job.
- **The `requirements.md` criteria match the shipped schema verbatim.** The six criteria I wrote into `context/changes/ci-cd-code-review/requirements.md` are the same six defined in `packages/code-reviewer/src/schemas/review.ts:31-62`, with matching 1/10 anchors. There is no schema drift to reconcile in the plan.
- **The verdict is model-authored, not code-derived.** No threshold logic ("any score < N → fail") exists in the codebase — the model emits `verdict: "pass" | "fail"` directly, and `recoverOutcome()` defaults to `"fail"` only when the model didn't call `postCodeReview` at all. Any pass/fail enforcement (blocking merges, required check) is therefore a CI-side decision, not a schema decision.
- **The reviewer is not an npm workspace member.** The root `package.json` has no `workspaces` field; `packages/code-reviewer/` ships with its own `package-lock.json`. The CI job must run its own `cd packages/code-reviewer && npm ci` — installing at the repo root will not pull the reviewer's deps.
- **Two missing repo secrets and one permission bump.** The reviewer needs `OPENROUTER_API_KEY` (not yet in GH secrets — only in `.dev.vars.example`); it needs a GitHub token with `pull-requests: write` (`GITHUB_TOKEN` in the workflow's `permissions:` block is sufficient for same-repo PRs); and the checkout step must fetch enough history to compute `origin/${{ github.base_ref }}...HEAD`.
- **Fork PRs are a real constraint.** `pull_request` events from forks receive a read-only `GITHUB_TOKEN` and `gh pr comment` will 403; `pull_request_target` would fix that but ships with a known privilege-escalation footgun (attacker-controlled `head` code + write-scope token). This decision is not urgent for a single-user repo but must be resolved consciously.
- **Diff truncation is caller-owned.** The reviewer only *annotates* the comment when `DIFF_TRUNCATED=true`; it does not truncate its own stdin. The CI step must decide the cap (the codebase's own convention is 3000 lines — see `render/comment.ts:42` and `comment.test.ts:56`) and set the env when it applies.
- **The reviewer emits *two* comments per run when the gate is met.** STEP 1 (six-criteria code review) is unconditional and always posts one comment; STEP 2 (two-criteria plan review) posts a second comment only when the PR body or diff contains an explicit `Plan: <id>` or `context/changes/<id>/plan.md` reference. The reviewer's own `prompts/review-runner.md` treats this gate as strict-by-default.

## Detailed Findings

### 1. The reviewer package — end-to-end (`packages/code-reviewer/`)

**Entry points.** Two, both exercised in production:

- **Library**: `src/index.ts:1-17` exports `reviewCode`, `reviewCodeWithUsage`, `runReview`, and the `ReviewResult` / `ReviewCriteria` / `PlanReviewResult` schemas. `reviewCode` is a *pure* scorer that returns `Promise<ReviewResult>` and does not post anything.
- **CLI**: `src/cli.ts:1-66` is what CI will invoke. It (a) reads `PR_TITLE` / `PR_DESCRIPTION` from flags or env, (b) captures the unified diff from stdin to avoid argv/env size limits and shell escaping of attacker-controlled diff text (see the comment at `cli.ts:24-30` — this is a load-bearing security choice), (c) calls `runReview({ title, description, diff })`, (d) prints `{ verdict }` JSON to stdout, and (e) exits 0 on success and 1 on uncaught error. It never non-zero-exits on `verdict: "fail"` — enforcement is a caller concern.

**Model provider.** `packages/code-reviewer/src/provider/openrouter.ts` wires OpenRouter via `@openrouter/ai-sdk-provider`; default model `anthropic/claude-sonnet-4.5`; overridable via `OPENROUTER_MODEL` env or explicit `model` option. `OPENROUTER_API_KEY` is required and validated eagerly. Node 22+ is required because the package uses `process.loadEnvFile()` (native) rather than pulling in `dotenv`.

**Agent loop.** `src/agent/review-runner.ts` uses `ToolLoopAgent` from the Vercel `ai` SDK with four tools wired: `readPlan`, `readImplReviewCriteria`, `postCodeReview`, `postPlanReview`. Orchestration is dictated by the prompt `src/prompts/review-runner.md` — STEP 1 is always mandatory, STEP 2 is gated.

**Structured output.** The pure `reviewCode` path uses `Output.object({ schema: ReviewResult })` (`agent/reviewer.ts:33-34`) — Anthropic's structured-output tool-use mode enforces the shape. The schema deliberately does **not** use `.int().min(1).max(10)` on `score`; the rubric enforces the integer 1–10 contract via prompt because Anthropic's structured output rejects `minimum`/`maximum` on integer types (`schemas/review.ts:14-22`).

**Rendering.** `src/render/comment.ts:34-69` produces the code-review markdown: verdict badge, optional truncation note (gated on `truncated: boolean` from the caller — the flag is read from `process.env.DIFF_TRUNCATED === "true"` at `tools/post-pr-comment.ts:97`, never trusted from model output), 6-row criteria table, per-criterion rationale bullets, and the model-authored markdown summary. `renderPlanReviewComment` (`comment.ts:87-127`) does the same for the two-criteria plan review, adding `unimplementedItems` and `unplannedChanges` lists.

**Posting.** Both `postCodeReviewTool` and `postPlanReviewTool` (in `src/tools/post-pr-comment.ts`) shell out to `gh pr comment <PR_NUMBER> --body-file <temp-file>` (`post-pr-comment.ts:43-56`). The `PR_NUMBER` is read from env or auto-detected via `github-env.ts:18-22`. Authentication is ambient — `gh` uses `GH_TOKEN` or `GITHUB_TOKEN` from the environment.

**Package shape.** `packages/code-reviewer/package.json`:
- Not a workspace member (root has no `workspaces`).
- Own `package-lock.json`; runs on Node 22 with `tsx` for direct TS execution — no build step.
- Test runner: `vitest`. `npm test` runs all reviewer unit tests (schemas, render, tools, agent).
- Scripts of note: `dev` (tsx watch), `start` (one-shot demo), `review:local` (feeds a local fixture through the CLI), `eval` (promptfoo model sweep), `typecheck`, `test`.

### 2. Current CI/CD surface (`.github/workflows/ci.yml`)

**Shape.** One workflow file, two jobs:

- `ci` (`.github/workflows/ci.yml:10-27`) — triggers on `push` to `master` and on every `pull_request` targeting `master`. Ubuntu latest, Node 22 with `npm cache`. Steps: `checkout` → `setup-node` → `npm ci` → `npx wrangler types` → `npx astro sync` → `npm run lint` → `npm test` → `npm run build`. Build receives `SUPABASE_URL`, `SUPABASE_KEY`, `PUBLIC_SITE_URL` from repo secrets.
- `deploy` (`.github/workflows/ci.yml:29-51`) — needs `ci`, guarded by `if: github.event_name == 'push' && github.ref == 'refs/heads/master'`. Runs `wrangler deploy` via `cloudflare/wrangler-action@v3` with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

**What is *not* configured.**

- No `permissions:` block at either job or workflow level (defaults to whatever the repo default is; `GITHUB_TOKEN` will not have `pull-requests: write` unless we add it).
- No `CODEOWNERS`, no PR template, no `dependabot.yml`, no `.github/settings.yml`.
- No branch protection / required-check enforcement — CI is advisory-only today.
- No secret named `OPENROUTER_API_KEY` in the workflow (though `.dev.vars.example` declares it for local dev; it lives in `wrangler secret put` for prod).
- No `fetch-depth` on the checkout, so `git diff` against `origin/master` is *not* guaranteed to work — the shallow default clone will need to be widened.

**Existing gates from the test plan.** `context/foundation/test-plan.md` §5 lists lint / typecheck (via `astro sync`) / i18n parity (`scripts/check-i18n-parity.mjs` in `prebuild`) / unit+integration (vitest) as `required` and active; e2e (Playwright) as `planned` and deferred to a follow-up change. The reviewer gate fits *after* those and *before* deploy — running last means it reviews a diff that has already passed the cheap deterministic checks.

**Local env shapes.**
- Repo root `.env.example`: `SUPABASE_URL`, `SUPABASE_KEY` only.
- Repo root `.dev.vars.example`: `SUPABASE_URL`, `SUPABASE_KEY`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` (default `google/gemini-2.5-flash`), `PUBLIC_SITE_URL`.
- `packages/code-reviewer/.env.example`: `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` (default `anthropic/claude-sonnet-4.5`).

The **model defaults differ**: the app runtime uses cheap Gemini for card generation, while the reviewer defaults to Sonnet 4.5. If the workflow does not pin `OPENROUTER_MODEL`, the reviewer will use its own default — worth an explicit decision in the plan.

### 3. Requirements ↔ implementation alignment

The six criteria in `context/changes/ci-cd-code-review/requirements.md` are **exactly** the six criteria in `packages/code-reviewer/src/schemas/review.ts:31-62`: same names, same one-sentence descriptions, same 1/10 anchor language. This is by construction — `requirements.md` was written against the schema — but it is worth re-stating: the plan does not need to change the reviewer's contract, only invoke it.

**What is *not* in the requirements**, and therefore intentionally left to the plan:

- No pass/fail threshold rule. `verdict` is model-authored; the codebase has no "any criterion below N ⇒ fail" logic (verified in `agent/review-runner.ts:125-143` — `recoverOutcome()` just reads the model's declared verdict from the `postCodeReview` tool-call input, defaulting to `"fail"` only when the model never called the tool).
- No merge-gate enforcement rule. Whether `verdict: "fail"` should block merge (`exit 1`) or stay advisory is a wiring decision.
- No budget policy. Sonnet 4.5 on medium diffs is non-trivial per-PR cost; the reviewer does surface `ReviewUsage` via `reviewCodeWithUsage`, but nothing consumes that in CI today.

### 4. Verdict logic and comment rendering

**Where the verdict comes from.** `agent/review-runner.ts:125-143` — `recoverOutcome()` scans the model's tool-call log for the `postCodeReview` call and reads `verdict` from its input. If the model never posted, verdict falls through to `"fail"`. There is no scoring aggregation.

**How the pass/fail decision is communicated externally.** Two channels:
1. **PR comment** — always posted by STEP 1 (see `prompts/review-runner.md:3-13` — the "skip"/"post nothing" language explicitly does *not* apply to STEP 1). The comment shows the verdict badge, the criteria table, per-criterion rationale, and the summary.
2. **CLI stdout** — `cli.ts:54` prints `{ verdict }` as JSON. A workflow step that wants to fail the job on a `fail` verdict can pipe stdout through `jq -r .verdict` and `exit 1` when it's not `"pass"`.

Neither channel changes the reviewer's own exit code — the process exits 0 unless there was an *uncaught* error.

**STEP 2 gate — implementation review.** `prompts/review-runner.md:15-40` sets a strict-by-default gate: STEP 2 runs only if the PR body or diff contains a concrete plan reference (`Plan: <id>`, `Implements plan <id>`, or a `context/changes/<id>/plan.md` path). A branch name, ticket link, or generic "as planned" is explicitly *not* enough. `readPlan` (`tools/read-plan.ts:46-81`) then loads `context/changes/<id>/plan.md` from the resolved repo root and `readImplReviewCriteria` (`tools/read-impl-review-criteria.ts:68-78`) loads the rubric from `.agents/skills/10x-impl-review-ci/references/impl-review-instructions.md` (path is resolved relative to the *package* root — meaningful for the CI wiring: the rubric ships inside the reviewer package, not at the repo root).

**Rendering constant to remember.** The truncation note is the exact string `"Diff truncated at 3000 lines — this review is partial."` (`render/comment.ts:42`). If the CI step decides to truncate, it should truncate at 3000 lines to match, and set `DIFF_TRUNCATED=true`.

### 5. Evals and confidence in the model

**Harness.** `packages/code-reviewer/evals/` — a promptfoo model sweep over one hand-authored React 16→19 migration diff carrying three planted defects (XSS via `dangerouslySetInnerHTML`, stale-closure `useEffect`, `defaultProps` on function component in React 19). Runs three OpenRouter models (glm-5.1, deepseek-v4-flash, sonnet-4.6) with `PROMPTFOO_DISABLE_TEMPLATING=true`. Two assertion layers: `evals/asserts/reviewFails.ts` (deterministic: `verdict === "fail"`, all six criteria present with valid `score` and `rationale`) and three LLM judges (one per planted flaw, judging `securitySafety`, `implementationCorrectness`, `idiomaticity`).

**What the evals do *not* cover.**
- Only the three "hot" criteria are LLM-judged; `complexity`, `testRiskCoverage`, `documentation` are only assertion-checked for presence, not for correct grading.
- Only one fixture — no pass-verdict test case, no partial-fail test case, no truncated-diff test case.
- Temperature is unpinned; results vary across runs. This is intentional (they're comparing models under realistic settings) but it means eval results are noisy; expect ~5–10% flakiness on the LLM judges.
- Evals do not run in CI. They exist as a manual sweep (`npm run eval` / `eval:view`).

None of this blocks CI wiring, but it means the reviewer's answers should be treated as *signal, not truth* in the first weeks after landing — human review still owns final approval.

### 6. Historical context (from prior changes)

- **`packages/code-reviewer/` was committed 2026-08-12** (`387114a feat(code-reviewer): add AI PR reviewer package`). The package was built as a discrete deliverable and has never been wired into CI — this change is that wiring.
- **The CI shape was set by `2026-07-07-data-schema-and-rls`** and grown by:
  - `2026-07-29-testing-generation-flow-protection` — added `npm test` (vitest) as a required gate; landed Vitest projects (node + happy-dom) split; wired i18n parity in `prebuild`.
  - `2026-08-03-testing-north-star-e2e-smoke` — installed Playwright 1.62.1, hardened `playwright.config.ts`, but explicitly *deferred* wiring e2e into CI (Phase 5 open).
- **`context/foundation/test-plan.md` §3 Phased Rollout** was written with an "AI-review" gate as an *aspirational* next phase after the cheap deterministic gates; this change is the concrete realization of that phase. The test plan does *not* claim the AI review is a substitute for e2e — the e2e gate is still owed separately.
- **`context/foundation/lessons.md`** has two entries:
  - *Kill date on feature flags* — if the wiring introduces any flag (e.g. `ENABLE_AI_CODE_REVIEW`, `REVIEWER_MODEL_OVERRIDE`, or a "reviewer-off" bypass label), it must carry a kill date at introduction. Note this is a real risk here — the temptation to add "and let me skip the reviewer with a label" is strong, and every such switch decays into zombie config.
  - *`no-misused-promises` off for `.astro`* — not relevant to this wiring (the reviewer runs as a Node CLI, not through Astro's build).

### 7. Constraints the plan will have to resolve

The following are *not* answered by research — they need explicit decisions in `/10x-plan`:

1. **New workflow vs. new job in `ci.yml`?** Pros of a new file (`.github/workflows/pr-review.yml`): independent triggers, independent permissions block, isolates a slow AI call from the required check. Pros of a new job in `ci.yml`: single place to reason about the pipeline. Recommendation to be validated by the plan: new file, so `pull-requests: write` isn't granted to the whole workflow.
2. **Verdict enforcement**: advisory (informational only) vs. required check (fail the job on `verdict != "pass"`). The former is safe to land immediately; the latter should be delayed until we trust the eval results.
3. **Model choice**: pin `OPENROUTER_MODEL` in the workflow, or accept the package default (Sonnet 4.5). Cost per PR at Sonnet 4.5 is real; the app itself uses Gemini 2.5 Flash. The plan should either pin an explicit choice or explicitly leave the default.
4. **Fork PRs**: `pull_request` (safe, but reviewer can't comment on fork PRs because `GITHUB_TOKEN` is read-only) vs. `pull_request_target` (can comment but has the classic checkout-of-fork-code + write-token footgun). For a single-user repo the fork case is nearly hypothetical, but the plan should call it out and pick a default.
5. **Diff scope**: full unified diff of the PR, or filtered (exclude `**/*.lock`, `package-lock.json`, `messages/*.json`, generated `paraglide/*`)? Filtering saves tokens and reduces noise; the reviewer will otherwise happily grade a `package-lock.json` diff.
6. **STEP 2 policy**: leave STEP 2's plan-review gate as-is (only fires when a PR body cites a plan) or add a workflow-level toggle. The default is safe; explicit is safer.
7. **Idempotency**: `gh pr comment` appends a new comment each run. If a workflow re-runs, the PR grows another comment. Options: (a) accept the append behavior, (b) use `gh pr comment --edit-last` (does not exist — `gh` does not natively support editing the last bot comment; the reviewer would need to grow a new tool), (c) delete previous reviewer comments before posting. Recommendation: accept in v1, revisit only if it becomes noise.
8. **Secrets scope**: whether the reviewer job should also see `SUPABASE_URL` / `SUPABASE_KEY` (no — it never touches the DB) or just `OPENROUTER_API_KEY`. Minimizing secrets exposure is the right default.
9. **The rubric-inside-package tension**: `readImplReviewCriteria` reads from `.agents/skills/10x-impl-review-ci/references/impl-review-instructions.md` *inside the reviewer package*. If we later move that rubric under `context/foundation/` (to co-locate with `requirements.md`), the reviewer's tool must be updated in lockstep. The plan should note this coupling.

## Code References

- `packages/code-reviewer/src/cli.ts:24-30` — stdin capture rationale (avoids argv/env size limits + shell escaping of attacker-controlled diff)
- `packages/code-reviewer/src/cli.ts:42-45` — GitHub Actions env detection (`GITHUB_ACTIONS`, `GITHUB_REPOSITORY`, `PR_NUMBER`, `DIFF_TRUNCATED`)
- `packages/code-reviewer/src/cli.ts:54,64` — stdout `{verdict}` JSON, exit code 0 on success / 1 on uncaught error only
- `packages/code-reviewer/src/schemas/review.ts:14-22` — why no `.int().min().max()` on `score` (Anthropic structured output rejects bounds)
- `packages/code-reviewer/src/schemas/review.ts:31-62` — the six criteria (verbatim match with `context/changes/ci-cd-code-review/requirements.md`)
- `packages/code-reviewer/src/schemas/review.ts:66-71` — `ReviewResult`: `criteria + verdict + summary`
- `packages/code-reviewer/src/schemas/plan-review.ts:17-42` — `PlanReviewResult`: `planAdherence + scopeDiscipline + unimplementedItems + unplannedChanges + verdict + summary`
- `packages/code-reviewer/src/agent/review-runner.ts:125-143` — `recoverOutcome()`: verdict recovered from model's `postCodeReview` tool-call input; defaults to `"fail"` if not called
- `packages/code-reviewer/src/prompts/review-runner.md:3-40` — STEP 1 mandatory / STEP 2 gated procedure (the "skip" language never applies to STEP 1)
- `packages/code-reviewer/src/prompts/review.ts:17-36` — `REVIEW_SYSTEM_INSTRUCTIONS` names all six criteria with 1/10 anchors
- `packages/code-reviewer/src/provider/openrouter.ts:18,31-49` — default model `anthropic/claude-sonnet-4.5`, `OPENROUTER_API_KEY` required
- `packages/code-reviewer/src/tools/post-pr-comment.ts:43-56` — `gh pr comment <PR_NUMBER> --body-file <temp>` posting mechanism
- `packages/code-reviewer/src/tools/post-pr-comment.ts:97` — `DIFF_TRUNCATED` env is trusted only from caller, not model
- `packages/code-reviewer/src/tools/read-plan.ts:46-81` — reads `context/changes/<id>/plan.md`, walks up to find repo root
- `packages/code-reviewer/src/tools/read-impl-review-criteria.ts:68-78` — reads impl-review rubric from `.agents/skills/10x-impl-review-ci/references/impl-review-instructions.md` **inside the reviewer package**
- `packages/code-reviewer/src/render/comment.ts:34-69` — six-criteria comment renderer, verdict badge, truncation note, criteria table
- `packages/code-reviewer/src/render/comment.ts:42` — hard-coded string `"Diff truncated at 3000 lines — this review is partial."` (matched by test at `comment.test.ts:56`)
- `packages/code-reviewer/.env.example:1-6` — required env vars: `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`
- `packages/code-reviewer/package.json` — Node 22, ESM, no build step (uses `tsx`), own `package-lock.json`, not a workspace member
- `.github/workflows/ci.yml:1-27` — `ci` job triggers, secrets, step order
- `.github/workflows/ci.yml:29-51` — `deploy` job (master-push only, uses `wrangler-action@v3`)
- `.dev.vars.example` — declares `OPENROUTER_API_KEY` for local dev (Gemini default), but this does not get piped to GitHub secrets automatically
- `astro.config.mjs` (`env.schema`) — `OPENROUTER_API_KEY` is required server-side for the *app*; the CI reviewer job needs its own secret with the same name
- `package.json` (root) — no `workspaces` field: reviewer package is standalone
- `context/foundation/test-plan.md` §5 — quality gates table (lint / typecheck / unit+integration are required; e2e is `planned`, deferred)

## Architecture Insights

- **The reviewer respects its own boundaries.** It only *reads* from the repo (plan text, impl-review criteria) and only *writes* through the `gh` CLI (PR comments). It does not push commits, edit files, or hit the app's runtime env. Wiring can rely on this narrow blast radius.
- **The reviewer treats the diff as untrusted.** Diff content flows through stdin, never through argv or env; the truncation flag comes from *ambient env*, not the model; the comment rendering is fully in-code and does not template model output as markdown (it inserts model strings verbatim). This is the right shape for CI where PR diffs are attacker-controlled.
- **The 6-criteria contract is enforced by prompt, not schema.** The 1–10 integer bound is a rubric rule, not a JSON-schema rule (Anthropic structured output rejected the bounds). If we later want a code-side floor ("if any criterion < 3 ⇒ force fail"), the enforcement must be a *post-check* in the CI step, not a schema change.
- **The reviewer is a subprocess-shape integration point.** It is a Node CLI that speaks stdin/stdout and shells out to `gh`. This composes cleanly with GitHub Actions but means we should not try to import it as a library from another workflow's JavaScript action — that would fight the design.

## Historical Context (from prior changes)

- `context/archive/2026-07-07-data-schema-and-rls/plan.md` — first change; established the initial `ci.yml` skeleton (lint / typecheck / build). The reviewer wiring extends the same pipeline.
- `context/archive/2026-07-29-testing-generation-flow-protection/plan.md` — added `npm test` to CI as a required gate and split Vitest into node + happy-dom projects. The reviewer step should sit *after* `npm test` — the reviewer reads a diff that has already survived the cheap gates.
- `context/archive/2026-08-03-testing-north-star-e2e-smoke/plan.md` — installed Playwright and deferred the e2e-in-CI wiring to a follow-up (Phase 5 open). The reviewer landing does *not* substitute for the e2e gate; both are still owed. Order does not matter functionally, but ordering the reviewer first is cheaper (no browser boot) and provides feedback faster.
- `context/foundation/tasks-github.md` — labels/milestones convention: `kind:foundation` / `kind:slice`, `status:*`, `stream:A` / `stream:B`, `north-star`. If the plan wants a "skip reviewer on `kind:foundation`" or similar carve-out, the labels already exist to hang it on — but see the lesson on feature-flag kill dates before adding one.
- `context/foundation/lessons.md` "Kill date on feature flags" — directly relevant if the plan introduces a bypass label (e.g. `skip-ai-review`) or a workflow-level `ENABLE_AI_CODE_REVIEW` toggle.

## Related Research

- `packages/code-reviewer/README.md` — canonical usage description from the author of the package.
- `packages/code-reviewer/evals/README.md` — how the model sweep validates the reviewer against a fixture.
- `context/foundation/test-plan.md` §5 (quality gates), §3 (phased rollout) — the strategic context for adding this gate.

## Open Questions

The plan will need to answer, at minimum:

1. **Advisory or blocking?** Post the comment and always exit 0, or fail the job when `verdict != "pass"`? Recommendation: land as advisory; only flip to blocking after ~10 real PRs have shown the reviewer's calls are consistent with human judgement.
2. **Which model?** Pin `OPENROUTER_MODEL` in the workflow (e.g. cheaper Haiku/Flash on small diffs, Sonnet 4.5 on large ones), or accept the package default? What's the per-PR budget we're willing to spend?
3. **Fork-PR policy?** Skip reviewer on cross-fork PRs (`if: github.event.pull_request.head.repo.full_name == github.repository`), or use `pull_request_target` with a hardened checkout of `${{ github.event.pull_request.head.sha }}`?
4. **Diff filtering?** Exclude `package-lock.json`, `messages/*.json`, `src/paraglide/**` (generated), lockfiles in `packages/*/`? Cost-per-PR and signal-per-PR both improve if we do.
5. **Truncation cap?** Match the reviewer's own 3000-line convention, or set our own (e.g. character-based cap that respects context-window budget)?
6. **STEP 2 policy?** Accept the reviewer's strict-by-default plan-review gate, or add an explicit `Plan: <id>` line to our PR template so every planned change gets a second comment?
7. **Comment idempotency?** Accept append-on-re-run for v1, or add a "delete previous reviewer comments" step? What identifies "previous reviewer comments" — comment author (`github-actions[bot]`) plus a body marker?
8. **Where does the impl-review rubric live?** Today it's inside the reviewer package. Should we leave it there, or hoist it to `context/foundation/`? (Coupling: `read-impl-review-criteria.ts` hard-codes the path.)
9. **Node install cost.** The reviewer needs its own `npm ci` in `packages/code-reviewer/`. Cache key must include that package's lockfile hash separately.
