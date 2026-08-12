import type { ReviewResult } from "../../src/index.ts";

interface GradingResult {
  pass: boolean;
  score: number;
  reason: string;
}

const MIN_SCORE = 1;
const MAX_SCORE = 10;

function coerce(output: unknown): ReviewResult | null {
  if (typeof output === "string") {
    try {
      return JSON.parse(output) as ReviewResult;
    } catch {
      return null;
    }
  }
  if (output && typeof output === "object") {
    return output as ReviewResult;
  }
  return null;
}

export default function reviewFails(output: unknown): GradingResult {
  const result = coerce(output);
  if (!result) {
    return { pass: false, score: 0, reason: `Expected a ReviewResult object/JSON, got ${typeof output}` };
  }

  if (result.verdict !== "fail") {
    return {
      pass: false,
      score: 0,
      reason: `verdict was ${JSON.stringify(result.verdict)}, expected "fail" — the migration has three real defects`,
    };
  }

  const criteria = result.criteria as Record<string, { score: unknown; rationale: unknown }> | undefined;
  if (!criteria || typeof criteria !== "object") {
    return { pass: false, score: 0, reason: "ReviewResult.criteria is missing or not an object" };
  }

  const expected = [
    "implementationCorrectness",
    "idiomaticity",
    "complexity",
    "testRiskCoverage",
    "documentation",
    "securitySafety",
  ];

  for (const name of expected) {
    const criterion = criteria[name];
    if (!criterion || typeof criterion !== "object") {
      return { pass: false, score: 0, reason: `criterion "${name}" is missing` };
    }
    const { score, rationale } = criterion;
    if (typeof score !== "number" || !Number.isInteger(score) || score < MIN_SCORE || score > MAX_SCORE) {
      return {
        pass: false,
        score: 0,
        reason: `criterion "${name}" score=${JSON.stringify(score)} is not an integer in ${MIN_SCORE}–${MAX_SCORE}`,
      };
    }
    if (typeof rationale !== "string" || rationale.trim().length === 0) {
      return { pass: false, score: 0, reason: `criterion "${name}" has no non-empty string rationale` };
    }
  }

  return {
    pass: true,
    score: 1,
    reason: "verdict=fail and all six criteria are integers in 1–10 with non-empty rationales",
  };
}
