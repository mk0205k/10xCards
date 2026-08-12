import { describe, expect, it } from "vitest";
import { detectGitHubEnv } from "./github-env.js";

/** Locks the "in GitHub PR run" detection: needs GITHUB_ACTIONS + a PR number. */
describe("detectGitHubEnv", () => {
  it("reports inGitHub with a PR number when both signals are present", () => {
    const env = detectGitHubEnv({ GITHUB_ACTIONS: "true", PR_NUMBER: "42" });
    expect(env).toEqual({ inGitHub: true, prNumber: "42" });
  });

  it("is not inGitHub when GITHUB_ACTIONS is absent", () => {
    const env = detectGitHubEnv({ PR_NUMBER: "42" });
    expect(env).toEqual({ inGitHub: false });
  });

  it("is not inGitHub when PR_NUMBER is absent", () => {
    const env = detectGitHubEnv({ GITHUB_ACTIONS: "true" });
    expect(env).toEqual({ inGitHub: false });
  });

  it("trims a padded PR number", () => {
    const env = detectGitHubEnv({ GITHUB_ACTIONS: "true", PR_NUMBER: " 7 " });
    expect(env).toEqual({ inGitHub: true, prNumber: "7" });
  });
});
