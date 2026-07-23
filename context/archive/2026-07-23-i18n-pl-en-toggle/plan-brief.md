# Internacjonalizacja UI (PL/EN, domyślnie polski) — Plan Brief

> Full plan: `context/changes/i18n-pl-en-toggle/plan.md`
> Roadmap slice: `context/foundation/roadmap.md` — S-07

## What & Why

Wprowadzamy tłumaczenia UI (PL/EN) z widocznym przełącznikiem języka w Topbarze; domyślnym językiem pozostaje polski. Cel: rozszerzyć zasięg produktu poza polskojęzycznych użytkowników bez rozbijania obecnego UX i bez migracji schemy. Dodatkowo naprawiamy istniejący bug — `<html lang="en">` przy polskiej treści — który jest widoczny dla screen readerów i indeksów wyszukiwarek.

## Starting Point

Aplikacja jest de facto polska (~85 hardcoded PL stringów w ~21 plikach), ale `Layout.astro:14` hardcoduje `<html lang="en">`. Zero infrastruktury i18n: brak biblioteki, brak kolumny `locale`, brak cookie językowego. SSR (`output: "server"`) plus istniejący `src/middleware.ts` dają czysty punkt zaczepienia dla resolvera locale.

## Desired End State

Cały widoczny UI (nawigacja, formularze, walidacja, dialogi, empty states, komunikaty błędów API mapowane w kliencie, wszystkie strony auth/review/deck/account) renderuje się w PL lub EN zgodnie z wyborem użytkownika. Przełącznik żyje globalnie w Topbarze, wybór persystuje w cookie `PARAGLIDE_LOCALE` (1 rok), `<html lang>` odpowiada aktywnemu locale, treść fiszek generowanych przez AI pozostaje w języku wklejonego tekstu. Build CI wywala się przy jakimkolwiek brakującym kluczu w drugim języku.

## Key Decisions Made

| Decyzja                          | Wybór                                    | Dlaczego (1 zdanie)                                                              | Źródło |
| -------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------- | ------ |
| Biblioteka i18n                  | Paraglide (`@inlang/paraglide-js` v2.x)  | Type-safe, tree-shakable, natywne wsparcie Astro + React + Cloudflare edge.       | Plan   |
| Routing URL                      | Cookie-only, bez prefiksów `/pl`, `/en`  | Zero URL churn, żadnych rewrite'ów linków wewnętrznych, jeden PR mniejszy.        | Plan   |
| Storage preferencji              | Cookie (1 rok, `SameSite=Lax`)           | Zero migracji, zero RLS, działa też dla gości; brak cross-device syncu akceptowalny. | Plan   |
| Język treści fiszek AI           | W języku wklejonego tekstu (bez zmian)   | Match user intent — uczący się chce fiszki w języku materiału, UI to niezależny chrome. | Plan   |
| Umiejscowienie przełącznika      | Topbar, globalnie                        | Odkrywalny, dostępny dla gości i zalogowanych, standardowa lokalizacja.           | Plan   |
| Komunikaty błędów API            | Kody błędów w response, mapowanie w kliencie | Jedna prawda o tłumaczeniach (w `messages/*.json`), API stateless wobec locale. | Plan   |
| Zakres wdrożenia                 | Wszystko w jednym change'u (4 fazy)      | Brak okna string-leakage; jeden merge, jeden review.                              | Plan   |
| Zachowanie przy brakującym kluczu | Build fail (strict mode inlang)          | Zero leakage w produkcji — CI wychwyci błąd zanim zobaczy go użytkownik.          | Plan   |

## Scope

**In scope:**
- Setup Paraglide + konfiguracja Astro + middleware wrapper
- Dynamiczny `<html lang>` w Layoucie
- Przełącznik PL/EN w Topbarze (React island, `client:load`)
- Ekstrakcja wszystkich ~85 widocznych PL stringów do `messages/pl.json` + `messages/en.json`
- Refactor 4 endpointów API na kody błędów + mapowanie kod → tłumaczenie w kliencie
- Locale-aware formatowanie dat (podmiana hardcoded `"pl-PL"` na `getLocale()`)
- Krótka sekcja "Internationalization" w `AGENTS.md`

**Out of scope:**
- Prefixed URL routing (`/pl/...`, `/en/...`)
- Kolumna `locale` w tabeli `profiles` (cross-device sync)
- Tłumaczenie treści fiszek generowanych przez AI
- Tłumaczenie template'ów emaili Supabase Auth (zarządzane po ich stronie)
- Auto-detekcja z `Accept-Language`
- Playwright / E2E setup dla obu języków (regresja przez manualne QA + strict build)

