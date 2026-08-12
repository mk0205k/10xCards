/**
 * Centralizes "are we in a GitHub Actions PR run, and which PR?" detection so
 * both the `postPrComment` tool and the CLI branch on one source of truth.
 *
 * "In GitHub" means `GITHUB_ACTIONS` is set AND a PR number is resolvable from
 * `PR_NUMBER` — the action's existing convention. `gh` itself reads
 * `GH_TOKEN`/`GITHUB_REPOSITORY` from the ambient env, so they are not surfaced
 * here. No side effects.
 */

/** Whether the current process is a GitHub Actions PR run, and which PR. */
export interface GitHubEnv {
  inGitHub: boolean;
  prNumber?: string;
}

/** Detect the GitHub Actions PR context from the environment. */
export function detectGitHubEnv(env: NodeJS.ProcessEnv = process.env): GitHubEnv {
  const prNumber = env.PR_NUMBER?.trim();
  const inGitHub = env.GITHUB_ACTIONS === "true" && !!prNumber;
  return inGitHub ? { inGitHub, prNumber } : { inGitHub: false };
}
