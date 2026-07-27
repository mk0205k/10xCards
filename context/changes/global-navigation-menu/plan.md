# Globalne menu nawigacyjne — Implementation Plan

## Overview

Wpięcie widocznego menu nawigacyjnego w `src/layouts/Layout.astro`, tak żeby na każdej z 14 podstron aplikacji (5 chronionych: `/dashboard`, `/generate`, `/review`, `/deck`, `/account`, landing `/`, 8 stron `/auth/*`) użytkownik miał spójny, intuicyjny sposób przemieszczania się między widokami bez wpisywania URL. Podejście: rozszerzenie istniejącego `src/components/Topbar.astro` (który już obsługuje auth-aware rendering, i18n przez paraglide i `LanguageSwitcher`) i promocja z lokalnego użycia w `Welcome.astro` do globalnego montażu w Layout.

## Current State Analysis

- **`src/layouts/Layout.astro:23-40`** renderuje `Banner` (dla brakującej konfiguracji) i `<slot />` — żadnej nawigacji. Każda podstrona żyje w izolacji.
- **`src/components/Topbar.astro:1-45`** już istnieje: renderuje warunkowo wariant zalogowany (email + linki `/dashboard`, `/account`, sign-out form, `LanguageSwitcher`) i anonimowy (etykieta "not signed in" + `/auth/signin`, `/auth/signup`, `LanguageSwitcher`).
- **Topbar jest zamontowany tylko w `src/components/Welcome.astro:29`**, który z kolei renderuje się wyłącznie na landingu (`src/pages/index.astro:6`).
- **`src/middleware.ts:5`** deklaruje `PROTECTED_ROUTES = ["/dashboard", "/generate", "/review", "/deck", "/account"]`; użytkownik jest udostępniony na `context.locals.user` (`src/middleware.ts:27`) i typowany w `src/env.d.ts:3` jako `User | null`.
- **paraglide messages** (`messages/pl.json` + `messages/en.json`) mają już klucze: `topbar_dashboard`, `topbar_account`, `topbar_signout`, `topbar_signin`, `topbar_signup`, `topbar_not_signed_in`, `language_pl`, `language_en`, `language_switcher_label`. **Brakuje** kluczy dla `/generate`, `/review`, `/deck` oraz aria-labeli otwierania/zamykania drawera.
- **`src/components/i18n/LanguageSwitcher.tsx`** jest gotowym React island (mounted via `client:load`) używanym już w Topbar.
- **`src/components/ui/`** ma 9 primitive'ów: `button`, `card`, `input`, `textarea`, `dialog`, `alert-dialog`, `alert`, `spinner`, `empty-state`, `LibBadge`. **Nie ma** `sheet` — trzeba doinstalować przez `npx shadcn@latest add sheet`.
- **Sign-out** jest oparty na `<form method="POST" action="/api/auth/signout">` (Topbar.astro:22-26, `src/pages/api/auth/signout.ts:6-12`) — Astro-friendly, żadnego JS nie wymaga.
- **`scripts/check-i18n-parity.mjs`** uruchamiane w `npm run prebuild` — nierówny zestaw kluczy między `pl.json` i `en.json` wywala build.

## Desired End State

Po zakończeniu planu:

- Zalogowany użytkownik widzi na każdej z 5 chronionych podstron ten sam poziomy pasek nawigacyjny z 5 linkami (`/dashboard`, `/generate`, `/review`, `/deck`, `/account`), sign-out form, `LanguageSwitcher`. Aktualna pozycja jest wizualnie zaznaczona (jaśniejszy kolor + underline).
- Na `<md` breakpoint pasek zwija się do prawostronnego hamburger drawera (shadcn Sheet), który zawiera te same elementy w kolumnie. Focus trap i ESC/click-outside działają przez shadcn Sheet out-of-the-box.
- Anonimowy użytkownik na `/` i `/auth/*` widzi wariant "not signed in" + `/auth/signin`, `/auth/signup`, `LanguageSwitcher`.
- `Welcome.astro` **nie** renderuje własnej instancji Topbar — jedyny montaż żyje w `Layout.astro`.
- Wszystkie widoczne stringi w menu (linki, aria-labels drawera) są przetłumaczone w `messages/pl.json` + `messages/en.json`; parytet potwierdzony przez `npm run prebuild`.
- `npm run lint`, `npm run build` przechodzą. Manualny sweep 14 podstron × 2 języki × 2 breakpointy nie ujawnia string leakage, złamanych linków ani utraconego active-state.

