import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tool } from "ai";
import { z } from "zod";
import { trace } from "../log.js";

/**
 * The `readImplReviewCriteria` tool: returns the rubric for an *implementation
 * review* — judging whether a diff faithfully implements the plan it references
 * (plan adherence and scope discipline).
 *
 * Note the deliberate naming: this is NOT a "plan review" (a critique of the
 * plan's own quality/consistency). It reviews the *implementation against* the
 * plan. The criteria live in the shipped `impl-review-instructions.md` reference
 * so they have a single editable source of truth, and they're fetched on demand
 * — the agent loads them only when a plan is found and an implementation review
 * is actually warranted, rather than carrying them in every run's system prompt.
 */

/** The implementation-review criteria, relative to the package root. */
const CRITERIA_RELPATH = path.join(
  ".agents",
  "skills",
  "10x-impl-review-ci",
  "references",
  "impl-review-instructions.md"
);

/** Walk up from this module to the nearest ancestor carrying a `package.json`. */
function findPackageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error("Could not locate the code-reviewer package root: no package.json ancestor.");
    }
    dir = parent;
  }
}

let cachedCriteria: string | undefined;

/**
 * Load the implementation-review criteria from the shipped reference. Cached
 * after the first read; the file is bundled with the package, so a read failure
 * is a packaging error and is allowed to throw.
 */
export async function loadImplReviewCriteria(): Promise<string> {
  if (cachedCriteria !== undefined) {
    trace(`tool readImplReviewCriteria · cache hit (${cachedCriteria.length} chars)`);
    return cachedCriteria;
  }
  const file = path.join(findPackageRoot(), CRITERIA_RELPATH);
  trace(`tool readImplReviewCriteria · loading rubric from ${CRITERIA_RELPATH}`);
  cachedCriteria = await readFile(file, "utf8");
  trace(`tool readImplReviewCriteria · loaded ${cachedCriteria.length} chars`);
  return cachedCriteria;
}

/** The criteria text the agent grades against. */
export interface ImplReviewCriteria {
  criteria: string;
}

export const readImplReviewCriteriaTool = tool({
  description:
    "Read the implementation-review criteria: the rubric for judging whether a diff faithfully " +
    "implements the plan it references (plan adherence and scope discipline). This is NOT a review " +
    "of the plan's own quality — it grades the implementation against the plan. Call this after " +
    "readPlan returns found: true, then review the diff against the plan using the returned criteria.",
  inputSchema: z.object({}),
  execute: async (): Promise<ImplReviewCriteria> => {
    return { criteria: await loadImplReviewCriteria() };
  },
});
