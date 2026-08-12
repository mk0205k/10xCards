import { z } from "zod";

/**
 * Schemas for the structured output of a PR code review.
 *
 * Each schema constant doubles as its inferred type under the same identifier
 * (`export const X` + `export type X = z.infer<typeof X>`), so both the agent
 * module and the public barrel import the value and the type from one place.
 *
 * The review scores six criteria on a 1–10 scale, emits an authoritative
 * pass/fail verdict, and produces a comment-ready markdown summary.
 */

/**
 * A single scored criterion: a 1–10 integer plus the reasoning behind it.
 *
 * `score` is a plain `z.number()` rather than `z.number().int().min(1).max(10)`:
 * Anthropic structured output rejects `minimum`/`maximum` on integer types
 * ("For 'integer' type, properties maximum, minimum are not supported"), and
 * `.int()` itself emits safe-integer min/max bounds that trip the same check.
 * The integer-1-to-10 contract is therefore enforced by the rubric (this
 * description + the system/user prompt), not by the JSON schema.
 */
export const ReviewCriterion = z.object({
  score: z.number().describe("Integer score from 1 (worst) to 10 (best)."),
  rationale: z.string().describe("Why this score was given; concrete enough to explain a low score."),
});
export type ReviewCriterion = z.infer<typeof ReviewCriterion>;

/** The six review criteria, each scored 1–10 with a rationale. */
export const ReviewCriteria = z.object({
  implementationCorrectness: ReviewCriterion.describe(
    "Does the code do what it claims, handling edge cases and error paths without regressions? " +
      "1: logic broken, misses obvious edge/error cases, or silently regresses. " +
      "10: correct across happy path, edge cases, and failure modes with no regressions."
  ),
  idiomaticity: ReviewCriterion.describe(
    "Does the code follow language, framework, and project conventions a fluent reader expects? " +
      "1: fights the stack's idioms and the repo's patterns, reads as foreign. " +
      "10: indistinguishable from well-written surrounding code."
  ),
  complexity: ReviewCriterion.describe(
    "Is the solution as simple as the problem allows, without needless abstraction? " +
      "1: over-engineered or tangled, accidental complexity obscures intent. " +
      "10: minimal and clear, the simplest design that solves the problem completely."
  ),
  testRiskCoverage: ReviewCriterion.describe(
    "Are meaningful behaviors and risky paths tested proportional to their risk? " +
      "1: risky logic ships untested; tests absent, trivial, or assert nothing useful. " +
      "10: risk-weighted coverage — the parts most likely to break are tested deliberately."
  ),
  documentation: ReviewCriterion.describe(
    "Are non-obvious decisions, public surfaces, and tricky code explained where needed? " +
      "1: opaque — no comments/docs where needed, intent must be reverse-engineered. " +
      "10: just enough docs to explain the 'why' without restating the obvious."
  ),
  securitySafety: ReviewCriterion.describe(
    "Does the change avoid vulnerabilities, leaking secrets, or unsafe handling of untrusted input? " +
      "1: introduces an exploitable flaw, leaks secrets, or trusts untrusted input unsafely. " +
      "10: input validated, secrets handled correctly, no new attack surface opened."
  ),
});
export type ReviewCriteria = z.infer<typeof ReviewCriteria>;

/** The full structured result of reviewing a pull request. */
export const ReviewResult = z.object({
  criteria: ReviewCriteria,
  verdict: z.enum(["pass", "fail"]).describe("Authoritative overall verdict for the change."),
  summary: z.string().describe("Markdown summary for a PR comment."),
});
export type ReviewResult = z.infer<typeof ReviewResult>;
