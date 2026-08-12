---
name: 10x-impl-review-ci
description: >
  Run implementation review non-interactively in CI against a PR: discovers
  the plan, checks drift/safety/patterns/test coverage, writes
  context/changes/<change-id>/reviews/impl-review.md, commits it to the PR
  branch, and posts a summary comment. Use whenever the request mentions CI,
  GitHub Actions, GHA, Claude Code Action, automated PR review, or "review
  this PR in CI".
argument-hint: (none — discovers plan and PR automatically from the CI environment)
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
  - Bash
  - Agent
  - TaskCreate
  - TaskUpdate
  - TaskList
  - TaskGet
---

# Implementation Review (CI/CD)

Run inside GitHub Actions (typically via Claude Code Action) on a pull request. Analyze the PR's changes against the plan it claims to implement. Emit an audit trail as a committed report file plus a concise PR comment.

**This skill does not interact and does not edit code.** No questions, no triage loop, no source edits. It reads, analyzes, writes one report file, commits it, posts inline review comments on flagged lines, and posts a summary PR comment. That's the whole job.

**The review criteria — how to compare the implementation against the plan, how to grade each dimension, and how to shape findings — live in `references/impl-review-instructions.md`. Read that file once when this skill loads; Steps 1–5 orchestrate it (gather evidence, run checks, normalize findings) and point into it rather than restating the criteria.** The steps below own only the harness mechanics: plan discovery, the diff, subagent dispatch, the report-file contract, the commit, and the inline/summary comment posting.

## Operating context

Assume you're running non-interactively on an ephemeral Linux runner with:

- **Git history** — `origin/<base-ref>` is fetched; the PR's merge-base is resolvable.
- **`gh` CLI** — authenticated via `GH_TOKEN`/`GITHUB_TOKEN`; can read PR metadata, post comments.
- **Project toolchain** — installed before this skill runs (Node/pnpm, Python, Go, whatever the project uses). Test and lint commands should work.
- **Environment variables** — `PR_NUMBER`, `GITHUB_BASE_REF` (base branch), plus anything the workflow exports.
- **Subagents** — you can spawn `general-purpose` agents for parallel evidence gathering.

No user is watching. Never call `AskUserQuestion` — there's nobody to answer. If anything is ambiguous, pick the conservative interpretation and note it in the report.

## Step 0: Find the plan

TaskCreate: "Impl-Review (CI)" / activeForm "Discovering plan"

The plan is the ground truth — the review compares the PR against the plan's declared intent. No plan means no meaningful review.

**Primary source: convention.** Projects that use a plan-driven workflow keep plan files at `context/changes/<change-id>/plan.md` in the PR branch — at the repo root, or, in a monorepo, under a workspace subtree (e.g. `projects/<app>/context/changes/<change-id>/plan.md`). Find the newest one that's part of this PR:

```bash
BASE="${GITHUB_BASE_REF:-master}"
# The leading `:(glob)**/` matches context/changes/ at the repo root AND
# under any workspace subtree, so this works in single-package repos and
# monorepos alike.
PLAN=$(git diff --name-only "origin/${BASE}...HEAD" -- ':(glob)**/context/changes/**/plan.md' \
  | sort -r \
  | head -1)
```

Reverse-lexicographic sort picks the most recently modified change folder (`<change-id>` slugs are typically date-prefixed for active work, and the alphabetic order is good enough as a tiebreaker; in a monorepo it also biases toward the workspace whose path sorts last, an acceptable tiebreaker).

**Override: explicit PR body reference.** If the PR description contains a line like `Plan: context/changes/<change-id>/plan.md`, it wins over the convention. This handles bundled PRs, revived older plans, and PRs that reorganize plan files but implement a different one:

```bash
PR_BODY=$(gh pr view "$PR_NUMBER" --json body -q .body 2>/dev/null || echo "")
OVERRIDE=$(printf '%s' "$PR_BODY" \
  | grep -oE 'Plan:[[:space:]]*[^[:space:]`]*context/changes/[^[:space:]`]+/plan\.md' \
  | head -1 \
  | sed -E 's/Plan:[[:space:]]*//')
[ -n "$OVERRIDE" ] && PLAN="$OVERRIDE"
```

**Graceful exit when no plan found.** Most PRs in a mature repo aren't plan-driven (docs, chore commits, hotfixes). Don't fail the workflow — post a neutral comment and exit 0:

```bash
if [ -z "$PLAN" ] || [ ! -f "$PLAN" ]; then
  gh pr comment "$PR_NUMBER" --body "🔍 **impl-review (CI)** — no plan detected in this PR. Skipping review.

To enable a review, include a \`Plan: context/changes/<change-id>/plan.md\` line in the PR description, or ensure the branch touches a plan file under \`context/changes/<change-id>/\`."
  exit 0
fi
```

Record the resolved plan path — every later step references it.

## Step 1: Load and parse the plan

TaskUpdate: activeForm "Loading plan"

Read the plan file fully (no offset, no limit) and extract its commitments — planned file paths, Automated/Manual Verification, exclusions, architectural decisions — following **"Read the plan as the baseline"** in `references/impl-review-instructions.md` (plan anatomy and the five extraction targets). The PR is always reviewed as a whole — partial-phase CI reviews are error-prone without state files and rarely useful in practice.

### Compute the diff

```bash
BASE="${GITHUB_BASE_REF:-master}"
git fetch origin "$BASE" --depth=50 2>/dev/null || true
CHANGED_FILES=$(git diff --name-only "origin/${BASE}...HEAD")
```

The three-dot range gives you the merge-base diff — what this PR actually adds, not everything that has happened since branch divergence.

Cross-reference changed files against planned files:

- **In plan AND in diff** → expected change; verify intent matches.
- **In diff but NOT in plan** → unplanned addition; check against the exclusions list, then flag as scope creep if not explicitly excluded.
- **In plan but NOT in diff** → possibly missing implementation; flag.

Don't pre-read every changed source file into your main context. Delegate that to the subagents below — keep the main context holding only the plan text and the diff summary.

## Step 2: Parallel evidence gathering

TaskUpdate: activeForm "Gathering evidence"

Spawn three subagents in parallel, each with targeted context. Don't dump the whole plan into all of them — each agent only needs what's relevant to its question. The judgment criteria each agent applies live in `references/impl-review-instructions.md` under **"The review dimensions"** — give each agent its inputs and point it at its dimension; it reports findings in the per-dimension shape the reference specifies.

### Agent 1 — Plan drift detection

`subagent_type: "general-purpose"`

Give it: the extracted "Changes Required" text (per phase) and the list of planned file paths. It applies **dimension 1 (Plan drift)** — MATCH / DRIFT / MISSING / EXTRA per planned change.

### Agent 2 — Safety, quality, and pattern compliance

`subagent_type: "general-purpose"`

Give it: the list of changed source files (exclude test files and the plan file itself) and the project root. It applies **dimension 2** — security / performance / reliability / data safety, plus sibling-pattern comparison scaled to change size.

### Agent 3 — Test coverage

`subagent_type: "general-purpose"`

Give it: the plan's Success Criteria section (extract the text before spawning), the diff file list split into `source_files` and `test_files`, the project root, and the "What We're NOT Doing" list. It applies **dimension 3** — extract test commitments, match them to artifacts, scan for uncovered behavior, run the plan's test commands, and respect explicit opt-outs.

If a subagent's report gets unwieldy, ask it to return only the highest-severity findings, not the full investigation trace.

## Step 3: Verify non-test automated checks

TaskUpdate: activeForm "Verifying automated checks"

Agent 3 already ran the test-related Automated Verification commands. Now run everything else — lint, build, format-check, typecheck, any other non-test commands from the checkboxes. For each:

```bash
echo "→ running: $cmd"
$cmd
echo "exit: $?"
```

Record command, pass/fail, truncated output (first 40 and last 20 lines is usually enough). For how Manual Verification checkboxes are read and how failing checks map to grades, follow the reference's **"Verify the success criteria"**.

## Step 4: Grade each dimension

TaskUpdate: activeForm "Grading"

Assign PASS / WARNING / FAIL to each of the seven dimensions and derive the overall verdict (APPROVED / NEEDS ATTENTION / REJECTED) using the rules in the reference's **"Grade each dimension"** and **"Overall verdict"**.

## Step 5: Compile findings

TaskUpdate: activeForm "Compiling findings"

Normalize the subagents' output into a single findings list. Sort by severity (CRITICAL → WARNING → OBSERVATION). Cap at 10 total — consolidate related issues (e.g., "6 files use the wrong case convention" → one finding, not six). Apply the finding shape, impact grammar, and fix-options grammar from the reference's **"Express the findings"**.

**One harness-specific addition the reference doesn't carry:** every finding in the saved report also gets a `- **Decision**: PENDING` field (downstream triage tooling fills it in). It's part of the output contract in Step 6 — don't omit it.

## Step 6: Save the report

TaskUpdate: activeForm "Saving report"

Derive the change directory from the resolved plan path — it's the plan's parent folder (`$(dirname "$PLAN")`), which resolves to `context/changes/<change-id>` at the repo root or `projects/<app>/context/changes/<change-id>` in a monorepo. Write the report to `<change-dir>/reviews/impl-review.md`. Also update `<change-dir>/change.md` in-place: set `status: impl_reviewed` and `updated: <today>` — the CI commit in Step 7 carries this back to the PR branch alongside the review.

**The directory is derived from the plan, not chosen: the report goes in the `reviews/` folder beside the plan's `change.md` (`<…>/context/changes/<change-id>/reviews/impl-review.md`).** Do NOT write the report to `.claude-pr/`, `.github/`, the repo root, or any other location — even if the Claude Code Action's default prompt suggests one. Downstream triage tooling reads only from this derived path. Formatting must match the surrounding reviews: oxfmt-compatible (the project runs `oxfmt --check .` in CI).

### Output contract (load-bearing)

The file **must** start with the HTML comment marker `<!-- IMPL-REVIEW-REPORT -->` on its first line, and **must** include `- **Decision**: PENDING` on every finding. Downstream tooling reads this shape to route the report into a triage workflow. Don't omit either.

### Template

```markdown
<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: [Plan Title]

- **Plan**: `context/changes/<change-id>/plan.md`
- **Scope**: Full plan (CI review on PR #<N>)
- **Date**: YYYY-MM-DD
- **CI run**: <GitHub Actions workflow run URL>
- **Verdict**: [APPROVED | NEEDS ATTENTION | REJECTED]
- **Findings**: [N critical] [N warnings] [N observations]

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS / WARNING / FAIL |
| Scope Discipline | PASS / WARNING / FAIL |
| Safety & Quality | PASS / WARNING / FAIL |
| Architecture | PASS / WARNING / FAIL |
| Pattern Consistency | PASS / WARNING / FAIL |
| Test Coverage | PASS / WARNING / FAIL |
| Success Criteria | PASS / WARNING / FAIL |

## Findings

### F1 — [Short title]

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/auth/handler.ts:42
- **Detail**: SQL query built with string concatenation. Plan specified parameterized queries in Phase 2; actual implementation uses template literals.
- **Fix**: Replace the template literal with a parameterized query using db.query($1, [value]).
  - Strength: Matches the pattern in src/users/query.ts; removes injection class entirely.
  - Tradeoff: Minor — one call site, a few-line change.
  - Confidence: HIGH — identical pattern exists elsewhere in this repo.
  - Blind spot: None significant.
- **Decision**: PENDING

### F2 — [Next finding]
…

<!-- End of report -->
```

Sections with zero findings can be omitted from the Findings list, but the Verdicts table always shows all seven dimensions.

### Severity/impact icons (paired with words)

- Severity: ❌ CRITICAL · ⚠️ WARNING · 👁 OBSERVATION
- Impact: 🏃 LOW · 🔎 MEDIUM · 🔬 HIGH

Never use a bare icon without its label — it forces the reader to memorize what each glyph means.

## Step 7: Commit the report

TaskUpdate: activeForm "Committing review"

```bash
# Derive every path from the plan's own directory so this works at the
# repo root AND in a monorepo where context/changes/ lives under a
# workspace subtree (e.g. projects/<app>/context/changes/<id>/plan.md).
CHANGE_DIR=$(dirname "$PLAN")            # …/context/changes/<change-id>
CHANGE_ID=$(basename "$CHANGE_DIR")      # <change-id>
REVIEW_PATH="${CHANGE_DIR}/reviews/impl-review.md"
CHANGE_MD="${CHANGE_DIR}/change.md"
mkdir -p "${CHANGE_DIR}/reviews"

git config user.name "claude[bot]"
git config user.email "41898282+claude[bot]@users.noreply.github.com"

git add "$REVIEW_PATH" "$CHANGE_MD"
git commit -m "chore(review): impl-review for ${CHANGE_ID} [skip ci]

CI-generated implementation review.
Pull this branch and triage locally."

# Belt-and-suspenders: verify [skip ci] made it onto the commit before
# pushing. If the subject is missing the marker (e.g., a rebase or an
# amend stripped it), the push would retrigger this same workflow on
# the bot's own HEAD. Abort loudly — a failed push is recoverable via
# the PUSH_FAILED fallback below; a recursion loop isn't.
if ! git log -1 --format=%s | grep -Fq '[skip ci]'; then
  echo "ERROR: HEAD commit subject is missing [skip ci] — refusing to push to prevent workflow recursion" >&2
  exit 1
fi

# Retry once on concurrent-push race (common on active PRs)
git push || { git pull --rebase && git push; } || PUSH_FAILED=1

if [ "$PUSH_FAILED" = "1" ]; then
  # Don't lose the work — inline the report in a PR comment as a fallback.
  gh pr comment "$PR_NUMBER" --body "$(printf '⚠️ impl-review generated but push failed (branch moved). Report content below:\n\n<details><summary>Click to expand</summary>\n\n\`\`\`markdown\n%s\n\`\`\`\n\n</details>' "$(cat "$REVIEW_PATH")")"
  exit 0
fi
```

**The `[skip ci]` marker is load-bearing.** Without it, the push triggers this same workflow again and loops. Always include it.

**Idempotency: don't amend, always create a new commit.** If this workflow re-runs (e.g., rerun from the GHA UI, or a later push retriggers it), the review file at the same path is overwritten, and the new commit records the new review. Previous reviews live in the git history — that's the audit trail. Amending would erase it.

## Step 8: Post inline review comments

TaskUpdate: activeForm "Posting inline review"

Findings whose `Location` is a concrete `file:line` **and** whose line sits inside the PR's diff become inline review comments — anchored to the exact line in the "Files changed" tab. Findings without a line anchor (or whose line is outside the diff) are deferred to the summary comment in the next step.

**Use the MCP tool, not `gh api`.** claude-code-action v1 exposes `mcp__github_inline_comment__create_inline_comment` via its built-in MCP server. It wraps the per-comment endpoint (`POST /pulls/:n/comments`), which errors **loudly** on bad line positions — unlike the batched review endpoint, which silently drops invalid entries and leaves you with an empty review shell. Post each finding as its own tool call, with `confirmed: true` so the action's Haiku classifier doesn't buffer-then-filter (appropriate for a deterministic CI reviewer — every finding we emit is already the triage decision).

### Resolve the review file URL

Inline comment bodies link back to the committed report for the full Strength / Tradeoff / Confidence / Blind spot reasoning. Build `REVIEW_URL` against the just-pushed commit:

```bash
SHA=$(git rev-parse HEAD)
REVIEW_URL="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY}/blob/${SHA}/${REVIEW_PATH}"
```

### Classify findings: inline vs. summary-only

The GitHub Reviews API rejects comments on lines not in the diff, so verify before posting. For each finding, parse `Location`; if it's `file:line`, check that `line` is inside a `+` hunk for `file`:

```bash
line_in_diff() {
  local file="$1" line="$2"
  git diff --unified=0 "origin/${BASE}...HEAD" -- "$file" \
    | awk -v target="$line" '
        /^@@/ {
          match($0, /\+([0-9]+)(,([0-9]+))?/, m);
          start = m[1]; count = (m[3] == "" ? 1 : m[3]);
          if (target >= start && target < start + count) { found = 1; exit }
        }
        END { exit !found }
      '
}
```

Route each finding:

- **inline-eligible** → `Location` has `file:line`, `file` is in the PR diff, and `line_in_diff` returns true.
- **summary-only** → anything else: no line anchor, file not in diff, or line outside diff hunks (common for MISSING TEST, MISSING IMPL, and dimension-level findings).

Track counters: `N_INLINE`, `N_SUMMARY_ONLY`. Step 9 uses both in the summary header.

### Compose each inline comment body

Keep inline bodies scannable — reviewers read them fast while scrolling the diff. One-line severity tag, title, detail, one-line fix summary, link to the full report. End with an **invisible marker** so the next run can find and delete this comment when superseding:

```markdown
❌ **CRITICAL** · Safety & Quality · **F1 — SQL query built with string concatenation**

Plan specified parameterized queries in Phase 2; actual implementation uses template literals.

**Fix:** Replace the template literal with a parameterized query using `db.query($1, [value])`.

_See [full report](<REVIEW_URL>) for reasoning (Strength / Tradeoff / Confidence / Blind spot)._

<!-- impl-review-ci:marker -->
```

The marker must be present in **every** inline comment body — it's how the "Clean up prior run" subsection below identifies artifacts to retire. The full Fix-options grammar (Strength / Tradeoff / Confidence / Blind spot) stays in the committed report file — putting it inline clutters the diff view and duplicates content.

### Post each finding via the MCP tool

**Before** the first MCP call, capture a UTC timestamp — the cleanup subsection below uses it to tell "prior runs' comments" apart from the ones you're about to create:

```bash
NOW_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
```

For every inline-eligible finding, invoke `mcp__github_inline_comment__create_inline_comment` **once**. The call is synchronous — it posts immediately when `confirmed: true` is set. Track successes and failures per finding:

```
mcp__github_inline_comment__create_inline_comment({
  path: "<finding.file>",
  line: <finding.line>,
  side: "RIGHT",            // comment on the new version; LEFT is only for deleted lines
  confirmed: true,           // skip the Haiku classifier buffer — we're deterministic
  body: "<composed body incl. marker>"
})
```

Why `confirmed: true`: the action's default is to buffer unconfirmed calls, run them through a Haiku classifier ("is this a real review or a test?"), and post only the reals in a post-step. That's useful for conversational review flows where Claude is exploring. For this skill every finding is already a triage decision — we want them posted as-is, synchronously, so the workflow's verdict-check step sees the final state.

**Track outcomes:**

- Each successful call → increment `N_INLINE_POSTED`.
- Each failure → decrement the planned count, log the file:line, and add the finding to the summary-only list so it still reaches reviewers. Don't retry — the MCP tool's error message tells you why (line drifted out of diff, file was renamed, transient API issue) and retries rarely help.
- If **every** inline call failed: set `INLINE_POST_FAILED=1`. Step 9's fallback path shows all findings in the summary comment with a visible warning.

After all per-finding calls return, set `N_INLINE = N_INLINE_POSTED` and re-classify the failed-inline findings as summary-only. Step 9 uses the final counts.

**Don't use `gh api POST /pulls/:n/reviews` with a `comments[]` array.** That endpoint silently drops comments whose line isn't in a valid diff hunk position — you end up with a review shell and zero anchored comments. The MCP tool uses the per-comment endpoint, which errors loudly so we know which finding failed and why.

**Skip the whole subsection if `N_INLINE == 0`** — no inline-eligible findings, nothing to post. Step 9 renders everything as summary-only.

### Clean up prior run's inline comments

Only after at least one MCP call **succeeded** this run — delete prior bot inline comments identified by the marker. Post-new-then-delete-old is intentional: if all new posts failed, prior comments stay visible so reviewers aren't left with nothing.

Capture `NOW_ISO` **before** the first MCP call so it reliably precedes every comment this run just created; use it below to exclude those comments from the deletion list.

```bash
# NOW_ISO was captured earlier, before the first create_inline_comment call:
#   NOW_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)

if [ "$N_INLINE_POSTED" -gt 0 ]; then
  gh api --paginate "repos/{owner}/{repo}/pulls/${PR_NUMBER}/comments" \
    --jq ".[] | select(.body | contains(\"<!-- impl-review-ci:marker -->\")) | select(.created_at < \"${NOW_ISO}\") | .id" \
    | while read -r COMMENT_ID; do
        gh api --method DELETE \
          "repos/{owner}/{repo}/pulls/comments/${COMMENT_ID}" 2>/dev/null || true
      done
fi
```

The `|| true` on delete is deliberate — a transient API failure on one comment shouldn't abort cleanup of the rest. Leftover stragglers will get retired on the next run.

**Why `created_at < NOW_ISO` instead of capturing the new review's comment IDs?** Simpler, and robust to races where the POST succeeded but the API response shape changes. Any comment created before "now" is by definition from a prior run.

### Failure is non-fatal

Per-finding MCP failures (line drifted, file renamed, transient API issue) are already handled above — the failed finding moves to summary-only. The only remaining catastrophic case is **all** inline calls failing, which sets `INLINE_POST_FAILED=1`:

- If `INLINE_POST_FAILED=1`, Step 9 includes **all** findings in the summary comment with a warning at the top: `⚠️ Inline review failed to post; all findings shown below.`
- Otherwise, Step 9 lists only the summary-only findings (the inline ones live on the diff).

Never exit non-zero from the workflow over an inline-post failure — the report is committed, the summary will post, reviewers still have everything. A loud warning beats a red workflow.

## Step 9: Post the summary PR comment

TaskUpdate: activeForm "Posting summary comment"

The committed file has full detail; inline comments anchor findings to specific lines; this summary is the scannable entry point in the PR timeline — verdict, dimension table, and any findings that couldn't be posted inline.

### Compose and post

Body sections (in order): REJECTED gate banner (conditional), verdict header, plan + review file links, inline/summary counts, fallback note (conditional), dimension table, findings list (conditional), closing line, **marker**:

```bash
# REJECTED verdict → prepend a visible gate banner. The workflow step
# after claude-code-action reads the verdict from the committed report
# and fails the check; the banner tells reviewers what to do.
if [ "$OVERALL_VERDICT" = "REJECTED" ]; then
  REJECTION_BANNER=$'> ⛔ **This check will fail** because the verdict is `REJECTED`.\n> Add the `impl-review-override` label to the PR to bypass after reviewing the findings.\n\n'
else
  REJECTION_BANNER=""
fi

if [ "$INLINE_POST_FAILED" = "1" ]; then
  # Inline post failed — show all findings in the summary as fallback.
  FINDINGS_FOR_SUMMARY_MARKDOWN="$ALL_FINDINGS_MARKDOWN"
  FINDINGS_SECTION_HEADER="### All findings"
  FAILURE_NOTE=$'⚠️ Inline review failed to post; all findings shown below.\n\n'
  INLINE_LINE="**Inline comments:** failed to post — see findings below"
else
  # Inline succeeded — summary shows only findings that couldn't be anchored.
  FINDINGS_FOR_SUMMARY_MARKDOWN="$SUMMARY_ONLY_FINDINGS_MARKDOWN"
  FINDINGS_SECTION_HEADER="### Findings without a line anchor"
  FAILURE_NOTE=""
  INLINE_LINE="**Inline comments:** ${N_INLINE} posted on changed lines · ${N_SUMMARY_ONLY} without line anchor (below)"
fi

# Capture cutoff for prior-comment cleanup below.
NOW_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)

gh pr comment "$PR_NUMBER" --body "$(cat <<EOF
## 🔍 Implementation Review (CI)

${REJECTION_BANNER}**Verdict:** \`${OVERALL_VERDICT}\` — ${N_CRITICAL} critical, ${N_WARNINGS} warnings, ${N_OBSERVATIONS} observations
**Plan:** \`${PLAN}\`
**Review file:** [${REVIEW_PATH}](${REVIEW_URL})
${INLINE_LINE}

${FAILURE_NOTE}| Dimension | |
|---|---|
| Plan Adherence | ${V_PLAN} |
| Scope Discipline | ${V_SCOPE} |
| Safety & Quality | ${V_SAFETY} |
| Architecture | ${V_ARCH} |
| Pattern Consistency | ${V_PATTERN} |
| Test Coverage | ${V_TESTS} |
| Success Criteria | ${V_SUCCESS} |

${FINDINGS_SECTION_HEADER}

${FINDINGS_FOR_SUMMARY_MARKDOWN}

---

Pull this branch to see the full review at \`${REVIEW_PATH}\` and triage findings locally.

<!-- impl-review-ci:marker -->
EOF
)" && SUMMARY_POSTED=1
```

Render each summary-listed finding as one compact line (no Fix-options detail — that's in the file):

```
- **F3** `WARNING` · Test Coverage · `src/api/routes.ts` — new `/status` endpoint has no test. Plan listed `pnpm test -- src/api/routes.test.ts` in Success Criteria but that file wasn't modified.
- **F5** `CRITICAL` · Plan Adherence · _(no file)_ — migration in Phase 3 is missing from the diff entirely.
```

Cap the summary list at 5. If more exist, append `…and N more in the full report.`

### Clean up prior run's summary comment

Same post-new-then-delete-old pattern as inline cleanup. Only retire prior summaries if the new one posted successfully:

```bash
if [ "$SUMMARY_POSTED" = "1" ]; then
  gh api --paginate "repos/{owner}/{repo}/issues/${PR_NUMBER}/comments" \
    --jq ".[] | select(.body | contains(\"<!-- impl-review-ci:marker -->\")) | select(.created_at < \"${NOW_ISO}\") | .id" \
    | while read -r COMMENT_ID; do
        gh api --method DELETE \
          "repos/{owner}/{repo}/issues/comments/${COMMENT_ID}" 2>/dev/null || true
      done
fi
```

Note the endpoint difference: summary comments on the Conversation tab live under `/issues/:n/comments` (PR summary comments are GitHub-issues under the hood), while the inline review comments in Step 8 live under `/pulls/:n/comments`.

### Edge cases

- `N_SUMMARY_ONLY == 0` and `INLINE_POST_FAILED == 0` → omit the "Findings without a line anchor" section entirely. Verdict + dimension table + inline count is enough; no empty list.
- `N_INLINE == 0` and `N_SUMMARY_ONLY == 0` → no findings at all. Still post the summary (verdict table confirms PASS across dimensions); skip the findings section.

Mark the CI review task `completed`. You're done — the workflow's verdict-check step (after claude-code-action) reads the committed report's verdict and fails the check when `REJECTED`, respecting the `impl-review-override` label.

## Operational notes

- **Report marker is load-bearing.** The `<!-- IMPL-REVIEW-REPORT -->` first-line comment and the per-finding `Decision: PENDING` fields are the output contract with downstream tooling. Don't change their shape.
- **Never edit source code.** All code changes flow through a separate implementation step after triage. The review skill reads, analyzes, and writes the report — nothing else.
- **Inline review is advisory, never blocking.** The MCP tool creates review comments (via `POST /pulls/:n/comments`), not formal PR review decisions — so there's no `event: APPROVE` / `REQUEST_CHANGES` surface for the skill to trip over. Should a future version ever submit a formal review, it must use `event: COMMENT`: the skill has no standing to approve, and request-changes is a human governance decision. The REJECTED gate — which *is* blocking — lives in the workflow's verdict-check step, not in any Claude-side review submission.
- **The `REJECTED` verdict is the gating signal.** The workflow's post-review step parses the verdict from the committed report file (`- **Verdict**: REJECTED`) and exits non-zero unless the PR has the `impl-review-override` label. That's the **only** way this skill fails a check — the skill itself exits 0 even when the verdict is REJECTED, because the gate lives in the workflow, not in Claude's turn. This separation matters: a Claude-side failure would also skip the PR comment and confuse reviewers; a workflow-side gate fails cleanly after all artifacts are posted.
- **Dedup marker is load-bearing.** Every inline comment body and the summary comment end with `<!-- impl-review-ci:marker -->`. The next run uses this marker to find and delete prior artifacts, preventing accumulation across re-runs. Cleanup follows post-new-then-delete-old order: if the new post fails, the prior artifact stays visible so reviewers never see zero coverage.
- **Don't echo secrets.** Subagents are read/grep/bash-only, but still: never dump environment variables into the report or comment. If a finding references a leaked secret (hardcoded token, credential in code), redact the actual value — write `<REDACTED token matching pattern X>`, not the literal string.
- **Cost of running tests.** Agent 3 runs the plan's test commands. For large suites this is time-consuming. If a project wants to skip execution for specific suites, the plan should omit those commands from Automated Verification — this skill only runs what the plan declares, so the plan is the control surface.
- **Non-standard plan shape.** If the plan file exists but doesn't follow the expected anatomy (no Success Criteria, no Changes Required, etc.), do the review with whatever you can extract, and note the structural gaps in the report. Don't refuse to run — partial signal beats no signal.
- **Subagent token budgets.** The three subagents work in parallel, so the main context stays lean — it only holds the plan text, the diff summary, and each agent's final findings report. If a subagent's report gets unwieldy, ask it to return only the highest-severity findings it identified, not the full investigation trace.
