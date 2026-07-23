# Internacjonalizacja UI (PL/EN, domyślnie polski) — Implementation Plan

## Overview

Wprowadzenie mechaniki i18n na bazie Paraglide (`@inlang/paraglide-js`) z tłumaczeniem całego widocznego UI PL/EN, przełącznikiem w Topbarze, domyślnie polskim i persystencją preferencji w cookie. Wszystkie ~85 hardcoded polskich stringów w ~21 plikach zostają wyekstrahowane w jednym change'u (bez okna string-leakage). API zwraca kody błędów zamiast stringów — klient mapuje je na tłumaczenia. Brakujący klucz w którymkolwiek z języków wywala build (strict mode przez inlang lint), co egzekwuje dyscyplinę wymaganą przez S-07 Risk.

## Current State Analysis

Aplikacja jest de facto polskojęzyczna, ale `src/layouts/Layout.astro:14` hardcoduje `<html lang="en">` — treść i tag nie zgadzają się. Nie ma żadnej biblioteki i18n, żadnej kolumny `locale` w `public.profiles`, żadnego cookie językowego. Jedyny locale-aware kod to `restore-account.astro:32-36` z hardcoded `"pl-PL"` w `toLocaleDateString`.

Widoczne PL stringi rozłożone są w trzech skupiskach:

- **Auth flow** (~40% masy): 9 plików `.astro` w `src/pages/auth/*` + formularze `SignInForm.tsx`, `SignUpForm.tsx`, `ResetPasswordForm.tsx`, `UpdatePasswordForm.tsx`.
- **Account lifecycle**: `DeleteAccountDialog.tsx`, `restore-account.astro`, `src/pages/account/index.astro`.
- **Core features**: `GeneratePanel.tsx`/`GenerateForm.tsx`, `ReviewSession.tsx`, `DeckPanel.tsx`/`CardListItem.tsx`/`CardFormDialog.tsx`/`DeleteConfirmDialog.tsx`, `Topbar.astro`, landing `index.astro`.
- **API**: 4 endpointy (`api/auth/reset-confirm.ts`, `api/auth/reset-request.ts`, `api/account/delete.ts`, `api/account/restore.ts`) zwracają polskie stringi w polu `error`.

Architektura sprzyja: SSR (`output: "server"`), pojedynczy `Layout.astro` obejmuje wszystkie strony, `src/middleware.ts` już wykonuje się na każdym request'cie (istnieje naturalny hook point). 8 wysepek React używa `client:load` — wystarczy jedna dodatkowa (przełącznik) lub inline w Astro. Cookie'sy są już używane (Supabase SSR) — dodanie `PARAGLIDE_LOCALE` nie wprowadza nowej infrastruktury.

## Desired End State

Aplikacja renderuje cały widoczny UI (nawigacja, formularze, komunikaty walidacji, dialogi, empty states, komunikaty błędów API mapowane na kliencie, strony auth/review/deck/account) w dwóch językach. Domyślnym językiem jest polski (`baseLocale: "pl"`); użytkownik przełącza język przez widoczny przełącznik w `Topbar.astro`, wybór persystuje w cookie `PARAGLIDE_LOCALE` (1 rok, `SameSite=Lax`) i utrzymuje się między requestami. Atrybut `<html lang>` w `Layout.astro` odpowiada aktywnemu locale. Treść fiszek generowanych przez AI pozostaje w języku wklejonego tekstu (bez zmian w `/generate`). Build CI wywala się, jeśli w `messages/pl.json` lub `messages/en.json` brakuje któregoś klucza.

### Key Discoveries:

- Header aplikacji żyje w `src/components/Topbar.astro:1-40` (nie w `Layout.astro`). `Layout.astro:1-49` to tylko wrap z bannerami config-status i slotem.
- `src/middleware.ts:1-50` już czyta Supabase session z headerów i wpisuje `user` w `Astro.locals`, zawiera logikę redirectów soft-delete (linie 6-36) i protected-routes (linie 42-46). Paraglide middleware musi opakować całość — zewnętrzna warstwa — żeby jego async-local locale był aktywny podczas wszystkich SSR renderów w tym samym request'cie.
- Paraglide 2.x publikuje jeden pakiet `@inlang/paraglide-js`; stare `@inlang/paraglide-astro` / `@inlang/paraglide-js-adapter-astro` już nie istnieją. Plugin `paraglideVitePlugin` idzie do `vite.plugins` w `astro.config.mjs`.
- Strategy `["url", "cookie", "globalVariable", "baseLocale"]` w konfiguracji Paraglide implementuje decyzję "cookie only, no URL prefix" — `url` pozostaje w liście na wypadek przyszłej zmiany, ale bez prefixów jest bez efektu.
- `react-compiler/react-compiler` w tym projekcie ma poziom `error` (AGENTS.md); switcher w React musi być compiler-safe (żadnych zewnętrznych mutacji, żadnych async handlerów w event listenerach).
- `no-misused-promises` jest wyłączone tylko dla `.astro` (`context/foundation/lessons.md`); reguła nadal działa dla `.ts`/`.tsx` — refactor endpointów API na kody błędów musi tego przestrzegać.
- Migracja `20260723165737_soft_delete_and_retention.sql` dodała `public.profiles` z 3 kolumnami (`user_id`, `deleted_at`, `scheduled_hard_delete_at`). Zgodnie z decyzją "cookie only" NIE dokładamy tu kolumny `locale`.
- CI już uruchamia `npx astro sync` przed lintem (`.github/workflows/ci.yml`), co jest wymagane, żeby TypeScript widział typy generowane przez Paraglide (`src/paraglide/*.d.ts`) — nie trzeba wprowadzać nowego kroku.

