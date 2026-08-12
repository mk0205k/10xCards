import { readFile } from "node:fs/promises";
import { tool } from "ai";
import { z } from "zod";
import { findRepoRoot, resolvePlanPath, PlanPathError } from "./plan-path.js";
import { trace } from "../log.js";

/**
 * The `readPlan` tool: reads an implementation plan from
 * `<repo-root>/context/changes/<id>/plan.md` so the agent can review a diff
 * against the plan it claims to implement.
 *
 * Resolution and confinement live in `plan-path.ts`; this wrapper adds the
 * side-effecting file read and the agent-facing result contract:
 *  - invalid input (empty target, out-of-bounds path) throws so the SDK surfaces
 *    a `tool-error` the model can react to;
 *  - a missing/unreadable file returns a non-throwing `{ found: false }` so the
 *    agent can proceed without the plan rather than aborting the run.
 *
 * This tool only reads the plan. The rubric for reviewing the implementation
 * against that plan is a separate concern, fetched via `readImplReviewCriteria`.
 */

/** Successful read: the plan file existed and was returned. */
export interface ReadPlanFound {
  found: true;
  changeId: string;
  path: string;
  contents: string;
}

/** The plan file was missing or unreadable; the agent proceeds without it. */
export interface ReadPlanNotFound {
  found: false;
  target: string;
  message: string;
}

export type ReadPlanResult = ReadPlanFound | ReadPlanNotFound;

/** Is this a Node "file not found"/"is a directory" style error? */
function isMissingFileError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "EISDIR" || code === "ENOTDIR";
}

export const readPlanTool = tool({
  description:
    "Read an implementation plan from context/changes/<change-id>/plan.md. " +
    "Accepts either a change-id (e.g. 'oauth-login') or a path to a plan.md " +
    "under context/changes/. Returns the plan contents when found, or " +
    "{ found: false } when no such plan exists so you can proceed without it.",
  inputSchema: z.object({
    target: z.string().describe("A change-id (e.g. 'oauth-login') or a path to a plan.md under context/changes/."),
  }),
  execute: async ({ target }): Promise<ReadPlanResult> => {
    // Invalid/out-of-bounds input throws (surfaced as a tool-error); a present
    // resolver result that points at a missing file is the not-found path.
    trace(`tool readPlan · resolving target=${target}`);
    const repoRoot = findRepoRoot();
    const resolved = resolvePlanPath(target, repoRoot);
    trace(`tool readPlan · changeId=${resolved.changeId} · reading ${resolved.relPath}`);

    try {
      const contents = await readFile(resolved.absPath, "utf8");
      trace(`tool readPlan · found ${resolved.relPath} (${contents.length} chars)`);
      return { found: true, changeId: resolved.changeId, path: resolved.relPath, contents };
    } catch (error: unknown) {
      if (isMissingFileError(error)) {
        trace(`tool readPlan · no plan at ${resolved.relPath} — proceeding without it`);
        return {
          found: false,
          target,
          message: `No plan found at ${resolved.relPath}.`,
        };
      }
      // Re-throw genuinely unexpected read failures (permissions, etc.).
      trace(`tool readPlan · unexpected read error for ${resolved.relPath}: ${String(error)}`);
      throw error;
    }
  },
});

export { PlanPathError };
