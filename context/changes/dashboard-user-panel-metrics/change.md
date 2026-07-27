---
id: dashboard-user-panel-metrics
title: Panel użytkownika na /dashboard z metrykami talii
status: impl_reviewed
created: 2026-07-27
updated: 2026-07-27
roadmap_ref: S-09
prd_refs: US-03, FR-016, FR-017
---

# dashboard-user-panel-metrics

Rewrite `src/pages/dashboard.astro` z minimalnego welcome-screen (email + signout) w prawdziwy hub użytkownika: 3 stat cards (łączna liczba fiszek + podział AI/manual, liczba do powtórki dziś, i miejsce na przyszłe metryki) oraz 3 CTA cards (shortcuty do `/generate`, `/review`, `/deck`), rozłożone w responsywnym 3×2 gridzie. SSR-direct queries przez `Astro.locals.supabase` (zero nowego API surface). Empty-state (talia = 0) accentuje CTA do `/generate` jako główny onboarding step.

Roadmap slice: S-09 (`context/foundation/roadmap.md`).
PRD refs: US-03 (Dashboard hub with deck insights), FR-016 (deck stats: total, AI/manual split, due-today), FR-017 (visual panels + shortcuts).