### Key Discoveries:

- Topbar.astro:1-45 — istniejący komponent, punkt startowy zamiast tworzenia od zera.
- Layout.astro:23-40 — jedyne miejsce, gdzie należy wpiąć nowy globalny mount.
- Welcome.astro:29 — istniejący `<Topbar />` do usunięcia po globalnym mount.
- middleware.ts:5 — kanoniczna lista chronionych route'ów; źródło prawdy dla listy linków w chronionym wariancie.
- Topbar.astro:9 — obecny styling (`mb-4 rounded-xl border`) był tuning'owany pod Welcome padding (`p-4 sm:p-8`); po przeniesieniu do Layout wymaga wrapper spacing (nie może "wisieć" bez marginesu).
- LanguageSwitcher.tsx — już zintegrowany w Topbar; zero pracy przy i18n toggle, jest częścią stanu.
- check-i18n-parity.mjs — gate w `prebuild`, więc brakujące klucze w EN wywalą CI.

## What We're NOT Doing

- Nie instalujemy shadcn `dropdown-menu` / `avatar` / `menubar` / `navigation-menu`. `/account` i sign-out zostają płaskimi pozycjami menu, nie chowane pod avatarem.
- Nie tworzymy trzeciego wariantu Topbar dla `/auth/*` (typu "minimal public bar"). Anonimowy wariant już jest odpowiedni — `LanguageSwitcher` na stronach auth ma prawdziwą wartość.
- Nie dodajemy bottom tab bara. Poziomy pasek + hamburger drawer to jedyny shape.
- Nie piszemy Playwright / axe testów. Manualny QA sweep jest wystarczający dla tego slice'a; testy automatyczne to osobna inicjatywa.
- Nie robimy redesignu wizualnego Topbar (kolory, glassmorphism). Zachowujemy obecny styling z `bg-white/5 border border-white/10` — spójne z resztą UI.
- Nie zmieniamy struktury `middleware.ts` ani `PROTECTED_ROUTES`. Lista jest źródłem prawdy tylko do referencji; nie zmieniamy jej z tego slice'a.
- Nie dodajemy ikonografii do linków (Lucide/inne). Same etykiety tekstowe, spójne z obecnym Topbar.

## Implementation Approach

Sekwencyjnie w 4 fazach z manual verification gate po każdej:

1. **Desktop nav** — rozszerzenie Topbar o brakujące linki + active-state + klucze i18n. Wszystko lokalnie w Topbar.astro; brak innych plików tknięte.
2. **Mobile drawer** — instalacja shadcn Sheet + nowy React island `MobileNav.tsx` + warunkowe renderowanie w Topbar (`md:hidden` / `hidden md:flex`).
3. **Global mount** — Topbar wpięty w Layout.astro, usunięty z Welcome.astro. Wrapper spacing skorygowany.
4. **QA sweep** — pełny checklist 14 × 2 × 2, plus automat lint/build/parity.

Kolejność jest krytyczna: fazy 1-2 dokańczają komponent, faza 3 dopiero go promuje. Odwrotna kolejność (najpierw promocja, potem rozszerzenia) oznaczałaby, że każda modyfikacja Topbar renderuje się na wszystkich 14 stronach na raz — więcej surface'u do regresji między fazami.

## Critical Implementation Details

