---
id: global-navigation-menu
title: Globalne menu nawigacyjne
status: implementing
created: 2026-07-27
updated: 2026-07-27

roadmap_ref: S-08
---

# global-navigation-menu

Wpięcie widocznego menu nawigacyjnego w `src/layouts/Layout.astro` — rozszerza istniejący `src/components/Topbar.astro` o brakujące linki (`/generate`, `/review`, `/deck`), active-state highlighting po `Astro.url.pathname` i hamburger drawer (shadcn Sheet) dla widoków mobilnych; przenosi montaż z `Welcome.astro` do Layout, żeby ta sama nawigacja pojawiła się na każdej z 14 podstron.

Roadmap slice: S-08 (`context/foundation/roadmap.md`).
