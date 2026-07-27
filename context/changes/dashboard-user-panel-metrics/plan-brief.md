# Panel użytkownika na /dashboard z metrykami talii — Plan Brief

> Full plan: `context/changes/dashboard-user-panel-metrics/plan.md`
> Roadmap slice: `context/foundation/roadmap.md` § S-09
> PRD refs: `context/foundation/prd.md` § US-03, FR-016, FR-017 (v2)

## What & Why

Przekształcamy `/dashboard` z minimalnego welcome-screen (email + signout) w hub z 3 stat cards (łączna liczba fiszek + AI/manual split, liczba do powtórki dziś, placeholder na przyszłe metryki) oraz 3 CTA cards (shortcuty do `/generate`, `/review`, `/deck`). Motywacja: PRD v2 uznał obecny dashboard za "empty landing" gap — user po loginie oczekuje kontekstu i punktu startowego, a nie tylko wiadomości powitalnej.

## Starting Point

`src/pages/dashboard.astro:1-28` renderuje jedynie welcome message + signout button. Cała infrastruktura potrzebna do metryk jest gotowa: `cards.source` enum (`ai`/`manual`), `cards.due` timestamp, RLS policies z soft-delete filter (`profiles.deleted_at IS NULL`), shadcn Card primitives, Cosmic theme classes, Lucide icons już w bundle (z S-08).

## Desired End State

Dashboard = 3×2 grid: 3 stat cards (Total + split, Due today, Placeholder) + 3 CTA cards (Generuj, Powtórka, Talia), responsywny do 1 kolumny na mobile. Empty state (talia=0) akcentuje CTA do `/generate` przez `ring-2 ring-purple-400/50` glow. Signout usunięty z dashboard (żyje w Topbar S-08 na każdej stronie). SSR-direct queries przez `Astro.locals.supabase` — zero API surface, zero React islands, fresh values przy każdym page load.

## Key Decisions Made

| Decyzja | Wybór | Dlaczego (1 zdanie) | Source |
| --- | --- | --- | --- |
| Zakres metryk | 3 core (total, AI/manual split, due today) | Matches roadmap FR-016; extras (streaks, time-series) łamałyby PRD v2 Non-Goal. | Plan |
| API architecture | SSR-direct query w `dashboard.astro` frontmatter | Zero nowego API surface; Astro w `output: "server"` mode natywnie server-renderuje; matches roadmap sensowny default. | Plan |
| Freshness strategy | Fresh at page load (SSR) | Zero cache complexity; dashboard nie ma real-time potrzeby. | Plan |
| Layout | 3 stat cards + 3 CTA cards w 3×2 gridzie | Symetryczna separacja "co masz" (stat) vs "co zrobić" (CTA); miejsce na 4-tą metrykę. | Plan |
| Empty state | Zero-value cards + accented CTA do `/generate` | Layout consistency; jasny "next step" dla nowego usera. | Plan |
| Due-today definition | `cards.due <= now()` (obejmuje overdue + today) | Roadmap sensowny default. | Roadmap |
| Signout w dashboard | Usunięty (żyje w Topbar S-08) | Redukcja duplikacji po globalnym mount nav. | Plan |

## Scope

**In scope:**
- Nowy `src/lib/services/deck-stats.ts` z `getDeckStats(supabase)` (3 count queries via `Promise.all`)
- Full rewrite `src/pages/dashboard.astro` z 6 Card grid + SSR queries
- 10 nowych i18n keys (dashboard_stat_*, dashboard_cta_*, dashboard_empty_*)
- Usunięcie 3 nieużywanych i18n keys (dashboard_welcome, dashboard_auth_only, dashboard_signout)
- Lucide icons: Sparkles, Clock, Library, TrendingUp (już w bundle)
- Manualny QA sweep 16 kombinacji (4 stany × 2 języki × 2 breakpointy)

**Out of scope:**
- Nowy API endpoint `/api/stats/*` (YAGNI)
- Metryki z `review_history` (streaks, per-day averages, historical) — PRD v2 Non-Goal
- React islands / client-side JS / polling / manual refresh button
- Zmiany schematu DB, migracje, indeksy
- Wykresy, gamification, badges
- Unit / Playwright tests (brak infra)

## Architecture / Approach