## What We're NOT Doing

- **Prefixed routes** (`/pl/...`, `/en/...`) — cookie-only zgodnie z decyzją, żeby uniknąć rewrite'u wszystkich linków wewnętrznych i redirectów.
- **Kolumna `locale` w `profiles`** — cookie-only; brak migracji, brak RLS zmian, brak cross-device sync (świadomy trade-off).
- **Tłumaczenie treści fiszek generowanych przez AI** — pozostają w języku wklejonego tekstu; UI chrome jest niezależny.
- **Tłumaczenie template'ów emaili Supabase Auth** — są zarządzane przez Supabase, nie przez ten repo; poza zakresem.
- **Podmiana `<html lang>` per komponent / server route** — jedno źródło prawdy w `Layout.astro`.
- **Language detection z `Accept-Language`** — nie w tym change'u; domyślny locale to `pl`, chyba że użytkownik jawnie przełączył. Nagłówek można dorzucić później jako soft-detect w middleware.
- **AGENTS.md/CLAUDE.md kompletny rewrite** — dodajemy tylko krótką sekcję i18n z regułą "każdy nowy string musi mieć klucz w obu językach".
- **Testy Playwright/E2E dla obu języków** — projekt nie ma jeszcze setupu Playwright; regresja przez manualne QA + strict-mode build.

## Implementation Approach

Kolejność: infrastruktura (setup Paraglide + middleware + Layout + Topbar switcher) → migracja tekstów top-down po warstwach (auth → core → API errors) → regresja. Kluczową dyscypliną jest strict-mode build (missing-key = build fail) — to gate, który wychwyci każdy przeoczony string zanim trafi na produkcję. Każda faza kończy się `npm run build` — jeśli buduje, faza jest zamknięta.

Struktura wiadomości: pliki-per-locale (`messages/pl.json`, `messages/en.json`), klucze płaskie z konwencją `<obszar>_<akcja_lub_kontekst>` (np. `auth_signin_title`, `deck_card_delete_button`, `error_password_too_weak`). Kompilowany output ląduje w `src/paraglide/` (gitignored) i jest generowany przez `astro sync` / `astro build`.

## Critical Implementation Details

- **Kolejność middleware'u** — `paraglideMiddleware` opakowuje istniejącą logikę auth/soft-delete w `src/middleware.ts`. Musi być zewnętrzny, bo ustawia async-local locale kontekst, z którego korzystają wszystkie downstream `m.foo()` w Astro layoutach, `.astro` stronach i React wysepkach renderowanych w tym samym request'cie. Jeśli redirect Astro wystrzeli przed paraglide, ekran przejściowy zrenderuje się z domyślnym locale.
- **React-compiler safety w Language Switchera** — komponent musi być czystą funkcją reagującą na click bez efektów ubocznych w renderze. `setLocale('en')` z `@/paraglide/runtime.js` wykonuje `document.cookie = ...; location.reload()` — wywołanie z event handlera jest bezpieczne, ale nie może być zawinięte w `useEffect` ani zwracane z pamięcianego callbacka na podstawie zewnętrznego stanu.
- **API errors: kontrakt kodu** — endpoint zwraca `{ error: "PASSWORD_TOO_WEAK", status: 400 }`; klient trzyma mapowanie kod → klucz Paraglide w jednym pliku (`src/lib/error-messages.ts`) i renderuje `m.error_password_too_weak()`. Nieznany kod → fallback `m.error_unknown()`. Serwer NIE zwraca tekstu — jedna prawda po stronie klienta.
- **`<html lang>` musi używać runtime locale, nie stałej** — `Layout.astro` importuje `getLocale()` z `@/paraglide/runtime.js` w frontmatter i wstawia wynik w atrybut. Zapomnienie tego pozostawia `<html lang="en">` z polską treścią (obecny bug).
- **`src/paraglide/` do `.gitignore`** — kompilowane pliki są artefaktem builda; CI regeneruje je przez `astro sync`. Wersjonowanie ich produkowałoby merge conflicts.

## Phase 1: Setup Paraglide + middleware + Layout + Topbar switcher

### Overview

Instalacja pakietu, inicjalizacja projektu inlang, konfiguracja Astro + Vite plugin, opakowanie istniejącego middleware'u, zdynamizowanie `<html lang>` w Layoucie i dorzucenie widocznego przełącznika PL/EN do Topbar'a. Po tej fazie mechanika działa end-to-end — użytkownik może przełączać, cookie się zapisuje, `<html lang>` się zmienia — nawet jeśli 99% stringów jest jeszcze hardcoded PL.

### Changes Required:

#### 1. Instalacja pakietu i init projektu inlang

**File**: `package.json`, `project.inlang/`, `messages/pl.json`, `messages/en.json`

