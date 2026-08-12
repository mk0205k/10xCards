import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findRepoRoot, resolvePlanPath, PlanPathError } from "./plan-path.js";

/**
 * Locks the resolution heuristic (change-id vs path) and the `context/changes/`
 * confinement against both a synthetic repo root (lexical) and an on-disk temp
 * fixture (`.git/` + `context/changes/<id>/plan.md`).
 */

const REPO = "/srv/repo"; // synthetic root; resolution is lexical, no FS access.

describe("resolvePlanPath", () => {
  it("maps a bare change-id to context/changes/<id>/plan.md", () => {
    const r = resolvePlanPath("oauth-login", REPO);
    expect(r.changeId).toBe("oauth-login");
    expect(r.absPath).toBe(path.join(REPO, "context", "changes", "oauth-login", "plan.md"));
    expect(r.relPath).toBe(path.join("context", "changes", "oauth-login", "plan.md"));
  });

  it("accepts a relative path inside context/changes/", () => {
    const r = resolvePlanPath("context/changes/foo/plan.md", REPO);
    expect(r.changeId).toBe("foo");
    expect(r.absPath).toBe(path.join(REPO, "context", "changes", "foo", "plan.md"));
  });

  it("accepts an absolute path inside context/changes/", () => {
    const abs = path.join(REPO, "context", "changes", "bar", "plan.md");
    const r = resolvePlanPath(abs, REPO);
    expect(r.changeId).toBe("bar");
    expect(r.absPath).toBe(abs);
  });

  it("treats a leading-slash path as repo-relative, not filesystem-absolute", () => {
    const r = resolvePlanPath("/context/changes/bento-grid/plan.md", REPO);
    expect(r.changeId).toBe("bento-grid");
    expect(r.absPath).toBe(path.join(REPO, "context", "changes", "bento-grid", "plan.md"));
    expect(r.relPath).toBe(path.join("context", "changes", "bento-grid", "plan.md"));
  });

  it("still rejects a leading-slash path that escapes context/changes/", () => {
    expect(() => resolvePlanPath("/etc/passwd", REPO)).toThrow(PlanPathError);
    expect(() => resolvePlanPath("/context/changes/../../etc/passwd", REPO)).toThrow(PlanPathError);
  });

  it("treats a .md-suffixed target as a path, not a change-id", () => {
    const r = resolvePlanPath("context/changes/baz/plan.md", REPO);
    expect(r.changeId).toBe("baz");
  });

  it("rejects a ../ escape out of context/changes/", () => {
    expect(() => resolvePlanPath("context/changes/../../etc/passwd", REPO)).toThrow(PlanPathError);
  });

  it("rejects a path outside context/changes/", () => {
    expect(() => resolvePlanPath("src/secrets.md", REPO)).toThrow(PlanPathError);
  });

  it("rejects an empty or whitespace target", () => {
    expect(() => resolvePlanPath("", REPO)).toThrow(PlanPathError);
    expect(() => resolvePlanPath("   ", REPO)).toThrow(PlanPathError);
  });
});

describe("resolvePlanPath against a temp repo fixture", () => {
  let root: string;
  const changeId = "sample-change";

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "plan-path-"));
    await mkdir(path.join(root, ".git"), { recursive: true });
    const planDir = path.join(root, "context", "changes", changeId);
    await mkdir(planDir, { recursive: true });
    await writeFile(path.join(planDir, "plan.md"), "# Sample plan\n", "utf8");
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("resolves the change-id to the file that exists on disk", () => {
    const r = resolvePlanPath(changeId, root);
    expect(existsSync(r.absPath)).toBe(true);
    expect(r.absPath).toBe(path.join(root, "context", "changes", changeId, "plan.md"));
  });
});

describe("findRepoRoot", () => {
  it("locates this repo's root (contains .git and context/)", () => {
    const root = findRepoRoot();
    expect(existsSync(path.join(root, ".git"))).toBe(true);
    expect(existsSync(path.join(root, "context"))).toBe(true);
  });

  it("resolves this repo's own example plan path", () => {
    const root = findRepoRoot();
    const r = resolvePlanPath("example", root);
    expect(r.relPath).toBe(path.join("context", "changes", "example", "plan.md"));
    expect(existsSync(r.absPath)).toBe(true);
  });
});
