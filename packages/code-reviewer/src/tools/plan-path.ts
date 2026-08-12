import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Pure, synchronous resolution of an implementation-plan path under
 * `<repo-root>/context/changes/`. Splitting the path logic out of the tool keeps
 * it trivially unit-testable without a real repo or filesystem reads.
 *
 * Two concerns live here:
 *  - {@link findRepoRoot} walks up the directory tree for the repo anchor
 *    (`.git` + `context/`) and caches the result.
 *  - {@link resolvePlanPath} maps a polymorphic `target` (a change-id or a path)
 *    to an absolute `plan.md` location, rejecting anything that escapes
 *    `context/changes/`.
 */

/** Thrown when a `target` is empty or resolves outside `context/changes/`. */
export class PlanPathError extends Error {
  override name = "PlanPathError";
}

/** The resolved location of a plan file, in three useful forms. */
export interface ResolvedPlanPath {
  /** The change-id segment (the directory under `context/changes/`). */
  changeId: string;
  /** Absolute path to `plan.md`. */
  absPath: string;
  /** Path to `plan.md` relative to the repo root (for display/results). */
  relPath: string;
}

/** Does `dir` carry both repo anchors (`.git` and `context/`)? */
function isRepoRoot(dir: string): boolean {
  return existsSync(path.join(dir, ".git")) && existsSync(path.join(dir, "context"));
}

/** Walk upward from `start` to the filesystem root, returning the first repo root. */
function walkUpForRoot(start: string): string | undefined {
  let dir = start;
  // Stop when `path.dirname` is a fixed point (we've reached the FS root).
  for (;;) {
    if (isRepoRoot(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

let cachedRoot: string | undefined;

/**
 * Find the repo root by walking up from this module's location, falling back to
 * `process.cwd()`. The root is the nearest ancestor containing both `.git` and
 * `context/`. Cached after the first successful resolution.
 *
 * Throws a clear error if no such ancestor exists — that means the tool is being
 * run outside the repo.
 */
export function findRepoRoot(): string {
  if (cachedRoot) return cachedRoot;

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const root = walkUpForRoot(moduleDir) ?? walkUpForRoot(process.cwd());
  if (!root) {
    throw new PlanPathError(
      "Could not locate the repo root: no ancestor of " +
        `${moduleDir} or ${process.cwd()} contains both .git and context/. ` +
        "The plan-reading tool must be run inside the repository."
    );
  }
  cachedRoot = root;
  return root;
}

/**
 * Reset the cached repo root. Test-only seam; not part of the runtime flow.
 * Call this between tests that stub `findRepoRoot` from different fixtures.
 */
export function resetRepoRootCache(): void {
  cachedRoot = undefined;
}

/**
 * Resolve a `target` to an absolute `plan.md` path confined to
 * `<repoRoot>/context/changes/`.
 *
 * Discrimination heuristic: a `target` containing a path separator or ending in
 * `.md` is treated as a path; anything else is a change-id mapped to
 * `context/changes/<target>/plan.md`. A path is resolved against the repo root,
 * with one twist: an *absolute* target that would land outside the repo (e.g. a
 * PR description's `Plan: /context/changes/<id>/plan.md`, where the leading `/`
 * means "repo root", not "filesystem root") is reinterpreted as repo-relative.
 * A genuine absolute path already inside the repo is used as-is.
 *
 * The lexically-normalized result must live inside `context/changes/`; `../`
 * escapes and paths outside the subtree throw {@link PlanPathError}.
 */
/**
 * Resolve a path-like target against the repo root. A relative target resolves
 * normally. An absolute target that already sits inside the repo is used as-is;
 * one that lands outside is reinterpreted as repo-relative (its leading `/`
 * meaning "repo root"), so `/context/changes/<id>/plan.md` resolves under the
 * repo rather than at the filesystem root. Confinement is enforced afterward by
 * the caller, so this never widens what's reachable.
 */
function resolveAgainstRepo(trimmed: string, repoRoot: string): string {
  const candidate = path.resolve(repoRoot, trimmed);
  if (path.isAbsolute(trimmed) && path.relative(repoRoot, candidate).startsWith("..")) {
    return path.resolve(repoRoot, trimmed.replace(/^[/\\]+/, ""));
  }
  return candidate;
}

export function resolvePlanPath(target: string, repoRoot: string): ResolvedPlanPath {
  const trimmed = target.trim();
  if (!trimmed) {
    throw new PlanPathError("Empty target: provide a change-id or a path to plan.md.");
  }

  const changesBase = path.join(repoRoot, "context", "changes");
  const looksLikePath = trimmed.includes("/") || trimmed.includes(path.sep) || trimmed.endsWith(".md");

  const absPath = looksLikePath ? resolveAgainstRepo(trimmed, repoRoot) : path.join(changesBase, trimmed, "plan.md");

  // Confinement: the resolved path must sit inside context/changes/.
  const rel = path.relative(changesBase, absPath);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new PlanPathError(
      `Out of bounds: ${target} resolves to ${absPath}, outside ${changesBase}. ` +
        "The plan-reading tool only reads under context/changes/."
    );
  }

  const changeId = rel.split(path.sep)[0] ?? "";
  return { changeId, absPath, relPath: path.relative(repoRoot, absPath) };
}