```
/dashboard request (SSR w Cloudflare Worker)
  │
  ├── src/pages/dashboard.astro (frontmatter)
  │     │
  │     ├── const supabase = Astro.locals.supabase   (middleware provided)
  │     ├── const stats = await getDeckStats(supabase)  ─┐
  │     └── const isEmpty = stats.total === 0            │
  │                                                       │
  │     src/lib/services/deck-stats.ts                    │
  │     └── Promise.all([                                 │
  │           count(cards),                               ← 3 queries przez RLS
  │           count(cards WHERE source='ai'),             │  (auto-filter user_id
  │           count(cards WHERE due <= now())             │   + soft-delete)
  │         ]) → { total, ai, manual, dueToday }          │
  │                                                       │
  ├── Layout.astro (już renderuje Topbar globalnie z S-08)
  │
  └── <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        │
        ├── [Stat 1: Total + AI/manual split]  ─┐
        ├── [Stat 2: Due today]                 ├── SSR HTML (zero React)
        ├── [Stat 3: Placeholder for future]    │
        ├── [CTA: /generate] (accented if empty)│
        ├── [CTA: /review]                      │
        └── [CTA: /deck]                        ─┘
```

## Phases at a Glance

| Faza | Co dostarcza | Kluczowe ryzyko |
| --- | --- | --- |
| 1. Query layer | `getDeckStats(supabase)` helper w `src/lib/services/deck-stats.ts` z 3 count queries przez Supabase | Zero user-visible impact w tej fazie → manual verify odłożony do Fazy 2 |
| 2. UI + i18n | 10 nowych i18n keys, 3 usunięte nieużywane; full rewrite `dashboard.astro` z 6 Card grid; empty state accent | Regresja wizualna na wszystkich zalogowanych userach naraz (dashboard = pierwszy widok po loginie); jeśli count queries returnują dziwne wartości, wszyscy zobaczą 0/0/0 |
| 3. QA sweep + parity gate | 16-pozycyjny manual checklist + regression check na Topbar/S-08, sign-out, delete-account/S-05 | Odkrycie regresji późno wraca do Fazy 2 |

**Prerequisites:** F-01, S-01, S-02, S-03 (roadmap S-09 Prerequisites, all done). Brak nowych migracji, brak API changes.
**Estimated effort:** ~1 sesja agent runa (3 fazy z manual gate po każdej; mniejszy zakres niż S-08 bo bez React islands i bez shadcn install).

## Open Risks & Assumptions

- **Cascade z S-05 (soft-delete retention)**: RLS filter `profiles.deleted_at IS NULL` powinien zwracać puste wyniki dla soft-deleted userów. Middleware powinien wcześniej redirectować `/dashboard` → `/auth/restore-account`. Faza 3 verify że dashboard nigdy się nie renderuje dla soft-deleted usera z 0/0/0.
- **Cascade z S-08 (global nav)**: Sign-out w dashboard.astro (istniejący button) jest usuwany, bo Topbar go dostarcza globalnie. Musimy zweryfikować że sign-out flow dalej działa po rewrite.
- **AI/manual split UI decision**: pokazujemy `X AI (Y%) · Z ręcznie` (liczba + procent w podpisie). Jeśli user preferuje same procenty lub same liczby, edge case — do zmiany w `/10x-plan` iteration albo review follow-up.
- **Placeholder Card 3**: "Więcej metryk wkrótce" jest visualnym filler dla symmetry. Może wyglądać "puste" dla powracającego usera. Alternatywa (skończyć grid na 5 Cards, asymetrycznie) też akceptowalna — do zmiany post-implementation na podstawie usability feedback.

## Success Criteria (Summary)

- Każdy zalogowany user otwierający `/dashboard` widzi 6-Card grid (3 stat + 3 CTA) z aktualnymi liczbami swojej talii.
- Empty deck user widzi 0/0/0 stats + wyraźnie akcentowane CTA do `/generate`.
- Zero regresji: Topbar (S-08) dalej renderuje się i podświetla "Panel"; sign-out w Topbar działa; soft-deleted user (S-05) jest redirectowany, nie renderuje pustego dashboardu.
- `npm run lint`, `npm run prebuild` (parity), `npm run build` przechodzą; PL/EN parity zachowany.
