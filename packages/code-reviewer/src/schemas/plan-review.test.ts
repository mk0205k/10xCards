import { describe, expect, it } from "vitest";
import { z } from "zod";
import { PlanReviewResult } from "./plan-review.js";

/**
 * Locks the plan-review schema's parse contract and the Anthropic
 * structured-output constraint: no `minimum`/`maximum` bounds on integer fields
 * (which the provider rejects).
 */
describe("PlanReviewResult", () => {
  it("parses a representative object", () => {
    const sample = {
      criteria: {
        planAdherence: { score: 8, rationale: "Implements the planned tool surface." },
        scopeDiscipline: { score: 9, rationale: "No out-of-scope changes." },
      },
      unimplementedItems: ["Phase 6 workflow wiring"],
      unplannedChanges: [],
      verdict: "pass" as const,
      summary: "Solid plan adherence; one phase remains.",
    };
    expect(() => PlanReviewResult.parse(sample)).not.toThrow();
    const parsed = PlanReviewResult.parse(sample);
    expect(parsed.verdict).toBe("pass");
    expect(parsed.criteria.planAdherence.score).toBe(8);
  });

  it("emits no minimum/maximum bounds on integer fields", () => {
    const json = JSON.stringify(z.toJSONSchema(PlanReviewResult));
    expect(json).not.toContain('"minimum"');
    expect(json).not.toContain('"maximum"');
  });
});
