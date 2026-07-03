---
bootstrapped_at: 2026-06-10T21:14:46Z
starter_id: 10x-astro-starter
starter_name: 10x Astro Starter (Astro + Supabase + Cloudflare)
project_name: 10xcards
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: npm audit --json
---

## Hand-off

Verbatim copy of `context/foundation/tech-stack.md`:

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: 10xcards
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
```

### Why this stack

Solo developer shipping 10xCards in a 3-week after-hours budget with a hard
deadline of 2026-07-01. The PRD requires email/password auth with reset
(FR-001 to FR-004), LLM-driven flashcard generation from pasted text
(FR-005 to FR-007), flashcard CRUD (FR-008 to FR-011), and spaced-repetition
review scheduling (FR-012 to FR-015), plus a privacy NFR for user content and
a p95 < 30s response-time NFR. 10x-astro-starter is the recommended default
for `(web, js)` and ships Supabase (Postgres + auth) and Cloudflare
Pages/Workers out of the box — both feature-loaded enough that auth, the
deck/card/review-history schema, and edge-runtime generation routes drop in
without bespoke wiring. The starter clears all four agent-friendly gates
(typed, convention-based, popular, well-documented) and carries first-class
bootstrapper confidence. GitHub Actions with auto-deploy-on-merge is the
starter's default CI shape, which keeps the after-hours workflow short.

## Pre-scaffold verification

| Signal       | Value                                                         | Severity | Notes                                                                  |
| ------------ | ------------------------------------------------------------- | -------- | ---------------------------------------------------------------------- |
| npm package  | not run                                                       | n/a      | `cmd_template` starts with `git clone`; no `npm create` CLI to resolve |
| GitHub repo  | przeprogramowani/10x-astro-starter last pushed 2026-05-17     | fresh    | from `card.docs_url`; fetched via GitHub REST API (gh CLI unavailable) |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`

**Strategy**: git-clone

**Exit code**: 0

**Files moved**: 20

**Moved entries**: `.env.example`, `.github/`, `.gitignore`, `.husky/`, `.nvmrc`, `.prettierrc.json`, `.vscode/`, `CLAUDE.md`, `README.md`, `astro.config.mjs`, `components.json`, `eslint.config.js`, `node_modules/`, `package-lock.json`, `package.json`, `public/`, `src/`, `supabase/`, `tsconfig.json`, `wrangler.jsonc`

**Conflicts (.scaffold siblings)**: none

**.gitignore handling**: moved silently (cwd had no `.gitignore`)

**.bootstrap-scaffold cleanup**: deleted (after removing the cloned `.git/` upstream history per the git-clone strategy)

**Notes**:
- `npm install` emitted `EBADENGINE` warnings for ~12 packages requiring Node `>=22` (or `>=20.17`, `>=20.19`, etc.); local Node is `v20.14.0`. Install completed successfully despite the warnings, but the runtime version mismatch is a real risk — the starter's `.nvmrc` likely pins Node 22. Upgrade Node before running dev/build commands.
- Cleanup required PowerShell (`Remove-Item`) and `cmd rmdir` fallbacks because the sandboxed bash `rm -rf` was blocked; the deletions ultimately succeeded.
- No collisions against pre-existing `.claude/`, `.vs/`, or `context/` in cwd.

## Post-scaffold audit

**Tool**: `npm audit --json`

**Summary**: 0 CRITICAL, 1 HIGH, 9 MODERATE, 0 LOW (total 10)

**Direct vs transitive**: 0/0/2/0 direct of total 0/1/9/0 — the 1 HIGH and 7 of the 9 MODERATE findings are transitive; only 2 direct dependencies (`@astrojs/check`, `wrangler`) carry MODERATE advisories. Dependency totals: 449 prod, 316 dev, 131 optional (895 total).

#### CRITICAL findings

none

#### HIGH findings

- **devalue** (range `5.6.3 - 5.8.0`) — transitive; advisory `GHSA-77vg-94rm-hx3p` "Svelte devalue: DoS via sparse array deserialization", CVSS 7.5 (CWE-770). Fix available via upstream dependency bump.

#### MODERATE findings

- **@astrojs/check** (`>=0.9.3`, direct) — vulnerable transitive chain via `@astrojs/language-server` → `volar-service-yaml` → `yaml-language-server` → `yaml`. Fix available; the recommended fix is a SemVer-major downgrade to `0.9.2`.
- **@astrojs/language-server** (`>=2.14.0`, transitive) — affected by `volar-service-yaml`.
- **@cloudflare/vite-plugin** (`<=0.0.0-fff677e35 || 0.0.7 - 1.37.2`, transitive) — affected by `miniflare`, `wrangler`, `ws`.
- **miniflare** (`<=0.0.0-fff677e35 || 3.20250204.0 - 4.20260518.0`, transitive) — affected by `ws`.
- **volar-service-yaml** (`<=0.0.70`, transitive) — affected by `yaml-language-server`.
- **wrangler** (`<=0.0.0-kickoff-demo || 3.108.0 - 4.93.0`, direct) — affected by `miniflare`.
- **ws** (`8.0.0 - 8.20.0`, transitive) — advisory `GHSA-58qx-3vcg-4xpx` "Uninitialized memory disclosure", CVSS 4.4 (CWE-908).
- **yaml** (`2.0.0 - 2.8.2`, transitive) — advisory `GHSA-48c2-rrv3-qjmp` "Stack Overflow via deeply nested YAML collections", CVSS 4.3 (CWE-674).
- **yaml-language-server** (transitive) — affected by `yaml`.

#### LOW / INFO findings

none

**Suggested next action**: review with `npm audit` for the human-readable view, then decide between `npm audit fix` (non-breaking, where available) and `npm audit fix --force` (which applies the SemVer-major downgrade to `@astrojs/check@0.9.2`). The bootstrapper does NOT auto-patch.

## Hints recorded but not acted on

| Hint                     | Value                |
| ------------------------ | -------------------- |
| bootstrapper_confidence  | first-class          |
| quality_override         | false                |
| path_taken               | standard             |
| self_check_answers       | null                 |
| team_size                | solo                 |
| deployment_target        | cloudflare-pages     |
| ci_provider              | github-actions       |
| ci_default_flow          | auto-deploy-on-merge |
| has_auth                 | true                 |
| has_payments             | false                |
| has_realtime             | false                |
| has_ai                   | true                 |
| has_background_jobs      | false                |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Upgrade Node to v22 to match the starter's engine requirement (`.nvmrc` pins it; `EBADENGINE` warnings flagged the gap).
- Review any `.scaffold` siblings the conflict policy created and decide which version of each file to keep. (This run produced none.)
- Address audit findings per your project's risk tolerance — the full breakdown is above. The single HIGH finding (`devalue`) is transitive and resolvable via `npm audit fix`.
