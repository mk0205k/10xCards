---
change_id: first-ai-generation-and-accept
title: First AI generation + accept/edit/reject cards
status: archived
created: 2026-07-07
updated: 2026-07-08
archived_at: 2026-07-08T19:17:58Z
---

## Notes

Roadmap slice S-01 (`context/foundation/roadmap.md`). Outcome: user pastes text, clicks "generate proposals", sees Q/A pairs within <30s, accepts/edits/rejects each one, accepted cards land in their deck.

- PRD refs: US-01, FR-005, FR-006, FR-007, NFR Response time (p95 < 30s)
- Prerequisites: F-01 (done — `cards` table + RLS + Database types shipped 2026-07-07)
- Wedge of the product: AI-grounded + human-in-the-loop before entering the deck
- Open Q2 (per-user API cost cap) is NOT blocking — can ship without hard limit
- Risk: if accept-rate <75% the whole hypothesis wobbles; keep OpenRouter streaming aligned with `context/foundation/infrastructure.md` risk register
- GitHub issue: https://github.com/mk0205k/10xCards/issues/2
