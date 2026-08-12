import { describe, expect, it } from "vitest";
import { renderCodeReviewComment, renderPlanReviewComment } from "./comment.js";
import type { ReviewResult } from "../schemas/review.js";
import type { PlanReviewResult } from "../schemas/plan-review.js";

/**
 * Locks the rendered comment structure so formatting can't silently regress:
 * verdict badge, truncation-note gating, the six criteria rows, and the
 * plan-review lists.
 */

function sampleReview(verdict: "pass" | "fail"): ReviewResult {
  const crit = (score: number) => ({ score, rationale: `rationale ${score}` });
  return {
    criteria: {
      implementationCorrectness: crit(9),
      idiomaticity: crit(8),
      complexity: crit(7),
      testRiskCoverage: crit(6),
      documentation: crit(5),
      securitySafety: crit(10),
    },
    verdict,
    summary: "A concise summary.",
  };
}

describe("renderCodeReviewComment", () => {
  it("renders the pass badge", () => {
    const body = renderCodeReviewComment(sampleReview("pass"), { truncated: false });
    expect(body).toContain("**Verdict:** ✅ Pass");
  });

  it("renders the fail badge", () => {
    const body = renderCodeReviewComment(sampleReview("fail"), { truncated: false });
    expect(body).toContain("**Verdict:** ❌ Fail");
  });

  it("includes all six criteria rows", () => {
    const body = renderCodeReviewComment(sampleReview("pass"), { truncated: false });
    for (const label of [
      "Implementation Correctness",
      "Idiomaticity",
      "Complexity",
      "Test / Risk Coverage",
      "Documentation",
      "Security / Safety",
    ]) {
      expect(body).toContain(`| ${label} |`);
    }
  });

  it("shows the truncation note only when truncated", () => {
    const truncated = renderCodeReviewComment(sampleReview("pass"), { truncated: true });
    const full = renderCodeReviewComment(sampleReview("pass"), { truncated: false });
    expect(truncated).toContain("Diff truncated at 3000 lines");
    expect(full).not.toContain("Diff truncated");
  });
});

function samplePlanReview(overrides: Partial<PlanReviewResult> = {}): PlanReviewResult {
  return {
    criteria: {
      planAdherence: { score: 8, rationale: "mostly adheres" },
      scopeDiscipline: { score: 9, rationale: "tight scope" },
    },
    unimplementedItems: ["Phase 6 wiring"],
    unplannedChanges: [],
    verdict: "pass",
    summary: "Plan mostly implemented.",
    ...overrides,
  };
}

describe("renderPlanReviewComment", () => {
  it("renders the verdict badge and plan criteria", () => {
    const body = renderPlanReviewComment(samplePlanReview());
    expect(body).toContain("**Verdict:** ✅ Pass");
    expect(body).toContain("| Plan Adherence |");
    expect(body).toContain("| Scope Discipline |");
  });

  it("renders unimplemented items and the empty unplanned placeholder", () => {
    const body = renderPlanReviewComment(samplePlanReview());
    expect(body).toContain("- Phase 6 wiring");
    expect(body).toContain("_None — no drift from the plan._");
  });

  it("renders unplanned changes when present", () => {
    const body = renderPlanReviewComment(
      samplePlanReview({ unplannedChanges: ["touched unrelated config"], unimplementedItems: [] })
    );
    expect(body).toContain("- touched unrelated config");
    expect(body).toContain("_None — the plan is fully implemented._");
  });
});
