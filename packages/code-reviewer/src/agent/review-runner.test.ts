import { describe, expect, it } from "vitest";
import { recoverOutcome } from "./review-runner.js";

/**
 * Locks verdict recovery from `result.steps`: the verdict comes from the
 * `postCodeReview` call, and a run with no code comment defaults to `fail` so
 * a broken run never silently passes.
 */

function postCall(kind: "code" | "plan", verdict: "pass" | "fail") {
  return {
    toolName: kind === "code" ? "postCodeReview" : "postPlanReview",
    input: { review: { verdict } },
  };
}

describe("recoverOutcome", () => {
  it("recovers the verdict from a postCodeReview call", () => {
    const steps = [{ toolCalls: [postCall("code", "pass")] }];
    expect(recoverOutcome(steps)).toEqual({ verdict: "pass", postedComments: 1 });
  });

  it("recovers a fail verdict from the code call", () => {
    const steps = [{ toolCalls: [postCall("code", "fail")] }];
    expect(recoverOutcome(steps)).toEqual({ verdict: "fail", postedComments: 1 });
  });

  it("counts both code and plan comments, taking the verdict from code", () => {
    const steps = [{ toolCalls: [postCall("code", "pass")] }, { toolCalls: [postCall("plan", "fail")] }];
    expect(recoverOutcome(steps)).toEqual({ verdict: "pass", postedComments: 2 });
  });

  it("defaults to fail when no code comment was posted", () => {
    expect(recoverOutcome([{ toolCalls: [] }])).toEqual({ verdict: "fail", postedComments: 0 });
    expect(recoverOutcome([{ toolCalls: [postCall("plan", "pass")] }])).toEqual({
      verdict: "fail",
      postedComments: 1,
    });
  });

  it("ignores non-post tool calls when counting", () => {
    const steps = [{ toolCalls: [{ toolName: "readPlan", input: { target: "x" } }, postCall("code", "pass")] }];
    expect(recoverOutcome(steps)).toEqual({ verdict: "pass", postedComments: 1 });
  });
});
