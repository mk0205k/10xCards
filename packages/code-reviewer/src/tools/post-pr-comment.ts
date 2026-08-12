import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { tool } from "ai";
import { z } from "zod";
import { ReviewResult } from "../schemas/review.js";
import { PlanReviewResult } from "../schemas/plan-review.js";
import { renderCodeReviewComment, renderPlanReviewComment } from "../render/comment.js";
import { detectGitHubEnv } from "./github-env.js";
import { trace } from "../log.js";

/**
 * Two tools — `postCodeReview` and `postPlanReview` — that render a structured
 * review payload into the deterministic markdown body and post it as a fresh PR
 * comment via `gh`. Posting is gated on a resolvable PR number (`PR_NUMBER`) —
 * NOT on being inside GitHub Actions — so a local run with `PR_NUMBER` set (and
 * `gh` authed) posts for real. The rendered body is ALWAYS written to stderr
 * first, so every run is observable whether or not it posts.
 *
 * We ship *two* tools instead of one `z.discriminatedUnion` because the AI SDK
 * v6 → OpenAI/OpenRouter tool-schema conversion wraps root-level unions in a
 * `{"parameter": …}` envelope that Zod's discriminator can't see through — the
 * model repeatedly fails validation despite emitting the right kind. Two plain
 * `z.object` schemas at the root sidestep the wrapping and also give the model
 * a clearer signal: one tool, one purpose.
 *
 * The model supplies only the structured scores/rationale; the layout is
 * rendered in-code, and the diff-truncation note is read from `DIFF_TRUNCATED`
 * in the environment — never from the model-facing input schema.
 */

/** Result of a posting attempt. */
export type PostResult =
  | { posted: true; kind: "code" | "plan" }
  | { posted: false; reason: string; kind: "code" | "plan" };

/**
 * Post a comment body to a PR via `gh`, passing the body by file (not inline) to
 * avoid arg-size and shell-escaping limits — mirroring the diff-via-stdin
 * rationale in `cli.ts`. Extracted so the exec boundary is mockable in tests.
 */
export function postCommentViaGh(prNumber: string, body: string): void {
  const bodyFile = path.join(tmpdir(), `ai-cr-comment-${prNumber}-${process.pid}.md`);
  writeFileSync(bodyFile, body, "utf8");
  trace(`tool post*Review · running: gh pr comment ${prNumber} --body-file ${bodyFile}`);
  // `gh pr comment` prints the new comment's URL to *its* stdout. The CI step
  // running us redirects our stdout into the result JSON file (`{ verdict }`),
  // so letting gh inherit fd 1 corrupts that JSON (`JSON.parse` then fails on
  // the leading `https://…`). Route gh's stdout to our stderr (fd 2) instead:
  // the URL stays visible in CI logs but never reaches the result file. stdin
  // is ignored; stderr is inherited as before.
  execFileSync("gh", ["pr", "comment", prNumber, "--body-file", bodyFile], {
    stdio: ["ignore", 2, "inherit"],
  });
}

/** Post-and-render helper shared by both tools; the model-facing surface is per-kind. */
async function postReviewComment(kind: "code" | "plan", body: string): Promise<PostResult> {
  const env = detectGitHubEnv();
  // Resolve the target PR independently of CI: posting works wherever a PR
  // number is available (GitHub Actions or a local run with PR_NUMBER set),
  // not only inside GitHub Actions.
  const prNumber = env.prNumber ?? process.env.PR_NUMBER?.trim();
  trace(
    `tool post${kind === "code" ? "CodeReview" : "PlanReview"} · rendered ${body.length} chars · ` +
      `inGitHub=${env.inGitHub} · pr=${prNumber ?? "—"}`
  );

  // Always log the rendered comment first: locally it's the visible artifact of
  // the run; in CI it mirrors what was posted into the job log.
  const target = prNumber ? `posting to PR #${prNumber}` : "no PR target — not posting";
  process.stderr.write(`\n--- ${kind} review comment (${target}) ---\n`);
  process.stderr.write(`${body}\n`);

  if (!prNumber) {
    trace(`tool post${kind === "code" ? "CodeReview" : "PlanReview"} · no PR number — logged ${kind} comment, not posting`);
    return { posted: false, reason: "no-pr-number", kind };
  }

  postCommentViaGh(prNumber, body);
  trace(`tool post${kind === "code" ? "CodeReview" : "PlanReview"} · posted ${kind} comment to PR #${prNumber}`);
  return { posted: true, kind };
}

export const postCodeReviewTool = tool({
  description:
    "Post the six-criteria code review as a PR comment. Call exactly once per run with the structured " +
    "review payload; the markdown body is rendered deterministically in code.",
  inputSchema: z.object({
    review: ReviewResult.describe("The six-criteria code review incl. verdict and summary."),
  }),
  execute: async ({ review }): Promise<PostResult> => {
    trace("tool postCodeReview · rendering code review comment");
    const body = renderCodeReviewComment(review, { truncated: process.env.DIFF_TRUNCATED === "true" });
    return postReviewComment("code", body);
  },
});

export const postPlanReviewTool = tool({
  description:
    "Post an implementation-review comment: the diff judged against the plan it claims to implement " +
    "(adherence + scope). This is NOT a review of the plan itself. Call at most once per run, only " +
    "after readPlan returned found: true.",
  inputSchema: z.object({
    review: PlanReviewResult.describe("The implementation review incl. verdict and summary."),
  }),
  execute: async ({ review }): Promise<PostResult> => {
    trace("tool postPlanReview · rendering plan review comment");
    const body = renderPlanReviewComment(review);
    return postReviewComment("plan", body);
  },
});