**Intent**: Dodaj `@inlang/paraglide-js` jako dependency (nie devDep — potrzebny w runtime SSR). Uruchom `npx @inlang/paraglide-js@latest init` żeby wygenerować `project.inlang/settings.json` (`baseLocale: "pl"`, `locales: ["pl", "en"]`) i placeholder `messages/pl.json` + `messages/en.json`. Włącz lint rule `messageBundleLintMissingTranslation` w `project.inlang/settings.json` (severity: error).

**Contract**: `package.json` dependencies dostaje `"@inlang/paraglide-js": "^2.x"`. `project.inlang/settings.json` zawiera `{"baseLocale": "pl", "locales": ["pl", "en"], "modules": [...missingTranslation rule...]}`. `messages/pl.json` i `messages/en.json` istnieją (choćby z jednym testowym kluczem).

#### 2. Konfiguracja `astro.config.mjs`

**File**: `astro.config.mjs`

**Intent**: Dodaj sekcję `i18n` na poziomie Astro (`defaultLocale: "pl"`, `locales: ["pl", "en"]`) i wpuść `paraglideVitePlugin` do `vite.plugins`. Strategia lokali: `["cookie", "globalVariable", "baseLocale"]` — `url` pomijamy, bo nie robimy prefixowych routes; `globalVariable` jest wymagany, żeby middleware mógł nadpisać locale dla danego requestu.

**Contract**: Import `paraglideVitePlugin` z `@inlang/paraglide-js`. Plugin wywołany z `{ project: "./project.inlang", outdir: "./src/paraglide", strategy: ["cookie", "globalVariable", "baseLocale"] }`. Sekcja `i18n` sąsiaduje z istniejącymi `output: "server"` i `adapter: cloudflare(...)`.

#### 3. Opakowanie middleware'u

**File**: `src/middleware.ts`

**Intent**: Zewnętrzna warstwa `paraglideMiddleware` (z `src/paraglide/server.js`) opakowuje istniejący handler tak, żeby async-local locale był aktywny podczas całego request'u. Wewnątrz callbacka Paraglide'a zachowaj obecną logikę: pobranie usera z Supabase, sprawdzenie soft-delete redirect, sprawdzenie PROTECTED_ROUTES. Nic z obecnej logiki auth nie znika ani nie zmienia kolejności między sobą — jedyna zmiana to zewnętrzny wrapper.

**Contract**: `defineMiddleware((context, next) => paraglideMiddleware(context.request, ({ request, locale }) => { /* existing body */ return next(request); }))`. Redirecty istniejące (`context.redirect("/auth/signin")`, `context.redirect("/auth/restore-account")`) muszą pozostać wywoływane wewnątrz callbacka Paraglide'a, nie na zewnątrz.

#### 4. Dynamiczny `<html lang>` w Layoucie

**File**: `src/layouts/Layout.astro`

**Intent**: Zamień hardcoded `lang="en"` na wartość z `getLocale()` z `@/paraglide/runtime.js`. Pobierz w frontmatter, wstaw jako atrybut.

**Contract**: Import `import { getLocale } from "@/paraglide/runtime.js";` w frontmatter. `<html lang={getLocale()}>` w markup. Nic więcej w tym pliku się nie zmienia w tej fazie.

#### 5. Language Switcher w Topbar

**File**: `src/components/Topbar.astro`, `src/components/i18n/LanguageSwitcher.tsx` (nowy)

**Intent**: Dodaj nową wysepkę React `LanguageSwitcher` w prawej części Topbar'a (obok linku "Signout" dla zalogowanych, obok "Sign up" dla gości). Komponent to prosty dropdown lub para buttonów `PL | EN`, aktywny stan podświetlony. Kliknięcie wywołuje `setLocale('pl' | 'en')` z runtime Paraglide, co zapisuje cookie i przeładowuje stronę.

**Contract**: `LanguageSwitcher.tsx` — funkcyjny komponent React bez propsów, wywołuje `getLocale()` na starcie żeby ustawić aktywny wskaźnik i `setLocale(next)` w onClick. Musi być react-compiler-safe (żadnego `useEffect` synchronizującego z cookie — Paraglide sam się tym zajmuje). W `Topbar.astro` — `import LanguageSwitcher from "@/components/i18n/LanguageSwitcher"` i `<LanguageSwitcher client:load />` wewnątrz istniejącego wrappera nav.

#### 6. `.gitignore` dla generowanych plików

**File**: `.gitignore`

**Intent**: Wyklucz `src/paraglide/` z kontroli wersji — to artefakty kompilacji Paraglide'a regenerowane przez `astro sync` / `astro build`.

**Contract**: Nowy wpis `src/paraglide/` w `.gitignore`.

#### 7. Placeholder kluczy dla Topbara

**File**: `messages/pl.json`, `messages/en.json`

**Intent**: Dodaj klucze użyte w Topbarze (`topbar_dashboard`, `topbar_account`, `topbar_signout`, `topbar_signin`, `topbar_signup`, `topbar_not_signed_in`, `topbar_signed_in_as`, `language_pl`, `language_en`). Zamień hardcoded stringi w `Topbar.astro` na wywołania `m.topbar_*()`. Ta faza wprowadza pełny loop na przykładzie Topbar'a — dowodzi że mechanika działa end-to-end.

