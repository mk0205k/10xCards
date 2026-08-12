/**
 * Prompt text for the implementation reviewer, decoupled from agent wiring.
 *
 * This concerns the *implementation review* — grading a diff against the plan it
 * claims to implement (adherence and scope discipline), NOT a "plan review" of
 * the plan's own quality. The grading criteria are not held here: they are the
 * shipped `impl-review-instructions.md` reference, fetched at review time by the
 * `readImplReviewCriteria` tool. `buildPlanReviewPrompt` assembles the per-review
 * user prompt from a PR's title/description, the diff, and the loaded plan.
 */

/** Inputs for an implementation review: the PR, its diff, and the plan. */
export interface PlanReviewInput {
  title: string;
  description: string;
  diff: string;
  planPath: string;
  planContents: string;
}

/** Build the user prompt for reviewing a diff against its implementation plan. */
export function buildPlanReviewPrompt({ title, description, diff, planPath, planContents }: PlanReviewInput): string {
  return (
    "Review whether the following pull request implements its referenced plan, and score " +
    "plan adherence and scope discipline.\n\n" +
    `## Title\n${title}\n\n` +
    `## Description\n${description || "(no description provided)"}\n\n` +
    `## Implementation plan (${planPath})\n${planContents}\n\n` +
    `## Diff\n\`\`\`diff\n${diff}\n\`\`\``
  );
}
