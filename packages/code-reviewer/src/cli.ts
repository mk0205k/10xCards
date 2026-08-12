import { pathToFileURL } from "node:url";
import { runReview } from "./index.js";
import { trace, phase } from "./log.js";
import { detectGitHubEnv } from "./tools/github-env.js";

/**
 * CI entry point. Reads a PR's title/description from argv (or PR_TITLE /
 * PR_DESCRIPTION env) and the unified diff from stdin (to EOF), runs the agentic
 * review (which posts the PR comment(s) itself via `gh`), and writes only the
 * recovered `{ verdict }` JSON to stdout so the action can apply the verdict
 * label. Logs and errors go to stderr; a thrown error sets a non-zero exit code.
 *
 * Diff comes via stdin (not argv/env) to sidestep argv/env size limits and
 * shell-escaping of large, attacker-controlled diff text.
 */

/** Read the value following `--flag` in argv, or undefined if not present. */
function readFlag(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

/** Read all of stdin to EOF as a UTF-8 string. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  phase("AI CODE REVIEW · STARTUP");
  const title = readFlag("--title") ?? process.env.PR_TITLE ?? "";
  const description = readFlag("--description") ?? process.env.PR_DESCRIPTION ?? "";

  trace("reading diff from stdin to EOF…");
  const diff = await readStdin();

  // Surface the CI context up front so a failed run is diagnosable from the log
  // alone: which PR, how big the inputs were, and whether the diff was capped.
  const env = detectGitHubEnv();
  trace(
    `context · inGitHub=${env.inGitHub} · pr=${env.prNumber ?? "—"} · ` +
      `repo=${process.env.GITHUB_REPOSITORY ?? "—"} · diffTruncated=${process.env.DIFF_TRUNCATED ?? "false"}`
  );
  trace(`inputs · title=${title.length} chars · description=${description.length} chars · diff=${diff.length} chars`);

  const result = await runReview({ title, description, diff });

  phase("AI CODE REVIEW · COMPLETE");
  trace(`final verdict=${result.verdict} · commentsPosted=${result.postedComments}`);
  // stdout carries ONLY this JSON — the composite action parses it for the label.
  process.stdout.write(JSON.stringify({ verdict: result.verdict }));
}

// Run main() only when executed directly (not when imported as a module).
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    // Full stack to stderr so a CI failure is diagnosable; stdout stays clean.
    phase("AI CODE REVIEW · FAILED");
    trace(`fatal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