**Contract**: `messages/pl.json` i `messages/en.json` mają symetryczny zestaw kluczy. `Topbar.astro` importuje `import { m } from "@/paraglide/messages.js"` i wywołuje `m.topbar_dashboard()` etc. w markupie.

### Success Criteria:

#### Automated Verification:

- Zależność `@inlang/paraglide-js` zainstalowana: `npm ls @inlang/paraglide-js` zwraca wersję.
- Generacja Paraglide przechodzi: `npx astro sync` produkuje `src/paraglide/messages.js`, `runtime.js`, `server.js` bez błędów.
- TypeScript przechodzi: `npm run astro -- check` (lub `npx astro check`) zielone.
- Lint przechodzi: `npm run lint`.
- Build przechodzi: `npm run build`.
- Strict mode działa: usunięcie klucza z `messages/en.json` powoduje failure `npm run build` (weryfikacja ręcznym testem jednego brakującego klucza + revert).

#### Manual Verification:

- Uruchomienie `npm run dev`, wejście na `/` — Topbar renderuje polskie napisy, `<html lang="pl">` w źródle strony.
- Kliknięcie przełącznika na EN — strona się przeładowuje, Topbar renderuje angielskie napisy, `<html lang="en">` w źródle, cookie `PARAGLIDE_LOCALE=en` obecne w DevTools.
- Odświeżenie strony — wybór EN persystuje.
- Kliknięcie z powrotem na PL — Topbar wraca do polskiego, cookie `PARAGLIDE_LOCALE=pl`.
- Logowanie/wylogowanie nie resetuje wyboru języka (cookie żyje niezależnie od Supabase session).

**Implementation Note**: Po zakończeniu automated verification zatrzymaj się i poproś użytkownika o potwierdzenie manualnego testowania zanim przejdziesz do Fazy 2.

---

## Phase 2: Auth surface — 9 stron auth + formularze

### Overview

Ekstrakcja wszystkich hardcoded polskich stringów z auth flow: 9 plików `.astro` w `src/pages/auth/*` + 4 komponenty React formularzy + `src/pages/account/index.astro` + `DeleteAccountDialog.tsx` + `restore-account.astro`. To najgęściejsze skupisko stringów (~40% masy). Po tej fazie build nadal przechodzi, ale strict-mode Paraglide'a już zaczyna pilnować parytetu kluczy.

### Changes Required:

#### 1. Ekstrakcja stringów ze stron auth

**File**: `src/pages/auth/signin.astro`, `src/pages/auth/signup.astro`, `src/pages/auth/reset-password.astro`, `src/pages/auth/reset-password-sent.astro`, `src/pages/auth/confirm.astro`, `src/pages/auth/confirm-email.astro`, `src/pages/auth/update-password.astro`, `src/pages/auth/restore-account.astro`

**Intent**: Wszystkie widoczne PL stringi (nagłówki, opisy, CTA, linki, teksty pomocnicze, ARIA labels jeśli PL) zamieniane na wywołania `m.auth_*()`. Konwencja klucza: `auth_<page>_<role>` (np. `auth_signin_title`, `auth_reset_password_sent_body`, `auth_restore_account_warning`).

**Contract**: Każda strona importuje `import { m } from "@/paraglide/messages.js"` w frontmatter (Astro) lub jako import w komponencie. Wszystkie wcześniejsze literały PL w markupie zamienione na wywołania funkcji. `messages/pl.json` i `messages/en.json` dostają symetryczny zestaw kluczy — kluczem gate'ującym poprawność jest passujący `npm run build`.

#### 2. Ekstrakcja z komponentów formularzy

**File**: `src/components/auth/SignInForm.tsx`, `src/components/auth/SignUpForm.tsx`, `src/components/auth/ResetPasswordForm.tsx`, `src/components/auth/UpdatePasswordForm.tsx`

**Intent**: Labele pól, placeholder'y, komunikaty walidacji client-side, teksty przycisków, teksty stanów disabled/loading. Klucze: `auth_form_<field_or_action>`. Uwaga na react-compiler — literały w JSX można bezpiecznie zamienić na wywołania funkcji.

**Contract**: Każdy plik importuje `m` z `@/paraglide/messages.js`. Wszystkie widoczne stringi zamienione. Server errors przekazywane jako propsy z `.astro` — pozostają na razie stringami (będą zamienione na kody w Fazie 4).

#### 3. Ekstrakcja z account lifecycle

**File**: `src/pages/account/index.astro`, `src/components/account/DeleteAccountDialog.tsx`

**Intent**: Sekcja "Strefa niebezpieczna", opis 30-dniowej retencji, dialog usuwania konta z inputem potwierdzającym email. `restore-account.astro` już częściowo zrobione w poprzednim kroku (auth).

**Contract**: Klucze: `account_danger_zone_title`, `account_danger_zone_body`, `account_delete_dialog_*`. Hardcoded format daty `toLocaleDateString("pl-PL", ...)` w `restore-account.astro:32-36` pozostawiamy do Fazy 4 (regression pass) — nie blokuje niczego dziś.

### Success Criteria:

#### Automated Verification:

- Build przechodzi: `npm run build` (strict mode złapie każdy brakujący klucz w drugim języku).
- Type check przechodzi: `npx astro check`.
- Lint przechodzi: `npm run lint`.
- Grep na polskie znaki diakrytyczne w migrowanych plikach zwraca 0: `rg "[łćśąężźń]" src/pages/auth/ src/components/auth/ src/components/account/ src/pages/account/` (poza komentarzami — akceptowalny false-positive tylko wewnątrz `/* */`).

#### Manual Verification:

- Wszystkie 9 stron auth renderuje się poprawnie w PL i EN.
- Formularz signin, signup, reset-password, update-password działa w obu językach — walidacja client-side pokazuje właściwe komunikaty.
- Dialog "Usuń konto" (`DeleteAccountDialog`) — wszystkie teksty w obu językach, w tym input placeholder i disabled state.
- Strona `restore-account` — komunikat "Twoje konto oczekuje na usunięcie" pokazuje właściwy język; data wciąż w formacie `pl-PL` (będzie naprawione w Fazie 4).

**Implementation Note**: Pauza na potwierdzenie manualnego QA.

---

## Phase 3: Core features — generate, review, deck + walidacja + dialogi

### Overview

Ekstrakcja stringów z głównych ścieżek produktowych: generowanie AI, sesja review, zarządzanie talią. Około 30% masy stringów. To najbardziej user-facing warstwa — regresja tu jest widoczna od pierwszej sekundy użycia.

### Changes Required:

#### 1. Generate flow

**File**: `src/components/generate/GeneratePanel.tsx`, `src/components/generate/GenerateForm.tsx`, `src/pages/generate.astro`

**Intent**: Labele formularza (textarea, przycisk "generuj"), liczniki znaków, komunikaty ładowania, teksty stanów pustych, komunikaty błędów client-side, przyciski akcji na kartach kandydatach (accept/reject/edit), etykiety bulk actions (jeśli są, S-06 może być wcześniej albo później).

**Contract**: Klucze: `generate_form_*`, `generate_candidate_*`, `generate_bulk_*`, `generate_loading`, `generate_empty`. Import `m` z paraglide.

#### 2. Review session

**File**: `src/components/review/ReviewSession.tsx`, `src/pages/review.astro`

**Intent**: Prompt "za chwilę", labele przycisków oceny (Again/Hard/Good/Easy), komunikaty błędów pobierania kolejnej fiszki, empty state gdy brak fiszek do powtórki, komunikat zakończenia sesji.

**Contract**: Klucze: `review_session_*`, `review_rating_again`, `review_rating_hard`, `review_rating_good`, `review_rating_easy`, `review_empty_state`, `review_session_complete`. Etykiety FSRS ratings pozostają w obu językach naturalne (np. `Again`/`Znowu`, `Good`/`Dobrze`).

#### 3. Deck management

**File**: `src/components/deck/DeckPanel.tsx`, `src/components/deck/CardListItem.tsx`, `src/components/deck/CardFormDialog.tsx`, `src/components/deck/DeleteConfirmDialog.tsx`, `src/pages/deck.astro`

**Intent**: Nagłówki listy, pole wyszukiwania, "Dodaj fiszkę", empty state "Twoja talia jest pusta", label "Usuń fiszkę", teksty w dialogu edycji ("Nowa fiszka" / "Edytuj fiszkę"), komunikaty walidacji "Pytanie i odpowiedź nie mogą być puste", dialog potwierdzenia usunięcia.

**Contract**: Klucze: `deck_*`, `deck_card_*`, `deck_dialog_new`, `deck_dialog_edit`, `deck_form_validation_*`, `deck_delete_confirm_*`.

#### 4. Landing i dashboard

**File**: `src/pages/index.astro`, `src/pages/dashboard.astro`

**Intent**: Hero section landing page'a (tytuł, opis, CTA), dashboard chrome (powitanie, statystyki jeśli są, linki do generate/review/deck).

**Contract**: Klucze: `landing_hero_*`, `dashboard_greeting_*`, `dashboard_nav_*`.

#### 5. Banery config-status i inne wspólne komponenty

**File**: `src/lib/config-status.ts`, `src/components/Banner.astro` (jeśli renderuje PL), inne wspólne komponenty jeśli istnieją

**Intent**: Komunikaty konfiguracyjne (Supabase not configured, itp.). Klucze: `config_*_missing`, `config_setup_link`.

**Contract**: `src/lib/config-status.ts` zwraca kody / klucze zamiast gotowego PL tekstu; komponent bannera je renderuje przez `m`.

### Success Criteria:

#### Automated Verification:

- Build przechodzi: `npm run build`.
- Type check przechodzi.
- Lint przechodzi.
- Grep dla PL diakrytyków w `src/components/generate/`, `src/components/review/`, `src/components/deck/`, `src/pages/{index,dashboard,generate,review,deck}.astro` zwraca 0 (poza komentarzami).

#### Manual Verification:

- Landing page (`/`) w obu językach — hero + CTA właściwe.
- Dashboard w obu językach.
- Generate flow: wklejenie tekstu, generowanie, kandydaci — wszystkie labele w obu językach; edycja kandydata w dialogu w obu językach.
- Review session: start, ocena wszystkimi 4 przyciskami, komunikat zakończenia — wszystko w obu językach.
- Deck: lista, wyszukiwarka, dodanie, edycja, usunięcie fiszki z dialogiem potwierdzenia — obie wersje.
- Empty states widoczne w obu językach (pusta talia, brak fiszek do review).

**Implementation Note**: Pauza na potwierdzenie manualnego QA.

---

## Phase 4: API error codes + client mapping + regression pass

### Overview

Refactor 4 endpointów API na zwracanie kodów błędów zamiast polskich stringów. Wprowadzenie mapowania kod → klucz Paraglide w jednym pliku. Podmiana hardcoded `"pl-PL"` w `restore-account.astro:32-36` na formatowanie z aktywnym locale. Weryfikacja że nie ma leaka. Krótka aktualizacja `AGENTS.md` z konwencjami i18n.

### Changes Required:

#### 1. Refactor endpointów API

**File**: `src/pages/api/auth/reset-confirm.ts`, `src/pages/api/auth/reset-request.ts`, `src/pages/api/account/delete.ts`, `src/pages/api/account/restore.ts`

**Intent**: Każdy endpoint zwraca `{ error: "<UPPER_SNAKE_CODE>" }` zamiast polskiego stringu. Kody: `PASSWORD_TOO_WEAK`, `PASSWORD_SAME_AS_OLD`, `RESET_SESSION_EXPIRED`, `RESET_TOO_MANY_ATTEMPTS`, `ACCOUNT_DELETE_FAILED`, `ACCOUNT_RESTORE_FAILED` (uzupełnić z faktycznego audytu). `prerender = false` zachowany.

**Contract**: Response body: `{ error: "PASSWORD_TOO_WEAK", status: 400 }` (kod HTTP w response, code w JSON — nie duplikować). Brak polskiego tekstu w response body. Endpointy zachowują wszystkie obecne HTTP status codes.

#### 2. Mapowanie kodów w kliencie

**File**: `src/lib/error-messages.ts` (nowy)

**Intent**: Jedno źródło mapowania: `errorCodeToMessage(code: string): string` — zwraca wywołanie `m.error_*()` z Paraglide. Nieznany kod → `m.error_unknown()`.

**Contract**: Export funkcji `errorCodeToMessage(code: string)` z pełną tablicą kodów jako typ union. Fallback do `m.error_unknown()` gwarantuje że użytkownik nigdy nie widzi surowego kodu.

#### 3. Podmiana użyć w React

**File**: `src/components/auth/UpdatePasswordForm.tsx`, `src/components/auth/ResetPasswordForm.tsx`, `src/components/account/DeleteAccountDialog.tsx`, `src/components/account/RestoreAccountForm.tsx` (jeśli istnieje / lub inline w `restore-account.astro`)

**Intent**: Zamiast wyświetlać `error` string as-is, komponenty wywołują `errorCodeToMessage(error)`.

**Contract**: Każdy consumer error importuje `errorCodeToMessage` z `@/lib/error-messages` i renderuje wynik. Kluczowe: żaden komponent nie renderuje surowej wartości `error` bez mapowania.

#### 4. Locale-aware formatowanie dat i liczb

**File**: `src/pages/auth/restore-account.astro`, `src/components/review/ReviewSession.tsx` (linia 53), `src/components/generate/GenerateForm.tsx` (linia 39, jeśli używa `toLocaleString()` bez explicit locale)

**Intent**: Zastąp hardcoded `"pl-PL"` przez wynik `getLocale()`. Dla miejsc gdzie locale jest już domyślne (`toLocaleString()` bez argumentu — używa systemu), przekaż jawnie: `.toLocaleDateString(getLocale())`, `.toLocaleString(getLocale())`.

**Contract**: `restore-account.astro` linia 32-36: `.toLocaleDateString(getLocale(), { ... })`. Analogicznie w innych miejscach. Import `getLocale` z `@/paraglide/runtime.js`.

#### 5. Aktualizacja `AGENTS.md`

**File**: `AGENTS.md`

**Intent**: Dodaj sekcję "Internationalization" z 3-4 punktami: (1) każdy widoczny string musi mieć klucz w obu `messages/*.json`, (2) API endpointy zwracają kody błędów, klient mapuje przez `src/lib/error-messages.ts`, (3) formatowanie dat/liczb używa `getLocale()`, nigdy hardcoded `pl-PL`, (4) build wywala się przy brakującym kluczu (strict mode).

**Contract**: Nowy nagłówek `## Internationalization` w `AGENTS.md`. Krótkie, konkretne reguły — zgodnie z konwencją "co jest specyficzne dla tego projektu, a nie ogólnie znane".

#### 6. Regression pass

**File**: —

**Intent**: Grep na cały projekt dla polskich diakrytyków poza `messages/pl.json` i komentarzami. Manualne przeklikanie każdego widoku w obu językach z widoczną listą kontrolną.

**Contract**: Zero string leakage — grep `rg "[łćśąężźń]" src/ --type-not md` zwraca tylko `messages/pl.json` (lub 0 poza nim).

### Success Criteria:

#### Automated Verification:

