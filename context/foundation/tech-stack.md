---
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
---

## Why this stack

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
