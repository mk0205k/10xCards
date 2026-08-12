import { z } from "zod";
import { ReviewCriterion } from "./review.js";

/**
 * Schema for the structured output of a plan-implementation review — grading a
 * diff against the implementation plan it claims to implement (adherence and
 * drift), distinct from the six-criteria code review in `./review.ts`.
 *
 * As with `ReviewResult`, the constant doubles as its inferred type under one
 * identifier, and scored criteria use the plain-`z.number()` `ReviewCriterion`
 * shape — Anthropic structured output rejects `minimum`/`maximum`/`.int()`
 * bounds on integers, so the 1–10 contract is enforced by the rubric, not the
 * JSON schema.
 */

/** Adherence/drift criteria, each a 1–10 score plus rationale. */
export const PlanReviewCriteria = z.object({
  planAdherence: ReviewCriterion.describe(
    "Does the diff implement what the plan specifies, in line with its stated intent and contracts? " +
      "1: the change ignores or contradicts the plan. " +
      "10: faithfully implements the planned work as described."
  ),
  scopeDiscipline: ReviewCriterion.describe(
    "Does the diff stay within the plan's scope without unplanned, out-of-band changes? " +
      "1: substantial unrelated or unplanned changes ride along. " +
      "10: changes are confined to what the plan called for."
  ),
});
export type PlanReviewCriteria = z.infer<typeof PlanReviewCriteria>;

/** The full structured result of reviewing a diff against its plan. */
export const PlanReviewResult = z.object({
  criteria: PlanReviewCriteria,
  unimplementedItems: z
    .array(z.string())
    .describe("Plan items not yet implemented by the diff. Empty if the plan is fully implemented."),
  unplannedChanges: z
    .array(z.string())
    .describe("Changes present in the diff that the plan did not call for. Empty if there is no drift."),
  verdict: z.enum(["pass", "fail"]).describe("Authoritative verdict on whether the diff implements the plan."),
  summary: z.string().describe("Markdown summary of plan adherence for a PR comment."),
});
export type PlanReviewResult = z.infer<typeof PlanReviewResult>;