- **Active-state źródło prawdy:** `Astro.url.pathname` czytany w Layout.astro i przekazywany do Topbar jako prop `pathname`. Nie czytamy go bezpośrednio w Topbar, bo w Astro child component nie ma dostępu do URL bez propagacji przez slot props. Alternatywa (`Astro.request.url`) też działa, ale `Astro.url.pathname` jest krótsza i idiomatyczna.
- **Klasa aktywnej pozycji:** `text-purple-100 underline underline-offset-4` (jaśniejsze niż domyślny `text-purple-300`); klasa nieaktywnej pozostaje bez zmian. Dopasowanie po prefiksie: `pathname === "/dashboard"` etc. — nie `startsWith`, bo `/auth/signin` nie powinien podświetlać `/`.
- **shadcn Sheet mount:** MobileNav to React island z `client:load`, nie `client:visible`, bo hamburger button musi być natychmiast klikalny (nie chcemy layout shift w momencie hydratacji).
- **Wrapper spacing po przeniesieniu Topbar do Layout:** Topbar zachowuje własne `mb-4 rounded-xl` (dla wizualnej separacji od content), ale Layout dodaje wokół `<Topbar />` `<div class="p-4 sm:p-8">` żeby border-radius miał oddech. Welcome.astro straci swoje `<Topbar />`, ale zewnętrzny wrapper `p-4 sm:p-8` na Welcome (Welcome.astro:28) zostaje — nie koliduje z Layout's wrapper, bo Welcome siedzi wewnątrz `<slot />`.

---

## Phase 1: Desktop nav — rozszerz Topbar

### Overview

Dodaj 3 brakujące linki (generate/review/deck), klucze i18n w obu językach, active-state highlighting. Nie ruszaj Welcome.astro ani Layout.astro. Weryfikacja: `npm run dev` → landing `/` (żeby zobaczyć Topbar) w kontekście testowym; ale bo Topbar tylko na landingu i landing nie jest chronioną trasą, faktyczna weryfikacja desktop-a przechodzi w fazie 3.

### Changes Required:

#### 1. Klucze i18n dla nowych linków

**File**: `messages/pl.json`

**Intent**: Dodaj klucze `topbar_generate`, `topbar_review`, `topbar_deck` dla polskich etykiet nowych linków chronionych.

**Contract**: 3 nowe klucze na tym samym poziomie zagnieżdżenia co istniejące `topbar_dashboard` / `topbar_account`. Wartości: `"Generuj"`, `"Powtórki"`, `"Talia"`.

**File**: `messages/en.json`

**Intent**: Dodaj te same 3 klucze w wersji angielskiej dla parytetu.

**Contract**: `topbar_generate`, `topbar_review`, `topbar_deck` z wartościami `"Generate"`, `"Review"`, `"Deck"`. Parytet z `pl.json` musi być exact — brak, dodatkowe lub zdublowane klucze wywali `scripts/check-i18n-parity.mjs` w prebuild.

#### 2. Rozszerz zalogowany wariant Topbar o 3 nowe linki + active state

**File**: `src/components/Topbar.astro`

**Intent**: Dodaj 3 nowe `<a>` tagi wewnątrz zalogowanego wariantu (branch `user ?`), używając nowych kluczy i18n. Wprowadź prop `pathname: string` w frontmatter i użyj go do warunkowego dodawania klasy `text-purple-100 underline underline-offset-4` do aktualnie aktywnego linku; nieaktywne trzymają obecną klasę `text-purple-300`. Nie ruszaj wariantu anonimowego.

**Contract**: Frontmatter deklaruje `interface Props { pathname: string }` i destrukturyzuje `const { pathname } = Astro.props`. W markupie: po `<a href="/dashboard">` dopisujemy analogiczne dla `/generate`, `/review`, `/deck` w tej kolejności. Warunek aktywności: `pathname === "/dashboard"` (dokładne dopasowanie, nie `startsWith`). Klasy scalane przez `cn()` z `@/lib/utils` — nie łączenie stringów ręcznie (per AGENTS.md convention).

### Success Criteria:

#### Automated Verification:

- `npm run lint` przechodzi (brak nowych warningów, w tym `react-compiler/react-compiler`)
- `npm run prebuild` przechodzi (parytet i18n zachowany)
- `npm run build` przechodzi (Astro sync + build)
- TypeScript nie zgłasza błędów (`npx astro check` lub równoważne)

