/**
 * Public surface of the code reviewer.
 *
 * Exposes only the eval/consumer-facing API — `reviewCode` plus the review
 * schemas and types. Provider and agent internals are intentionally not
 * re-exported. No runnable side effects live here.
 */

export { reviewCode, reviewCodeWithUsage } from "./agent/reviewer.js";
export type { ReviewOptions, ReviewCodeResult } from "./agent/reviewer.js";
export type { ReviewUsage } from "./provider/usage.js";
export { runReview } from "./agent/review-runner.js";
export type { RunReviewOptions, RunReviewResult } from "./agent/review-runner.js";
export type { ReviewInput } from "./prompts/review.js";
export { ReviewCriterion, ReviewCriteria, ReviewResult } from "./schemas/review.js";
export { PlanReviewCriteria, PlanReviewResult } from "./schemas/plan-review.js";
