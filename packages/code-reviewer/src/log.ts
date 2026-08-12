/**
 * Shared structured logging for the reviewer.
 *
 * Every diagnostic line goes to stderr (fd 2). stdout is reserved for the single
 * `{ verdict }` JSON the composite action captures into RESULT_FILE (see
 * `cli.ts` and `.github/actions/ai-code-review/action.yml`) — anything written
 * to fd 1 other than that JSON corrupts the verdict the action parses.
 *
 * Lines carry an `[ai-cr]` tag plus an ISO timestamp so they're easy to grep and
 * follow in the GitHub Actions log viewer. Centralizing the format here lets the
 * runner, the tools, and the CLI all share one channel and one prefix rather
 * than each re-implementing `process.stderr.write`.
 */

/** Emit one trace line to stderr with the shared `[ai-cr] <iso>` prefix. */
export function trace(message: string): void {
  process.stderr.write(`[ai-cr] ${new Date().toISOString()} ${message}\n`);
}

/**
 * Emit a visually distinct phase banner so the major stages of a run
 * (startup, code review, implementation review, teardown) stand out when
 * scanning a long CI log. Still a normal stderr line — just bracketed.
 */
export function phase(title: string): void {
  trace(`══════════ ${title} ══════════`);
}

/**
 * Render a value as a single-line, length-capped string for tracing. Tool I/O
 * carries whole diffs and plan bodies; logging them raw would bury the trace, so
 * we cap and annotate with the original size instead.
 */
export function summarize(value: unknown, max = 200): string {
  let text: string;
  try {
    text = typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
  } catch {
    text = String(value);
  }
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}… (${oneLine.length} chars)` : oneLine;
}
