# Globalne menu nawigacyjne — Plan Brief

> Full plan: `context/changes/global-navigation-menu/plan.md`
> Roadmap slice: `context/foundation/roadmap.md` § S-08

## What & Why

Dodajemy globalne menu nawigacyjne widoczne na każdej z 14 podstron aplikacji, żeby zalogowany użytkownik przechodził między `/dashboard`, `/generate`, `/review`, `/deck` i `/account` przez widoczny pasek nawigacyjny zamiast wpisywać URL ręcznie. Po zamknięciu S-01…S-05 mamy 5 działających widoków, ale zero cross-linków — brak menu to obecnie największy widoczny brak UX i gate "polish" launchu.

## Starting Point

`src/components/Topbar.astro` już istnieje: renderuje wariant zalogowany (`/dashboard` + `/account` + sign-out + LanguageSwitcher) i anonimowy (`/auth/signin` + `/auth/signup` + LanguageSwitcher), z pełną obsługą i18n. Ale jest zamontowany **tylko** w `Welcome.astro` (używanym wyłącznie na landingu `/`); `Layout.astro` (dziedziczony przez wszystkie 14 podstron) ma tylko `<slot />` i banner konfiguracyjny — żadnej nawigacji.

## Desired End State

Ta sama Topbar renderuje się na każdej z 14 podstron: wariant zalogowany z 5 linkami (dashboard, generate, review, deck, account) + sign-out + LanguageSwitcher na chronionych trasach; wariant anonimowy na `/` i `/auth/*`. Aktualna pozycja jest wizualnie zaznaczona. Na `<md` breakpoint pasek zwija się do prawostronnego hamburger drawera (shadcn Sheet) z tymi samymi elementami w kolumnie.

## Key Decisions Made

| Decyzja                                | Wybór                                       | Dlaczego (1 zdanie)                                                                  | Source |
| -------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------ | ------ |
| Reużycie Topbar vs nowy komponent      | Rozszerzenie Topbar + przeniesienie do Layout | Jedno źródło prawdy dla nawigacji; zero duplikacji i18n/LanguageSwitcher/sign-out.    | Plan   |
| Mobile shape                            | Hamburger drawer via shadcn Sheet           | Standardowy, dostępny wzorzec; Sheet daje focus trap + ESC/click-outside za darmo.   | Plan   |
| `/account` + sign-out UX               | Płaskie pozycje top-level                   | Zero nowych shadcn primitive'ów; pasuje do obecnego kształtu; na tabletach chowane pod hamburger. | Plan   |
| Nawigacja na `/` i `/auth/*`          | Anonimowy wariant Topbar (już istnieje)     | LanguageSwitcher naprawdę należy na stronach auth (user może wybrać język przed logowaniem). | Plan   |
| QA scope                                | 14 podstron × 2 języki × 2 breakpointy      | Layout dotyka każdej strony — pełny sweep łapie string leakage, active-state bugi, drawer bugi. | Plan   |
| Active-state source of truth           | `Astro.url.pathname` przekazany jako prop   | Idiomatyczne w Astro SSR; nie wymaga JS hydratacji.                                  | Plan   |
| Match aktywnej trasy                    | Exact match, nie `startsWith`              | `/auth/signin` nie powinien podświetlać `/`.                                         | Plan   |

## Scope

**In scope:**
- Rozszerzenie `Topbar.astro` o 3 linki (`/generate`, `/review`, `/deck`)
- Klucze i18n dla nowych linków + aria-labeli drawera (`messages/pl.json` + `messages/en.json`)
- Active-state highlighting po `Astro.url.pathname`
- Nowy komponent `MobileNav.tsx` (React island) z shadcn Sheet
- Instalacja shadcn `sheet` primitive przez CLI
- Przeniesienie `<Topbar />` z `Welcome.astro` do `Layout.astro`
- Manualny QA sweep 14 × 2 × 2

