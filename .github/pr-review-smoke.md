# PR review smoke marker

This file is the smoke-test artifact for `ci-cd-code-review` Phase 3
(see `context/changes/ci-cd-code-review/plan.md`).

Its purpose was to open a trivial PR against `master` so
`.github/workflows/pr-review.yml` could fire for the first time and confirm
the automated review pipeline works end-to-end: filtered diff → CLI →
`gh pr comment` posting the six-criteria review back to the PR.

Safe to delete once the change is archived.