## Architecture / Approach

Paraglide instaluje się jako Vite plugin (`paraglideVitePlugin`) w `astro.config.mjs` i generuje kompilowany moduł `src/paraglide/` (gitignored). Wiadomości żyją w `messages/pl.json` + `messages/en.json` (per-locale files, płaskie klucze konwencji `<obszar>_<akcja>`). Runtime działa przez `paraglideMiddleware` wpięty jako zewnętrzna warstwa istniejącego `src/middleware.ts` — ustawia async-local locale, z którego korzystają wszystkie downstream `m.foo()` w Astro layoutach, stronach `.astro` i React wysepkach. Strategia locali: `["cookie", "globalVariable", "baseLocale"]`. Przełącznik to prosta wysepka React wywołująca `setLocale()` z Paraglide runtime — zapisuje cookie i przeładowuje stronę. Endpointy API zwracają kody UPPER_SNAKE (np. `PASSWORD_TOO_WEAK`); jedno mapowanie kod → wywołanie `m.error_*()` w `src/lib/error-messages.ts` obsługuje cały klient.

## Phases at a Glance

| Faza                                                | Co dostarcza                                                                                     | Główne ryzyko                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| 1. Setup + Layout + Topbar switcher                 | Działający end-to-end mechanizm i18n z przełącznikiem i dynamicznym `<html lang>`.               | Middleware wrap w złej kolejności ⇒ locale nieaktywny podczas SSR.       |
| 2. Auth surface (9 stron + formularze + delete)     | ~40% masy stringów wyekstrahowane; auth flow działa w obu językach.                              | Przeoczony string w rzadko odwiedzanej stronie (np. `restore-account`). |
| 3. Core features (generate, review, deck + landing) | Główne user paths tłumaczone; landing i dashboard obsłużone.                                     | Walidacja formularzy z inline literałami umyka strict-mode check'owi.    |
| 4. API errors + regression pass + AGENTS.md         | API na kodach, mapowanie w kliencie, daty locale-aware, dokumentacja konwencji, zero leakage.    | Nieznany kod błędu z Supabase Auth ⇒ pokazuje `m.error_unknown()`.       |

**Prerequisites:** F-01 (schemat + RLS) — spełniony. Brak nowych migracji, brak nowych zmiennych środowiskowych, brak zewnętrznych zależności poza pakietem npm.

**Estimated effort:** 4 fazy w jednym change'u; realistycznie 2–3 sesje `/10x-implement` (Faza 1 osobno; Fazy 2+3 razem lub osobno; Faza 4 osobno z krótkim regression sweepem).

## Open Risks & Assumptions

- **Paraglide 2.x runtime na Cloudflare Workers** — dokumentacja pokazuje że działa na edge, ale nie widziałam publicznego, produkcyjnego deploymentu w exactly tym stacku. Ryzyko: jakiś async-local storage nie działa jak oczekiwane w Workers runtime. Mitigacja: Faza 1 kończy się deployem na preview i weryfikacją że locale się przełącza w warunkach produkcyjnych, nie tylko lokalnie.
- **Klucze inline w walidacji formularzy** — react-hook-form (lub cokolwiek jest używane) czasem trzyma komunikaty w schemacie z-oda. Migracja tych stringów wymaga uważności, żeby strict-mode je złapał (funkcje wywołane runtime'owo mogą być pominięte przez dead-code analysis).
- **Nieznane kody błędów z Supabase Auth SDK** — jeśli SDK zwraca kod nieujęty w naszym mapowaniu, użytkownik dostanie generyczny `m.error_unknown()`. Ryzyko UX niskie, ale warto po każdym flow sprawdzić dev tools.
- **Assumption**: nie potrzebujemy pluralization ani interpolation w większym stopniu niż `{name}` — jeśli okaże się że gdzieś potrzebujemy `n items` (1 item / 2 items), Paraglide to wspiera, ale trzeba dodać reguły; obecny audyt nie znalazł takich przypadków.

## Success Criteria (Summary)

- Użytkownik może przełączyć język w Topbar i cała widoczna aplikacja renderuje się w wybranym języku.
- Wybór języka persystuje między sesjami i dla zalogowanych, i dla gości.
- `<html lang>` na każdej podstronie odpowiada aktywnemu locale (żadnego więcej mismatch'u PL treść / EN tag).
- Build CI wywala się jeśli klucz istnieje w jednym języku a nie w drugim — zero string leakage w produkcji.