**Out of scope:**
- shadcn `dropdown-menu` / `avatar` / `menubar` (płaska nawigacja wystarczy)
- Trzeci wariant Topbar dla `/auth/*` (anonimowy wystarczy)
- Bottom tab bar
- Playwright / axe testy (osobna inicjatywa)
- Redesign wizualny Topbar (kolory, glassmorphism)
- Zmiana `PROTECTED_ROUTES` w `middleware.ts`
- Ikonografia (Lucide etc.) — same etykiety tekstowe

## Architecture / Approach

```
Layout.astro
  ├── {banners} (istniejące)
  ├── <div class="p-4 sm:p-8">                     ← nowy wrapper
  │     └── <Topbar pathname={Astro.url.pathname} /> ← promowane globalnie
  │           ├── (md:hidden) <MobileNav client:load ... />  ← shadcn Sheet
  │           └── (hidden md:flex) desktop links + sign-out + LanguageSwitcher
  └── <slot />
```

`Astro.url.pathname` czytane w Layout SSR-owo, przekazane jako prop; Topbar → MobileNav propagują. Sign-out dalej działa przez istniejący `<form method="POST" action="/api/auth/signout">`.

## Phases at a Glance

| Faza                                                 | Co dostarcza                                                                | Kluczowe ryzyko                                                                     |
| ---------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1. Desktop nav — rozszerz Topbar                     | 3 nowe linki + klucze i18n + active-state (jeszcze niewidoczne globalnie)   | Złamany parytet i18n wywala `prebuild`                                              |
| 2. Mobile — hamburger drawer via shadcn Sheet        | MobileNav.tsx + shadcn Sheet + focus trap + LanguageSwitcher w drawerze     | React island `client:load` na każdej stronie — bundle bloat jeśli nie sprawdzimy   |
| 3. Global mount — przenieś Topbar do Layout.astro    | Topbar na 14 podstronach + usunięcie z Welcome + wrapper spacing            | Podwójny render na `/` jeśli zapomni się usunąć z Welcome; visual regresja na hero |
| 4. QA sweep + i18n parity gate                       | 56-pozycyjny checklist + lint/build/parity green                            | Odkrycie regresji późno — wraca do fazy 3                                          |

**Prerequisites:** F-01 (done) + S-07 (done) z roadmap. Brak nowych migracji, brak API changes.
**Estimated effort:** ~1-2 sesje agent runa (4 fazy z manual gate po każdej).

## Open Risks & Assumptions

- **Wrapper spacing na hero landingu** — Topbar w Layout dostaje wrapper `p-4 sm:p-8`; Welcome też ma zewnętrzne `p-4 sm:p-8`, ale Welcome siedzi wewnątrz `<slot />`, więc double-padding nie występuje. Do zweryfikowania wizualnie w fazie 3.
- **React-compiler safety MobileNav** — projekt ma `react-compiler/react-compiler: error`; drobny błąd (mutacja props, `useRef` w renderze) wywala CI. Trzymamy się prostego funkcyjnego komponentu bez `useEffect`.
- **Cloudflare Worker bundle size** — `@radix-ui/react-dialog` dopisany przez shadcn Sheet + client-loaded MobileNav globalnie. Ryzyko przekroczenia limitów Worker (mało prawdopodobne — ~6-8KB gzip). Weryfikowane przez `npm run build` + opcjonalne `wrangler deploy --dry-run`.

## Success Criteria (Summary)

- Każdy z 5 protected route'ów (`/dashboard`, `/generate`, `/review`, `/deck`, `/account`) ma tę samą, widoczną nawigację z active-state podświetleniem aktualnej strony.
- Na `<md` breakpoint nawigacja jest w hamburger drawerze z pełnym focus trapem, ESC/click-outside i LanguageSwitcherem w środku.
- Zero string leakage w obu językach; `npm run prebuild` przechodzi. Zero regresji na landing hero + auth flow.