#### Manual Verification:

- `npm run dev` → `/` renderuje Topbar w wariancie anonimowym (bo brak sesji) — bez regresji vs. przed zmianą
- Ręczne wywołanie: jeśli zalogowany, na `/` widać 5 linków (dashboard, generate, review, deck, account); ale ponieważ Topbar żyje tylko na landingu, faktyczna widoczność na chronionych stronach przyjdzie z fazą 3
- Active state weryfikowalny dopiero po fazie 3 (Topbar musi być w Layout żeby `pathname` się zmieniało między route'ami)

**Implementation Note**: Po fazie 1 pauza na potwierdzenie użytkownika — active state nie da się w pełni zweryfikować przed fazą 3, ale kod desktop-nav jest gotowy do promocji.

---

## Phase 2: Mobile — hamburger drawer via shadcn Sheet

### Overview

Doinstaluj shadcn `sheet`, zbuduj `MobileNav.tsx` (React island) zawierający wszystkie linki + sign-out form + `LanguageSwitcher`, wpinaj warunkowo do Topbar poniżej breakpointa `md`. Dodaj klucze i18n dla aria-labels drawera.

### Changes Required:

#### 1. Instalacja shadcn Sheet primitive

**File**: `src/components/ui/sheet.tsx` (nowy, wygenerowany przez CLI)

**Intent**: Doinstaluj primitive przez `npx shadcn@latest add sheet`. Nie ruszaj wygenerowanego kodu ręcznie; shadcn zajmuje się focus trapem, ESC, click-outside.

**Contract**: Nowy plik zgodny z konwencją `src/components/ui/`. Package `@radix-ui/react-dialog` (peer shadcn Sheet) zostanie dopisany do `package.json` przez CLI.

#### 2. Klucze i18n dla drawera

**File**: `messages/pl.json` + `messages/en.json`

**Intent**: Dodaj klucze `topbar_menu_open`, `topbar_menu_close`, `topbar_menu_label` dla aria-labeli hamburger buttona i drawera.

**Contract**: 3 klucze w obu plikach z zachowaniem parytetu. PL: `"Otwórz menu"`, `"Zamknij menu"`, `"Menu nawigacyjne"`. EN: `"Open menu"`, `"Close menu"`, `"Navigation menu"`.

#### 3. Komponent MobileNav.tsx (React island)

**File**: `src/components/MobileNav.tsx` (nowy)

**Intent**: React komponent (nie Astro), który wraper Sheet: `<SheetTrigger>` jako hamburger button (ikona SVG lub 3 kreski w CSS — bez Lucide, żeby nie dodawać zależności), `<SheetContent side="right">` z pionową listą linków, sign-out formem i `<LanguageSwitcher />`. Przyjmuje prop `user: { email: string } | null` żeby wiedział, który wariant renderować (analogicznie do Topbar). Przyjmuje `pathname: string` dla active-state (te same klasy co desktop).

**Contract**: `export default function MobileNav({ user, pathname }: MobileNavProps)`. Type `MobileNavProps` deklarowany lokalnie (nie w `src/types.ts` — komponent-lokalny). Brak `useEffect`, brak zewnętrznego stanu — Sheet zarządza swoim open/closed state wewnętrznie. Musi być React-compiler-safe (żadnych mutacji propsów, żadnych `useRef` mutacji podczas renderu) — inaczej lint wywali build. Sign-out form to `<form method="POST" action="/api/auth/signout">` — dokładna kopia z Topbar.astro:22-26.

#### 4. Wpinanie MobileNav w Topbar

**File**: `src/components/Topbar.astro`

**Intent**: Import `MobileNav` z `@/components/MobileNav`. Owiń desktop nav (obecny `<div class="flex items-center gap-3">`) klasą `hidden md:flex`. Dodaj `<MobileNav client:load user={user} pathname={pathname} />` przed nim z klasą `md:hidden`. Kontener zewnętrzny Topbar zostawia jak jest.

**Contract**: Dwa równorzędne children w brancn `user ?` (i analogicznie w `!user`): `<MobileNav>` z klasą `md:hidden`, i istniejący desktop `<div>` z dopisaną `hidden md:flex`. Serializacja propsów Astro → React island: `user` i `pathname` są plain-serializowalne (brak funkcji, brak klas). Aria attributes na hamburger buttonie: `aria-label={m.topbar_menu_open()}`, `aria-expanded` sterowane przez Sheet.

### Success Criteria:

#### Automated Verification:

- `npm run lint` przechodzi (w tym `react-compiler/react-compiler` na MobileNav.tsx)
- `npm run prebuild` przechodzi (parytet i18n)
- `npm run build` przechodzi (bundle include'uje shadcn Sheet + Radix Dialog, ale tylko na trasach które je używają)
- `package.json` ma `@radix-ui/react-dialog` (dopisany przez shadcn CLI)

#### Manual Verification:

- `npm run dev` → `/` na window szerokości < 768px pokazuje hamburger; klik otwiera drawer z linkami; ESC zamyka; click-outside zamyka
- Focus trap: Tab wewnątrz otwartego drawera nie ucieka do treści strony
- LanguageSwitcher w drawerze działa (przełącza język i drawer się odświeża odpowiednio)
- Na > 768px drawer nie renderuje się, desktop nav widać normalnie
- Zmiana rozmiaru okna przez breakpoint 768px w locie nie powoduje FOUC ani zawieszenia stanu drawera

**Implementation Note**: Pauza po fazie 2. Faza 3 to głęboka zmiana Layout — nie warto zaczynać jej dopóki desktop + mobile Topbar nie są solidne w izolacji.

---

## Phase 3: Global mount — przenieś Topbar do Layout.astro

### Overview

Wpnij `<Topbar />` w Layout.astro. Usuń `<Topbar />` z Welcome.astro. Popraw wrapper spacing, żeby topbar wyglądał sensownie na wszystkich kształtach stron (landing hero, chronione dashboard-y, formularze auth).

### Changes Required:

#### 1. Layout.astro — globalny mount Topbar

**File**: `src/layouts/Layout.astro`

**Intent**: Import `Topbar` z `@/components/Topbar.astro`. Wpnij `<Topbar pathname={Astro.url.pathname} />` wewnątrz `<body>`, po pętli banner-ów a przed `<slot />`. Owiń zewnętrznym wrapperem `<div class="p-4 sm:p-8">` dla wizualnego oddechu wokół rounded borderów Topbar.

**Contract**: Po zmianie struktura body to: `{banners}` → `<div class="p-4 sm:p-8"><Topbar pathname={Astro.url.pathname} /></div>` → `<slot />`. `Astro.url.pathname` jest server-side (Astro renderuje SSR w `output: "server"` mode per astro.config.mjs:11) — dostępne na każdym request.

#### 2. Welcome.astro — usuń lokalny Topbar

**File**: `src/components/Welcome.astro`

**Intent**: Skasuj linię `import Topbar from "@/components/Topbar.astro";` i element `<Topbar />` (Welcome.astro:29). Zewnętrzny wrapper `<div class="relative z-10 p-4 sm:p-8">` (Welcome.astro:28) zostawiamy — nadal potrzebny dla hero + feature cards.

**Contract**: Diff to strict deletion, żadnych kompensujących zmian — po zmianie Welcome renderuje bezpośrednio hero jako pierwsze dziecko wrappera. Wizualnie hero podskoczy o kilka pikseli (brak marginesu bottom-4 z usuniętego Topbar) — akceptowalne, bo hero i tak ma `py-24 sm:py-32 lg:py-40`.

#### 3. Weryfikacja braku double-mount

**File**: — (grep, nie edit)

**Intent**: Po edycji: `grep -rn "import Topbar" src/` powinno zwrócić tylko `src/layouts/Layout.astro`. Jeśli jakiś inny plik importował Topbar (aktualnie tylko Welcome), to double-render.

**Contract**: Zero wyników poza Layout.astro w output grepa.

### Success Criteria:

#### Automated Verification:

- `npm run lint` przechodzi
- `npm run prebuild` przechodzi (parytet i18n)
- `npm run build` przechodzi (Astro sync + build)
- `grep -rn "import Topbar" src/` zwraca **tylko** `src/layouts/Layout.astro`

#### Manual Verification:

- `npm run dev` → każda z 14 stron pokazuje Topbar na górze (desktop): landing `/`, `/dashboard`, `/generate`, `/review`, `/deck`, `/account`, `/auth/signin`, `/auth/signup`, `/auth/confirm`, `/auth/confirm-email`, `/auth/reset-password`, `/auth/reset-password-sent`, `/auth/update-password`, `/auth/restore-account`
- Landing `/` nie renderuje Topbara dwa razy
- Anonimowy wariant Topbar (bo brak sesji) pokazuje się na `/` i `/auth/*`; zalogowany wariant na 5 chronionych trasach
- Active state podświetla dokładnie aktualną stronę na każdej z chronionych tras
- Kliknięcie każdego z 5 linków w chronionym Topbar prowadzi do właściwej trasy bez błędu 4xx/5xx
- Hero na landingu wizualnie sensowny bez lokalnego Topbara

**Implementation Note**: Największa faza pod względem visual impact. Pauza obowiązkowa przed fazą 4 — jeśli tu jest visual regresja, faza 4 tylko ją potwierdzi.

---

## Phase 4: QA sweep + i18n parity gate

### Overview

Pełny manualny checklist 14 podstron × 2 języki × 2 breakpointy. Automat: lint, build, parity. Rezultat: gotowość do PR.

### Changes Required:

#### 1. QA checklist (nie plik, ale procedura)

**File**: `context/changes/global-navigation-menu/qa-checklist.md` (opcjonalny artefakt QA — do usunięcia po zamknięciu; jeśli implementer preferuje, checklist żyje w ticket / PR description zamiast pliku)

**Intent**: Spisz procedurę weryfikacji ręcznej — po jednym wierszu na kombinację (route × język × breakpoint). Nie generuj kodu.

**Contract**: Tabela lub lista markdown z checkboxami. 14 route × 2 (PL/EN) × 2 (desktop/mobile) = 56 pozycji. Dla każdej: (a) Topbar renderuje się w oczekiwanym wariancie (anonimowy/zalogowany), (b) wszystkie linki mają tłumaczenia (brak literałów PL w EN i odwrotnie), (c) active state podświetla właściwą pozycję na trasach chronionych, (d) na mobile hamburger otwiera drawer, drawer ma wszystkie te same linki co desktop.

#### 2. Automat: lint / build / parity

**File**: — (komendy CI, nie edit)

**Intent**: Run `npm run lint && npm run prebuild && npm run build` lokalnie przed pushem. Wszystkie muszą przejść.

**Contract**: Zero errorów, zero nowych warningów.

### Success Criteria:

#### Automated Verification:

- `npm run lint` — zero errorów, zero nowych warningów (baseline z `master`)
- `npm run prebuild` — parytet i18n potwierdzony
- `npm run build` — build przechodzi, Cloudflare Worker bundle się produkuje
- (opcjonalnie) `wrangler deploy --dry-run` weryfikuje że bundle mieści się w Cloudflare Worker limitach

#### Manual Verification:

- Wszystkie 56 pozycji QA checklist zaznaczone jako OK
- Zero string leakage (żaden literał PL w EN i odwrotnie)
- Active state precyzyjny na wszystkich 5 chronionych trasach
- Mobile drawer działa: otwiera, zamyka, focus trap, ESC, click-outside, LanguageSwitcher w drawerze
- Keyboard nav: Tab przez wszystkie linki + hamburger button w spójnej kolejności; Enter na linku nawiguje; Space na hamburger otwiera drawer

**Implementation Note**: Ostatni gate. Po zamknięciu tej fazy slice gotowy do PR + merge + archive (`/10x-archive global-navigation-menu`).

---

## Testing Strategy

### Unit Tests:

- Brak. Projekt nie ma unit test setupu; wprowadzenie samego frameworka byłoby side dep poza scope tego slice'a.

### Integration Tests:

- Brak. Playwright / Astro test API nie są zainstalowane w projekcie. Manualny QA jest wystarczający dla zakresu (UI/navigation, brak logiki biznesowej).

### Manual Testing Steps:

1. `npm run dev` — dev server na `localhost:4321`.
2. Nie zalogowany: odwiedź `/` → Topbar anonimowy widoczny. Powtórz dla `/auth/signin`, `/auth/signup`, `/auth/reset-password`, `/auth/reset-password-sent`, `/auth/confirm`, `/auth/confirm-email`, `/auth/update-password`, `/auth/restore-account`.
3. Zaloguj się (istniejący user lub `/auth/signup`).
4. Zalogowany: odwiedź `/dashboard`, `/generate`, `/review`, `/deck`, `/account`. Na każdej sprawdź:
   - Topbar renderuje się w wariancie zalogowanym z 5 linkami + sign-out + LanguageSwitcher
   - Active state podświetla aktualną trasę (dokładnie jedną)
   - Kliknięcie każdego linku prowadzi do właściwej trasy
5. Przełącz język na EN, powtórz p. 2 i p. 4 — brak polskich literałów w EN.
6. Zmniejsz okno < 768px (albo devtools mobile preview) — desktop nav znika, hamburger pojawia się. Klik → drawer się otwiera z tymi samymi linkami. ESC/click-outside/link click zamykają drawer.
7. Powtórz p. 6 dla obu języków i dla zalogowanego + anonimowego stanu.
8. Sign-out: klik → redirect do `/`, Topbar wraca do wariantu anonimowego.

## Performance Considerations

- MobileNav to jedyny nowy React island dodany globalnie. `client:load` oznacza hydratację na każdej stronie — ale bundle jest mały (~6-8KB gzip po Radix Dialog + shadcn Sheet + LanguageSwitcher, który już tam był).
- Layout SSR-uje na każdy request (Cloudflare Worker, `output: "server"`). Dodanie Topbara to +5-10ms server render — negligible.
- Brak nowych DB queries, brak nowych API calls. Sign-out działa przez istniejący `POST /api/auth/signout`.

## Migration Notes

- Brak migracji DB. Brak zmian w RLS.
- Brak zmian w schemacie `messages/*.json` poza dodaniem 6 kluczy (3 linki + 3 aria-labels drawera). Migracja użytkownika: żadna — cookie preferencji języka pozostaje zgodne.
- Rollback: revert commit z Layout.astro + Welcome.astro + Topbar.astro + MobileNav.tsx + shadcn Sheet + klucze i18n. Nic w persistent state się nie zmienia.

## References

- Roadmap slice: `context/foundation/roadmap.md` § `S-08: Globalne menu nawigacyjne`
- Istniejący komponent do rozszerzenia: `src/components/Topbar.astro:1-45`
- Pattern LanguageSwitcher: `src/components/i18n/LanguageSwitcher.tsx` + `context/archive/2026-07-23-i18n-pl-en-toggle/plan.md`
- Middleware / user context: `src/middleware.ts:5, 27`, `src/env.d.ts:3`
- i18n parity gate: `scripts/check-i18n-parity.mjs`, `AGENTS.md` § Internationalization
- shadcn add sheet: `https://ui.shadcn.com/docs/components/sheet` (przez `npx shadcn@latest add sheet`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Desktop nav — rozszerz Topbar

#### Automated

- [x] 1.1 `npm run lint` przechodzi (brak nowych warningów, w tym `react-compiler/react-compiler`) — 50cb6a0
- [x] 1.2 `npm run prebuild` przechodzi (parytet i18n zachowany) — 50cb6a0
- [x] 1.3 `npm run build` przechodzi (Astro sync + build) — 50cb6a0
- [x] 1.4 TypeScript nie zgłasza błędów (`npx astro check` lub równoważne) — 50cb6a0

#### Manual

- [x] 1.5 `npm run dev` → `/` renderuje Topbar w wariancie anonimowym — bez regresji vs. przed zmianą — 50cb6a0
- [x] 1.6 Ręczne wywołanie: zalogowany widzi 5 linków (dashboard, generate, review, deck, account) na `/` — 50cb6a0
- [x] 1.7 Active state — weryfikacja odłożona do fazy 3 (Topbar musi być w Layout) — 50cb6a0

### Phase 2: Mobile — hamburger drawer via shadcn Sheet

#### Automated

- [x] 2.1 `npm run lint` przechodzi (w tym `react-compiler/react-compiler` na MobileNav.tsx) — ff7a3e6
- [x] 2.2 `npm run prebuild` przechodzi (parytet i18n) — ff7a3e6
- [x] 2.3 `npm run build` przechodzi — ff7a3e6
- [x] 2.4 `package.json` ma `@radix-ui/react-dialog` (dopisany przez shadcn CLI) — ff7a3e6

#### Manual

- [x] 2.5 `npm run dev` → `/` na < 768px pokazuje hamburger; klik otwiera drawer z linkami — ff7a3e6
- [x] 2.6 ESC zamyka drawer; click-outside zamyka drawer — ff7a3e6
- [x] 2.7 Focus trap: Tab wewnątrz otwartego drawera nie ucieka do treści strony — ff7a3e6
- [x] 2.8 LanguageSwitcher w drawerze działa (przełącza język i drawer się odświeża odpowiednio) — ff7a3e6
- [x] 2.9 Na > 768px drawer nie renderuje się, desktop nav widać normalnie — ff7a3e6
- [x] 2.10 Zmiana rozmiaru okna przez breakpoint 768px w locie nie powoduje FOUC ani zawieszenia stanu drawera — ff7a3e6

### Phase 3: Global mount — przenieś Topbar do Layout.astro

#### Automated

- [x] 3.1 `npm run lint` przechodzi — 62963b9
- [x] 3.2 `npm run prebuild` przechodzi (parytet i18n) — 62963b9
- [x] 3.3 `npm run build` przechodzi — 62963b9
- [x] 3.4 `grep -rn "import Topbar" src/` zwraca **tylko** `src/layouts/Layout.astro` — 62963b9

#### Manual

- [x] 3.5 Każda z 14 stron pokazuje Topbar na górze (desktop) — 62963b9
- [x] 3.6 Landing `/` nie renderuje Topbara dwa razy — 62963b9
- [x] 3.7 Anonimowy wariant Topbar pokazuje się na `/` i `/auth/*`; zalogowany wariant na 5 chronionych trasach — 62963b9
- [x] 3.8 Active state podświetla dokładnie aktualną stronę na każdej z chronionych tras — 62963b9
- [x] 3.9 Kliknięcie każdego z 5 linków w chronionym Topbar prowadzi do właściwej trasy bez błędu 4xx/5xx — 62963b9
- [x] 3.10 Hero na landingu wizualnie sensowny bez lokalnego Topbara — 62963b9

### Phase 4: QA sweep + i18n parity gate

#### Automated

- [x] 4.1 `npm run lint` — zero errorów, zero nowych warningów (baseline z `master`)
- [x] 4.2 `npm run prebuild` — parytet i18n potwierdzony
- [x] 4.3 `npm run build` — build przechodzi, Cloudflare Worker bundle się produkuje

#### Manual

- [x] 4.4 Wszystkie 56 pozycji QA checklist (14 route × 2 języki × 2 breakpointy) zaznaczone jako OK
- [x] 4.5 Zero string leakage (żaden literał PL w EN i odwrotnie)
- [x] 4.6 Active state precyzyjny na wszystkich 5 chronionych trasach
- [x] 4.7 Mobile drawer: otwiera, zamyka, focus trap, ESC, click-outside, LanguageSwitcher w drawerze
- [x] 4.8 Keyboard nav: Tab przez wszystkie linki + hamburger button w spójnej kolejności; Enter nawiguje; Space otwiera drawer
