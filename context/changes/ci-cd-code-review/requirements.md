# Code review criteria

Each criterion is scored on an integer **1–10** scale. `1` is the worst end of the spectrum; `10` is the best. A score sits at either end only when the change clearly matches that description — otherwise it lands somewhere in between with a rationale that names the specific gap.

## 1. Implementation correctness

Does the code do what it claims, handling edge cases and error paths without regressions?

- **1** — Logic is broken, misses obvious edge or error cases, or silently regresses existing behavior.
- **10** — Correct across the happy path, edge cases, and failure modes, with no regressions in adjacent code.

## 2. Idiomaticity

Does the code follow the language, framework, and project conventions a fluent reader would expect?

- **1** — Fights the stack's idioms and the repo's patterns; reads as foreign next to surrounding code.
- **10** — Indistinguishable from well-written surrounding code; a reviewer could not tell it apart from long-standing modules.

## 3. Complexity

Is the solution as simple as the problem allows, without needless abstraction?

- **1** — Over-engineered or tangled; accidental complexity (indirection, premature abstractions, dead branches) obscures the intent.
- **10** — Minimal and clear; the simplest design that solves the problem completely, with nothing added for hypothetical futures.

## 4. Test and risk coverage

Are meaningful behaviors and risky paths tested proportional to their risk?

- **1** — Risky logic ships untested; tests are absent, trivial, or assert nothing useful (e.g. only that a function was called).
- **10** — Risk-weighted coverage — the parts most likely to break are tested deliberately, with assertions that would actually catch a regression.

## 5. Documentation

Are non-obvious decisions, public surfaces, and tricky code explained where needed?

- **1** — Opaque; no comments or docs where needed, intent must be reverse-engineered from the diff.
- **10** — Just enough documentation to explain the *why* behind non-obvious choices, without restating what the code already says.

## 6. Security and safety

Does the change avoid vulnerabilities, leaking secrets, or unsafe handling of untrusted input?

- **1** — Introduces an exploitable flaw, leaks secrets, or trusts untrusted input unsafely (SQL/command injection, XSS, missing authz, secrets in logs).
- **10** — Input is validated at boundaries, secrets are handled correctly, and no new attack surface is opened by the change.