- Build przechodzi: `npm run build`.
- Type check + lint przechodzą.
- Grep dla polskich diakrytyków poza `messages/pl.json`: `rg "[łćśąężźń]" src/ --glob "!messages/pl.json"` zwraca 0.
- Endpointy API zwracają kody: manualne curl na `/api/auth/reset-confirm` z niewłaściwym hasłem zwraca `{ error: "PASSWORD_TOO_WEAK" }`, nie polski string (unit test lub curl w readme).
- `errorCodeToMessage("UNKNOWN_CODE_XYZ")` zwraca `m.error_unknown()`.

#### Manual Verification:

- Reset password flow end-to-end w obu językach: request → email → confirm → login. Każdy error case renderuje poprawnie przetłumaczony komunikat.
- Delete account + restore flow w obu językach — daty pokazują się w formacie właściwym dla locale.
- Generate + review + deck — pełny obchód aplikacji w EN, potem pełny obchód w PL. Zero polskich stringów w widoku EN, zero angielskich w PL.
- Przełącznik z PL na EN i z powrotem na dowolnej stronie działa bez błędów; wybór persystuje między sesjami (zamknij i otwórz przeglądarkę z zachowaniem cookies).
- `<html lang>` w każdej podstronie zgadza się z aktywnym locale.
- `AGENTS.md` czytelny, reguły łatwe do zastosowania.

**Implementation Note**: To ostatnia faza — po passing manual QA change jest gotowy do PR / merge.

---

## Testing Strategy

### Unit Tests:

- `errorCodeToMessage("PASSWORD_TOO_WEAK")` zwraca `m.error_password_too_weak()` output.
- `errorCodeToMessage("__NONEXISTENT__")` zwraca `m.error_unknown()` output.
- (Opcjonalnie, jeśli istnieje setup Vitest) test snapshot na render `LanguageSwitcher` w obu locale states.

### Integration Tests:

- Brak — projekt nie ma jeszcze setupu Playwright / E2E. Regresja przez manualne QA w Success Criteria każdej fazy + strict-mode build który wychwyci brakujące klucze bez human'a.

### Manual Testing Steps:

1. `npm run dev` → wejście na `/` → potwierdzenie PL domyślnie i `<html lang="pl">`.
2. Kliknięcie przełącznika PL → EN → strona przeładowuje się, cały widoczny UI po angielsku, `<html lang="en">`, cookie `PARAGLIDE_LOCALE=en` obecne.
3. Nawigacja do każdej podstrony (`/dashboard`, `/generate`, `/review`, `/deck`, `/account`, wszystkie 8 pod `/auth/*`) i wizualne potwierdzenie że każdy widoczny tekst jest po angielsku.
4. Powrót do PL — analogiczny sweep.
5. Wyloguj i wejdź na `/auth/signin` — przełącznik działa dla guest usera.
6. Wykonaj reset-password flow w EN — email trigger (Supabase-managed), potem confirm strona po angielsku, potem update-password.
7. Wykonaj delete-account + restore flow w EN — dialog, data w formacie angielskim (m/d/yyyy albo lokalny en), restore.
8. Wygeneruj fiszki z polskiego tekstu z UI w EN — potwierdzenie że treść fiszek pozostaje polska, chrome jest angielski.
9. Zamknij i otwórz przeglądarkę → cookie persystuje, EN zostaje.
10. Wyczyść cookies → powrót do PL (domyślne).

## Performance Considerations

Paraglide 2.x kompiluje wiadomości do tree-shakable funkcji — bundle rośnie proporcjonalnie do liczby _użytych_ kluczy per strona, nie całkowitej liczby kluczy w `messages/*.json`. Dla ~150 kluczy w tym change'u realny wzrost bundle'a per-page to <5 KB gzipped. Runtime overhead: `paraglideMiddleware` wykonuje jedno cookie-read per request — negligible w SSR na Cloudflare Workers (żadnych I/O, brak dodatkowego round-tripa do bazy). `<html lang>` liczy się raz per SSR render. Przełącznik nie robi żadnych fetch'y — tylko cookie write + `location.reload()`.

## Migration Notes

Brak migracji SQL. Brak zmian w schemacie Supabase. Istniejące sesje użytkowników się nie zerwą — Supabase session cookies żyją niezależnie od `PARAGLIDE_LOCALE`. Użytkownicy, którzy odwiedzą aplikację po deploy'u i nie mają jeszcze cookie `PARAGLIDE_LOCALE`, dostaną `baseLocale` (`pl`) — czyli zachowanie identyczne z obecnym stanem (aplikacja renderuje PL). Jedyna widoczna zmiana dla nich to nowy przełącznik w Topbar i naprawiony `<html lang>`.

Rollback: revert PR-a. Cookie `PARAGLIDE_LOCALE` w przeglądarkach użytkowników wygaśnie zgodnie z ustawieniem (1 rok) lub zostanie zignorowana po revercie — brak konsekwencji dla użytkownika.

## References

