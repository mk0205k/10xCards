---
change_id: ci-cd-code-review
title: Wire packages/code-reviewer into CI/CD for automated PR reviews
status: implemented
created: 2026-08-13
updated: 2026-08-13
archived_at: null
---

## Notes

Rollback: `gh workflow disable pr-review.yml --repo mk0205k/10xCards` disables the reviewer without touching the workflow file. Re-enable with `gh workflow enable pr-review.yml --repo mk0205k/10xCards`.

Phase 3 landed a workflow lockfile fix (`--legacy-peer-deps`) on `phase3-smoke-pr-review` — merge or cherry-pick to master before the smoke branch goes away, otherwise master's `pr-review.yml` still hits the `mongodb` → `gcp-metadata` peer-dep drift.
