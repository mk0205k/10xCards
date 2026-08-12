/**
 * Local end-to-end launcher for the AI code reviewer.
 *
 * Runs the *actual* CI entry point (`src/cli.ts`) — the same one the GitHub
 * Action invokes — against a fixture under `evals/fixtures/`, reusing the exact
 * PR metadata + diff the promptfoo eval consumes (single source of truth).
 *
 * By default no `PR_NUMBER` is set, so the engine runs in dry-run mode: it
 * performs a real (billed) OpenRouter review and writes the rendered comment to
 * stderr instead of posting it via `gh`, while stdout carries the `{ verdict }`
 * JSON the Action would otherwise label on. We parse that and, when the fixture
 * declares an expected verdict, assert on it.
 *
 * To post for real against a throwaway PR (gh must be authed), pass a PR number
 * through the environment — the post tool gates on PR_NUMBER, not on CI:
 *   PR_NUMBER=123 npm run review:local
 *
 * Fixture convention (base name → files in evals/fixtures/):
 *   <base>.title.txt             required  → PR_TITLE
 *   <base>.description.txt       required  → PR_DESCRIPTION
 *   <base>.diff                  required  → stdin (the unified diff)
 *   <base>.expected-verdict.txt  optional  → asserted against the run's verdict
 *
 * Usage (from packages/code-reviewer/):
 *   npm run review:local                  # default fixture: react-migration
 *   npm run review:local -- some-fixture  # any <base>.* fixture set
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");
const fixturesDir = path.join(here, "fixtures");

const fixture = process.argv[2] ?? "react-migration";

/** Read `<fixture>.<suffix>` from the fixtures dir; exit 2 if a required file is absent. */
function readFixture(suffix: string, { required = true }: { required?: boolean } = {}): string {
  const file = path.join(fixturesDir, `${fixture}.${suffix}`);
  if (!existsSync(file)) {
    if (required) {
      console.error(`✖ Missing required fixture: ${path.relative(pkgRoot, file)}`);
      process.exit(2);
    }
    return "";
  }
  return readFileSync(file, "utf8");
}

const title = readFixture("title.txt").trim();
const description = readFixture("description.txt").trim();
const diff = readFixture("diff");
const expectedVerdict = readFixture("expected-verdict.txt", { required: false }).trim() || null;

console.error(`▶ Local review · fixture="${fixture}"`);
console.error(`  title="${title}"`);
console.error(`  diff=${diff.length} chars · expected verdict=${expectedVerdict ?? "—"}`);

// Drive the real CI entry point through tsx, with the package root as cwd so
// cli.ts's process.loadEnvFile() picks up packages/code-reviewer/.env. The diff
// goes in via stdin (as in CI); the child's stderr (trace + rendered comment)
// streams straight through, and we capture only its stdout ({ verdict } JSON).
const tsxBin = path.join(pkgRoot, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
const cli = path.join(pkgRoot, "src", "cli.ts");

// PR_NUMBER is passed through verbatim from the ambient env: absent → dry-run
// (the post tool logs only); set → the tool posts to that PR. We don't inject one.
const willPost = !!process.env.PR_NUMBER?.trim();
console.error(`  posting=${willPost ? `yes → PR #${process.env.PR_NUMBER?.trim()}` : "no (dry-run)"}\n`);

const child = spawnSync(tsxBin, [cli], {
  cwd: pkgRoot,
  input: diff,
  encoding: "utf8",
  stdio: ["pipe", "pipe", "inherit"],
  shell: process.platform === "win32",
  env: {
    ...process.env,
    PR_TITLE: title,
    PR_DESCRIPTION: description,
  },
});

if (child.status !== 0) {
  console.error(`\n✖ cli.ts exited with code ${child.status ?? "(signal " + child.signal + ")"}`);
  process.exit(child.status ?? 1);
}

const stdout = (child.stdout ?? "").trim();
let verdict: unknown;
try {
  verdict = (JSON.parse(stdout) as { verdict?: unknown }).verdict;
} catch {
  console.error(`\n✖ Could not parse verdict JSON from cli stdout:\n${stdout || "(empty)"}`);
  process.exit(1);
}

console.error(`\n● verdict=${String(verdict)}`);

if (expectedVerdict) {
  const ok = verdict === expectedVerdict;
  console.error(ok ? `✓ matches expected "${expectedVerdict}"` : `✖ expected "${expectedVerdict}", got "${String(verdict)}"`);
  process.exit(ok ? 0 : 1);
}