- Roadmap slice: `context/foundation/roadmap.md` — S-07
- Change identity: `context/changes/i18n-pl-en-toggle/change.md`
- Paraglide (upstream): pakiet `@inlang/paraglide-js` (v2.x — jeden pakiet dla wszystkich frameworków)
- Layout wrapper: `src/layouts/Layout.astro:14` (hardcoded `lang="en"`)
- Header: `src/components/Topbar.astro:1-40`
- Middleware: `src/middleware.ts:1-50`
- Konwencje projektowe: `AGENTS.md`, `CLAUDE.md`, `context/foundation/lessons.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Setup Paraglide + middleware + Layout + Topbar switcher

#### Automated

- [x] 1.1 Zależność `@inlang/paraglide-js` zainstalowana: `npm ls @inlang/paraglide-js` zwraca wersję — 4264cbd
- [x] 1.2 Generacja Paraglide przechodzi: `npx astro sync` produkuje `src/paraglide/messages.js`, `runtime.js`, `server.js` bez błędów — 4264cbd
- [x] 1.3 TypeScript przechodzi: `npx astro check` zielone — 4264cbd
- [x] 1.4 Lint przechodzi: `npm run lint` — 4264cbd
- [x] 1.5 Build przechodzi: `npm run build` — 4264cbd
- [x] 1.6 Strict mode działa: usunięcie klucza z `messages/en.json` powoduje failure `npm run build` (weryfikacja + revert) — 4264cbd

#### Manual

- [x] 1.7 `npm run dev`, `/` — Topbar renderuje polskie napisy, `<html lang="pl">` w źródle — 4264cbd
- [x] 1.8 Kliknięcie przełącznika na EN — Topbar po angielsku, `<html lang="en">`, cookie `PARAGLIDE_LOCALE=en` — 4264cbd
- [x] 1.9 Odświeżenie strony — wybór EN persystuje — 4264cbd
- [x] 1.10 Powrót na PL — Topbar wraca do polskiego, cookie `PARAGLIDE_LOCALE=pl` — 4264cbd
- [x] 1.11 Logowanie/wylogowanie nie resetuje wyboru języka — 4264cbd

### Phase 2: Auth surface — 9 stron auth + formularze

#### Automated

- [x] 2.1 Build przechodzi: `npm run build` — 4c5ae65
- [x] 2.2 Type check przechodzi: `npx astro check` — 4c5ae65
- [x] 2.3 Lint przechodzi: `npm run lint` — 4c5ae65
- [x] 2.4 Grep na PL diakrytyki w migrowanych plikach zwraca 0 (poza komentarzami) — 4c5ae65

#### Manual

- [x] 2.5 Wszystkie 9 stron auth renderuje się poprawnie w PL i EN — 4c5ae65
- [x] 2.6 Formularze signin/signup/reset-password/update-password działają w obu językach; walidacja client-side pokazuje właściwe komunikaty — 4c5ae65
- [x] 2.7 Dialog "Usuń konto" — wszystkie teksty w obu językach, w tym input placeholder i disabled state — 4c5ae65
- [x] 2.8 Strona `restore-account` — komunikat w obu językach; data wciąż `pl-PL` (naprawa w Fazie 4) — 4c5ae65

### Phase 3: Core features — generate, review, deck + walidacja + dialogi

#### Automated

- [x] 3.1 Build przechodzi: `npm run build`
- [x] 3.2 Type check przechodzi
- [x] 3.3 Lint przechodzi
- [x] 3.4 Grep dla PL diakrytyków w `src/components/{generate,review,deck}/` i `src/pages/{index,dashboard,generate,review,deck}.astro` zwraca 0 (poza komentarzami)

#### Manual

- [x] 3.5 Landing (`/`) w obu językach — hero + CTA właściwe
- [x] 3.6 Dashboard w obu językach
- [x] 3.7 Generate flow: wklejenie, generacja, kandydaci, edycja — wszystko w obu językach
- [x] 3.8 Review session: start, 4 przyciski, zakończenie — obie wersje
- [x] 3.9 Deck: lista, wyszukiwarka, dodanie, edycja, usunięcie z potwierdzeniem — obie wersje
- [x] 3.10 Empty states widoczne w obu językach

### Phase 4: API error codes + client mapping + regression pass

#### Automated

- [ ] 4.1 Build przechodzi: `npm run build`
- [ ] 4.2 Type check + lint przechodzą
- [ ] 4.3 Grep dla PL diakrytyków poza `messages/pl.json`: `rg "[łćśąężźń]" src/ --glob "!messages/pl.json"` zwraca 0
- [ ] 4.4 Endpointy API zwracają kody (curl weryfikacja na `/api/auth/reset-confirm`)
- [ ] 4.5 `errorCodeToMessage("UNKNOWN_CODE_XYZ")` zwraca `m.error_unknown()` output

#### Manual

- [ ] 4.6 Reset password flow end-to-end w obu językach: request → email → confirm → login
- [ ] 4.7 Delete + restore flow w obu językach; daty w formacie właściwym dla locale
- [ ] 4.8 Generate + review + deck — pełny obchód w EN, potem w PL; zero cross-language leakage
- [ ] 4.9 Przełącznik na dowolnej stronie działa bez błędów; wybór persystuje między sesjami
- [ ] 4.10 `<html lang>` w każdej podstronie zgadza się z aktywnym locale
- [ ] 4.11 `AGENTS.md` sekcja i18n czytelna, reguły łatwe do zastosowania
