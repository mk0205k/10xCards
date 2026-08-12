import type { ReviewResult } from "../schemas/review.js";
import type { PlanReviewResult } from "../schemas/plan-review.js";

/**
 * Deterministic, in-code markdown renderers for PR review comments. The model
 * supplies the structured scores/rationale; the comment *layout* is rendered
 * here so it can't drift run-to-run. These are pure functions — no I/O.
 *
 * `renderCodeReviewComment` reproduces the layout previously produced by
 * `.github/actions/ai-code-review/render-comment.mjs` (heading, verdict badge,
 * truncation note, criteria table, rationale, summary).
 */

/** Display labels for the six code-review criteria, in comment order. */
const CRITERIA_LABELS: Record<keyof ReviewResult["criteria"], string> = {
  implementationCorrectness: "Implementation Correctness",
  idiomaticity: "Idiomaticity",
  complexity: "Complexity",
  testRiskCoverage: "Test / Risk Coverage",
  documentation: "Documentation",
  securitySafety: "Security / Safety",
};

/** Map a verdict to its comment badge. */
function verdictBadge(verdict: "pass" | "fail"): string {
  return verdict === "pass" ? "✅ Pass" : "❌ Fail";
}

/**
 * Render a six-criteria code review into the established markdown comment body.
 * When `truncated`, prepends the "partial review" note (the flag is read from
 * env by the caller, never trusted to the model).
 */
export function renderCodeReviewComment(result: ReviewResult, opts: { truncated: boolean }): string {
  const lines: string[] = [];
  lines.push("## 🤖 AI Code Review");
  lines.push("");
  lines.push(`**Verdict:** ${verdictBadge(result.verdict)}`);
  lines.push("");

  if (opts.truncated) {
    lines.push("> ⚠️ Diff truncated at 3000 lines — this review is partial.");
    lines.push("");
  }

  lines.push("| Criterion | Score |");
  lines.push("| --- | --- |");
  for (const [key, label] of Object.entries(CRITERIA_LABELS)) {
    const score = result.criteria[key as keyof ReviewResult["criteria"]]?.score ?? "—";
    lines.push(`| ${label} | ${score}/10 |`);
  }
  lines.push("");

  lines.push("### Rationale");
  lines.push("");
  for (const [key, label] of Object.entries(CRITERIA_LABELS)) {
    const crit = result.criteria[key as keyof ReviewResult["criteria"]];
    if (!crit) continue;
    lines.push(`- **${label} (${crit.score}/10):** ${crit.rationale}`);
  }
  lines.push("");

  lines.push("### Summary");
  lines.push("");
  lines.push(result.summary);
  lines.push("");

  return lines.join("\n");
}

/** Display labels for the two plan-review criteria, in comment order. */
const PLAN_CRITERIA_LABELS: Record<keyof PlanReviewResult["criteria"], string> = {
  planAdherence: "Plan Adherence",
  scopeDiscipline: "Scope Discipline",
};

/** Render a markdown bullet list, or a "none" placeholder when empty. */
function renderList(items: string[], emptyLabel: string): string[] {
  if (items.length === 0) return [`- _${emptyLabel}_`];
  return items.map((item) => `- ${item}`);
}

/**
 * Render a plan-implementation review into a markdown comment body: verdict
 * badge, adherence/scope scores, unimplemented/unplanned lists, and summary.
 */
export function renderPlanReviewComment(result: PlanReviewResult): string {
  const lines: string[] = [];
  lines.push("## 🤖 AI Plan-Implementation Review");
  lines.push("");
  lines.push(`**Verdict:** ${verdictBadge(result.verdict)}`);
  lines.push("");

  lines.push("| Criterion | Score |");
  lines.push("| --- | --- |");
  for (const [key, label] of Object.entries(PLAN_CRITERIA_LABELS)) {
    const score = result.criteria[key as keyof PlanReviewResult["criteria"]]?.score ?? "—";
    lines.push(`| ${label} | ${score}/10 |`);
  }
  lines.push("");

  lines.push("### Rationale");
  lines.push("");
  for (const [key, label] of Object.entries(PLAN_CRITERIA_LABELS)) {
    const crit = result.criteria[key as keyof PlanReviewResult["criteria"]];
    if (!crit) continue;
    lines.push(`- **${label} (${crit.score}/10):** ${crit.rationale}`);
  }
  lines.push("");

  lines.push("### Unimplemented Plan Items");
  lines.push("");
  lines.push(...renderList(result.unimplementedItems, "None — the plan is fully implemented."));
  lines.push("");

  lines.push("### Unplanned Changes");
  lines.push("");
  lines.push(...renderList(result.unplannedChanges, "None — no drift from the plan."));
  lines.push("");

  lines.push("### Summary");
  lines.push("");
  lines.push(result.summary);
  lines.push("");

  return lines.join("\n");
}
