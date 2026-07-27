# Panel użytkownika na /dashboard z metrykami talii — Implementation Plan

## Overview

Przekształcenie `src/pages/dashboard.astro` z minimalnego welcome-screen (email + signout button) w hub użytkownika: 3 stat cards pokazujące bieżący stan talii (total + AI/manual split, due today, miejsce na przyszłe metryki) oraz 3 CTA cards ze shortcutami do `/generate`, `/review`, `/deck`, rozłożone w responsywnym gridzie. Zapytania idą przez Supabase RLS w Astro SSR frontmatter — zero nowego API surface, zero React islands, fresh values przy każdym page load.

## Current State Analysis

- **`src/pages/dashboard.astro:1-28`** renderuje jedynie `Layout` + centrowany rounded-xl div z gradient tytułem "Panel", welcome message (`m.dashboard_welcome({ email })`), tekst "auth-only", i przycisk signout. Zero metryk, zero shortcuts.
- **Schema is ready**:
  - `supabase/migrations/20260707200908_initial_schema.sql:20-28` — `cards` ma kolumnę `source` (enum `'ai' | 'manual'`), plus `user_id`, `question`, `answer`.
  - `supabase/migrations/20260709120000_fsrs_state_and_review_log.sql:27-38` — FSRS wprowadził kolumnę `cards.due` (timestamp). To jest **jedyne** źródło "next review date" dla fiszki — `review_history` (linie 50-65) jest append-only i nie trzyma "next review".
- **RLS policies** (`supabase/migrations/20260723165737_soft_delete_and_retention.sql:111-197`) mają predykat `auth.uid() = user_id AND EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.deleted_at IS NULL)`. Count queries respektują to automatycznie — użytkownik w oknie retencji (soft-deleted profile) nie zobaczy swoich fiszek przez zwykły select. Ryzyko RLS-drift z roadmap S-09 Risk **już zamitigowane** przez migrację z S-05.
- **Query patterns** — `src/pages/api/cards.ts:34-38` używa `supabase.from('cards').select('*')`; `src/pages/api/review/next.ts:28-35` używa `.eq('user_id', user.id).lte('due', nowIso)` (jawnie mimo RLS — defensive). Supabase client dostajemy z `Astro.locals.supabase` (`src/env.d.ts`) lub `createClient` z `src/lib/supabase.ts:6-9`. **Nie istnieją** żadne count queries ani stats endpoint w kodzie.
- **shadcn Card primitives ready** — `src/components/ui/card.tsx` eksportuje `Card`, `CardHeader`, `CardTitle`, `CardContent`, `CardFooter`. Używane w `src/components/generate/ProposalCard.tsx:32`, `src/components/deck/CardListItem.tsx:39`. Style: `bg-white/5 border-white/10 rounded-xl p-4`.
- **Cosmic theme** — `src/styles/global.css:113-115` definiuje `@utility bg-cosmic`. Glass classes (`bg-white/5`, `border-white/10`, `backdrop-blur-xl`) używane wszędzie.
- **Lucide icons available** — `lucide-react` już w `package.json`, `MenuIcon` używane przez MobileNav (S-08), `Sparkles` przez GenerateForm. Można reuse dla AI-related iconography.
- **i18n gate** — `scripts/check-i18n-parity.mjs` w prebuild wymusza parytet kluczy między `pl.json` a `en.json`. Aktualnie 192 klucze w obu (po review follow-ups S-08).
- **AGENTS.md rules**: API routes muszą mieć `export const prerender = false` (nie dotyczy — nie tworzymy API); Tailwind przez `cn()` obowiązkowo; server secrets przez `astro:env/server` (nie dotyczy — używamy istniejącego Supabase client).

## Desired End State

Po zakończeniu planu:

- Zalogowany użytkownik otwierający `/dashboard` widzi 3×2 grid paneli:
  - **Stat 1**: Card z łączną liczbą fiszek + drobnym podpisem "X AI (Y%) + Z ręcznie".
  - **Stat 2**: Card z liczbą fiszek zaplanowanych do powtórki dziś (`cards.due <= now()` — obejmuje overdue + today).
  - **Stat 3**: Placeholder-panel na przyszłe metryki (albo drugi widok tej samej informacji, albo pusty grid slot na desktop — patrz layout decision poniżej). W MVP: wysokość placeholder-Card z tekstem "Więcej metryk wkrótce" pełni funkcję symetrii gridu.
  - **CTA 1**: Card-link "Generuj fiszki" → `/generate` (Sparkles icon).
  - **CTA 2**: Card-link "Powtórka" → `/review` (Clock/Brain icon).
  - **CTA 3**: Card-link "Talia" → `/deck` (Library icon).
- Empty state (`total === 0`): panele z zerami się wciąż renderują; CTA 1 (`/generate`) ma wyraźny wizualny akcent (dodatkowy `ring-2 ring-purple-400/50 shadow-lg`), sygnalizując "start tutaj".
- Na `<md` breakpoint: grid zwija się do jednej kolumny (`grid-cols-1 md:grid-cols-2 lg:grid-cols-3`).
- Wszystkie widoczne stringi w `messages/{pl,en}.json` z parytetem. `npm run prebuild` przechodzi.
- Global Topbar (S-08) dalej renderuje się nad zawartością; active-state podświetla "Panel" (aria-current="page" nadal działa).
- Signout button przenosi się z centrum widoku do — nie renderujemy go w /dashboard **w ogóle** (już jest w Topbar S-08). Redukujemy duplikację.
- `npm run lint`, `npm run build` przechodzą. Manualny sweep pusta/pełna talia × PL/EN × mobile/desktop bez regresji.

### Key Discoveries:

- `cards.source` enum + `cards.due` timestamp = wszystko potrzebne do 3 count queries; brak zmian schematu.
- RLS `EXISTS (profiles ... deleted_at IS NULL)` predicate = soft-delete filter automatyczny; roadmap Risk już zamitigowany.
- SSR-direct query pattern jest natywny dla Astro w `output: "server"` mode (astro.config.mjs); zero React island potrzebne dla samego renderu.
- shadcn Card + Cosmic glass classes = spójny wygląd out of the box; matches Welcome.astro feature grid style.
- Signout w Topbar (S-08) duplikuje dashboard.astro signout button — Faza 2 usuwa duplikat.

## What We're NOT Doing

- **Nie dodajemy nowego API endpointu** `/api/stats/*`. Query w frontmatter `dashboard.astro`. Refactor do API dopiero gdy inne strony potrzebują tych stat (YAGNI).
- **Nie dodajemy metryk z `review_history`** (total reviews done, streaks, per-day averages). Roadmap explicite mówi 3 core metryki; historical/time-series to PRD v2 Non-Goal.
- **Nie dodajemy React island** (client-side JS, useState, useEffect). Dashboard jest statyczny; freshness = page load. Zero client-side revalidation, zero polling.
- **Nie dotykamy schematu bazy**. Zero migracji, zero indeksów. Count queries na `medium` scale są < 10ms na Supabase — premature optimization out of scope.
- **Nie dodajemy manual refresh button** (roadmap sensowny default zdecydował: freshness via SSR).
- **Nie dodajemy wykresów, streaks, gamification** — PRD v2 §Non-Goals ("Gamification and historical analytics").
- **Nie zmieniamy Topbar (S-08)** — active-state dla `/dashboard` już działa (weryfikowane manualnie w Fazie 3).

## Implementation Approach

Trzy fazy z manual gate po każdej:

1. **Query layer** — extract `getDeckStats(supabase, userId)` helper w `src/lib/services/deck-stats.ts`. Trzy count queries. Type-safe return `{ total: number; ai: number; manual: number; dueToday: number }`. Unit-testowalne w izolacji przez mock Supabase, ale w MVP scope brak unit test infra (per prior slices) — verification via integration in Faza 2.
2. **UI + i18n** — nowe klucze w obu message files. Full rewrite `dashboard.astro` frontmatter: call `getDeckStats`, wykryj empty state, renderuj 3×2 Card grid statycznie. Dodaj Lucide icons. Zero React islands.
3. **QA sweep + gates** — manualny checklist pusta/pełna talia × PL/EN × mobile/desktop; automat: lint / prebuild (parity) / build. Signout regression check (musi dalej działać przez Topbar).

Kolejność: 1→2 bo Faza 2 konsumuje Fazę 1. Fazy 1 i 2 mogłyby być jednym commitem, ale rozdzielenie daje manual gate na wynik query przed integracją w widok — jeśli count queries returnują 0 dla wszystkich (bug w RLS), złapiemy to zanim renderujemy panele.

## Phase 1: Query layer — getDeckStats service

### Overview

Wyodrębnij helper `getDeckStats(supabase)` w `src/lib/services/deck-stats.ts`. Trzy count queries przez Supabase client (RLS auto-filtruje). Zwraca `{ total, ai, manual, dueToday }`. Weryfikacja: manualna call w REPL-like scenario (uruchomić `dashboard.astro` z tymczasowym `console.log(getDeckStats(...))` żeby zobaczyć wartości).

### Changes Required:

#### 1. Nowy service module

**File**: `src/lib/services/deck-stats.ts` (nowy)

**Intent**: Eksportuj async function `getDeckStats` która przyjmuje typowany `SupabaseClient<Database>` i zwraca current-state deck counts. RLS zajmie się filtrowaniem user-owned rows przez `auth.uid()` (Supabase client automatycznie dostaje session cookies przez middleware).

**Contract**:
- Signature: `export async function getDeckStats(supabase: SupabaseClient<Database>): Promise<DeckStats>` gdzie `DeckStats = { total: number; ai: number; manual: number; dueToday: number }`.
- Trzy równoległe count queries via `Promise.all`:
  - `supabase.from('cards').select('*', { count: 'exact', head: true })` → total
  - `.eq('source', 'ai').select('*', { count: 'exact', head: true })` → ai
  - `.lte('due', new Date().toISOString()).select('*', { count: 'exact', head: true })` → dueToday
  - `manual` = `total - ai` (derived, brak osobnego query — spójne z enum który ma tylko 2 wartości i FR-008 mówi "manual" i FR-005 "ai").
- Error handling: jeśli któraś query zwraca error z Supabase → rzuć wyjątek z prefiksem `[deck-stats]` (Astro frontmatter potem catchuje w try/catch — patrz Faza 2).
- Type `DeckStats` deklarowany lokalnie w tym samym pliku (jednorazowe użycie, nie do `src/types.ts`).

Uwaga na klasę: `Promise.all` OK, ale kolejność nie ma znaczenia — count queries niezależne. Nie używaj `Promise.allSettled` bo jeden error powinien failować cały load (nie chcemy pokazać "12 fiszek AI, ??? do powtórki").

### Success Criteria:

#### Automated Verification:

- `npm run lint` — 0 errors, 0 nowych warningów
- `npx astro check` — brak nowych błędów TS (tylko 2 pre-existing z `rate.ts`)
- `npm run build` — build przechodzi

#### Manual Verification:

- Nie da się w izolacji (brak unit test infra); weryfikacja przechodzi w Fazie 2 przez faktyczne renderowanie na `/dashboard`.

**Implementation Note**: Faza 1 to setup — brak visible impact. Manual verification "N/A" bo helper nie jest jeszcze wywoływany. Możemy pause albo od razu przejść do Fazy 2; sugeruję pause tylko na commit + gate, żeby diff był atomiczny.

---

## Phase 2: i18n keys + dashboard.astro rewrite

### Overview

Dodaj i18n keys w obu locale'ach. Full rewrite `dashboard.astro`: frontmatter wywołuje `getDeckStats`, renderuje 3×2 grid z 3 stat cards (Card primitives) + 3 CTA cards (Card jako link). Empty state accentuje CTA 1 (`/generate`). Signout button usunięty (jest w Topbar).

### Changes Required:

#### 1. Nowe klucze i18n (PL + EN)

**File**: `messages/pl.json`

**Intent**: Dodaj 10 nowych kluczy w bloku "dashboard_*" (istnieją już `dashboard_title`, `dashboard_welcome`, `dashboard_auth_only`, `dashboard_signout` — kilka usuniemy w Fazie 2 jeśli nieużywane).

**Contract**: Nowe klucze i sugerowane wartości:
- `dashboard_stat_total_label`: "Fiszki w talii"
- `dashboard_stat_total_split`: "{ai} AI ({percent}%) · {manual} ręcznie" — placeholder-based
- `dashboard_stat_due_today_label`: "Do powtórki dziś"
- `dashboard_stat_due_today_hint`: "kliknij, aby zacząć"
- `dashboard_stat_placeholder_label`: "Więcej metryk wkrótce"
- `dashboard_cta_generate`: "Wygeneruj fiszki AI"
- `dashboard_cta_review`: "Rozpocznij powtórkę"
- `dashboard_cta_deck`: "Zobacz talię"
- `dashboard_empty_headline`: "Zacznij od wygenerowania pierwszych fiszek"
- `dashboard_empty_body`: "Wklej fragment tekstu i pozwól AI zaproponować pary pytanie–odpowiedź."

Klucze do usunięcia (nieużywane po rewrite): `dashboard_welcome`, `dashboard_auth_only`, `dashboard_signout` (signout żyje w Topbar). Zachowaj `dashboard_title` (używany przez `Layout title=...`).

**File**: `messages/en.json`

**Intent**: Analogiczne tłumaczenia dla parytetu.

**Contract**: Wartości:
- `dashboard_stat_total_label`: "Cards in your deck"
- `dashboard_stat_total_split`: "{ai} AI ({percent}%) · {manual} manual"
- `dashboard_stat_due_today_label`: "Due for review today"
- `dashboard_stat_due_today_hint`: "click to start"
- `dashboard_stat_placeholder_label`: "More metrics coming soon"
- `dashboard_cta_generate`: "Generate AI flashcards"
- `dashboard_cta_review`: "Start review"
- `dashboard_cta_deck`: "View deck"
- `dashboard_empty_headline`: "Start by generating your first flashcards"
- `dashboard_empty_body`: "Paste a fragment of text and let AI suggest question–answer pairs."

Parytet: liczba kluczy identyczna w obu plikach. `npm run prebuild` zweryfikuje.

#### 2. Rewrite dashboard.astro

**File**: `src/pages/dashboard.astro`

**Intent**: Full rewrite. Frontmatter: pobierz Supabase client z `Astro.locals`, wywołaj `getDeckStats`, wykryj `isEmpty = stats.total === 0`. Body: 3×2 grid (responsywny) z 6 Cards. Zero React islands. Dashboard-title już przekazuje przez Layout.

**Contract**:
- Frontmatter: `import Layout`, `import { getDeckStats } from '@/lib/services/deck-stats'`, `import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'` (Astro może importować React components — one renderują SSR jako HTML gdy używane w `.astro` bez `client:*`), `import { Sparkles, Clock, Library, TrendingUp } from 'lucide-react'` (Lucide icons Astro-friendly bo są server-renderable).
- Query call z try/catch: jeśli `getDeckStats` rzuca, renderuj empty state fallback z etykietą błędu (nie białą stronę). Log przez `console.error` (per AGENTS.md — projekt toleruje `no-console` warnings w API, ale nie w `.astro`; użyj z rozwagą).
- Layout wrapper: `<Layout title={m.dashboard_title()}>` — Layout automatycznie renderuje Topbar (S-08) z active-state na `/dashboard`.
- Grid container: `<div class="bg-cosmic min-h-screen p-4 sm:p-8">` (matches Welcome.astro pattern, ale bez `p-4 sm:p-8` bo Layout dodaje wrapper).
- Grid: `<div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 max-w-6xl mx-auto">` — pozwala 1 col mobile, 2 tablet, 3 desktop. Rows 1-2 = stat cards; rows 3-6 = CTA cards. Alternatywnie 2 osobne grids z separatorem — but zostawiamy jeden dla prostoty.
- Card 1 (total + split): `Card`, `CardHeader` z ikoną (`Library`), `CardTitle` = `m.dashboard_stat_total_label()`, `CardContent` z dużą liczbą (`stats.total`) i podpisem `m.dashboard_stat_total_split({ ai, percent, manual })`. Procent: `Math.round((ai / total) * 100)` gdy `total > 0` else 0.
- Card 2 (due today): analogiczne z `Clock` ikoną. Główna liczba: `stats.dueToday`. Jeśli `> 0`, cała karta jest linkiem (`<a href="/review">`); jeśli `== 0`, disabled-ish styl (opacity-60, brak href).
- Card 3 (placeholder): `TrendingUp` ikoną, label "Więcej metryk wkrótce". Statyczny; brak liczby. Trzymamy dla symmetry gridu.
- Card 4 (CTA generate): `<a href="/generate">` opakowany w `Card`. `Sparkles` icon. Label z i18n. Jeśli `isEmpty === true`, dodatkowe klasy: `ring-2 ring-purple-400/50 shadow-lg shadow-purple-500/20`.
- Card 5 (CTA review): `<a href="/review">`, `Clock` icon.
- Card 6 (CTA deck): `<a href="/deck">`, `Library` icon.
- Anchor tags dostają `class:list` z shadcn Card wewnątrz, żeby całe Cardy były klikalne. Alternatywa: Card na zewnątrz + inline `<a>` — mniej klikalna powierzchnia. Wybieramy cały-Card klikalny (matches roadmap FR-017 "z shortcutami" implication).
- Empty state (`stats.total === 0`): brak zmian w Card 1-3 (renderują 0/0/placeholder), tylko Card 4 (`/generate`) dostaje accented ring. Card 2 z `dueToday === 0` naturally disabled przez brak href.
- Signout button: **usunięty** z dashboard.astro (był `<form method="POST" action="/api/auth/signout">` w oryginalnym pliku); dostępny globalnie w Topbar (S-08).
- `dashboard_welcome`, `dashboard_auth_only`, `dashboard_signout` klucze: usunięte z obu locale plików w tej samej edycji (parytet zachowany).

Nie używamy `client:*` na żadnym komponencie. Cały widok = SSR HTML.

### Success Criteria:

#### Automated Verification:

- `npm run lint` — 0 errors, 0 nowych warningów
- `npm run prebuild` — parity OK (liczba kluczy: 192 − 3 usunięte + 10 nowych = 199)
- `npm run build` — build przechodzi, Cloudflare Worker bundle się produkuje
- `npx astro check` — brak nowych błędów TS

#### Manual Verification:

- `npm run dev` → login → `/dashboard` renderuje 6 Cards w 3×2 gridzie na desktopie
- Card 1 pokazuje łączną liczbę + split "X AI (Y%) · Z ręcznie"
- Card 2 pokazuje liczbę `dueToday`; jeśli > 0, klik prowadzi do `/review`
- Card 3 pokazuje placeholder "Więcej metryk wkrótce"
- Card 4-6 (CTAs) prowadzą do `/generate`, `/review`, `/deck`
- Empty state (nowo zarejestrowany user z pustą talią): Card 4 (`/generate`) ma widoczny akcent (ring/glow)
- Mobile (< md): grid zwija się do jednej kolumny; wszystkie 6 Cards nadal klikalne
- Topbar (S-08) renderuje się na górze; "Panel" jest active-highlighted; sign-out w Topbar działa
- PL i EN: wszystkie stringi przetłumaczone; brak fallbackowej angielszczyzny w PL i odwrotnie

**Implementation Note**: Po Fazie 2 dashboard jest funkcjonalnie kompletny. Pauza na potwierdzenie manual QA przed przejściem do Fazy 3 (QA sweep). Jeśli count queries returnują dziwne liczby (np. RLS drift), łapiemy tutaj.

---

## Phase 3: QA sweep + i18n parity gate + regression check

### Overview

Pełny manualny sweep 4 stanów × 2 języki × 2 breakpointy = 16 kombinacji + regression check na Topbar (S-08) + delete-account flow (S-05) + sign-out (should still work through Topbar). Automat: lint / prebuild / build. Rezultat: gotowość do PR.

### Changes Required:

#### 1. QA checklist (procedura, nie plik)

**File**: `context/changes/dashboard-user-panel-metrics/qa-checklist.md` (opcjonalny artefakt — może żyć w PR desc zamiast pliku)

**Intent**: Spisz procedurę manualnej weryfikacji. Nie generuj kodu.

**Contract**: 16 kombinacji w tabeli lub checklist:
- 4 stany deck: (a) empty (talia=0, dueToday=0), (b) all-AI (talia>0, ai=talia, manual=0), (c) all-manual (odwrotnie), (d) mixed (talia>0, ai>0, manual>0, dueToday>0).
- Dla każdego stanu, 2 języki × 2 breakpointy = 4 kombinacje.
- Weryfikacja: (i) Card 1 pokazuje właściwe liczby + procent; (ii) Card 2 disabled/link zgodnie z dueToday; (iii) Card 4-6 klikalne i prowadzą do właściwych route'ów; (iv) empty state accent aktywny wtedy i tylko wtedy gdy total === 0; (v) zero string leakage.

#### 2. Regression checks

**File**: — (manualne, nie edit)

**Intent**: Zweryfikuj że S-08 (Topbar active-state, sign-out w Topbar) i S-05 (delete account flow) dalej działają — te trzy interagują na `/dashboard`.

**Contract**:
- Topbar renderuje się na `/dashboard`; "Panel" ma `aria-current="page"` i wizualne podświetlenie (per S-08 review follow-up F3, 6ed30e1).
- Sign-out w Topbar → redirect do `/`; sesja niedostępna.
- Delete account flow (S-05): jeśli user jest w oknie retencji (soft-deleted profile), `/dashboard` powinien redirectować lub blokować (per middleware `PROTECTED_ROUTES` + soft-delete check). Weryfikuj że dashboard **nie** renderuje 0/0/0 dla soft-deleted usera — RLS zwrócić powinien puste count queries, ale middleware powinien wcześniej redirectować do `/auth/restore-account` (per S-05 change). Test: soft-delete konto, próbuj `/dashboard` → oczekuj redirect.

#### 3. Automated gates

**File**: — (komendy)

**Intent**: Run `npm run lint && npm run prebuild && npm run build` przed pushem.

**Contract**: Zero errorów; zero nowych warningów (baseline z master); i18n parity OK (dokładna liczba zależy od Fazy 2: 192 − 3 + 10 = 199 keys).

### Success Criteria:

#### Automated Verification:

- `npm run lint` — 0 errors, 0 nowych warningów (baseline z master to 24 pre-existing `no-console` w API endpointach)
- `npm run prebuild` — parity confirmed (199 keys)
- `npm run build` — build produkuje Cloudflare Worker bundle
- `npx astro check` — brak nowych TS errorów

#### Manual Verification:

- 16 pozycji QA checklist zaznaczone
- Zero string leakage w obu językach
- Regression: Topbar active-state działa; sign-out działa; delete-account flow nie regresowany (redirect do /auth/restore-account dla soft-deleted usera)
- Wygląd wizualny spójny z resztą aplikacji (cosmic theme, glass cards)

**Implementation Note**: Ostatni gate. Po zamknięciu — slice gotowy do PR + merge + `/10x-archive dashboard-user-panel-metrics`.

---

## Testing Strategy

### Unit Tests:

- Brak. Projekt nie ma unit test infra (per S-08 i wcześniejsze slices).

### Integration Tests:

- Brak. Manual QA na 16 kombinacjach jest wystarczający dla zakresu (UI + count queries; brak logiki biznesowej beyond RLS).

### Manual Testing Steps:

1. `npm run dev` na `localhost:4321`.
2. Zaloguj się jako user z **pustą talią** (nowo utworzony przez `/auth/signup`).
3. Otwórz `/dashboard` (PL) — sprawdź: Card 1 = 0 total, Card 2 = 0 do powtórki (disabled), Card 3 = placeholder, Card 4 (`/generate`) accentuated (ring/glow), Card 5-6 clickable.
4. Przełącz na EN, powtórz p. 3.
5. Zmniejsz do mobile (< 768px), powtórz p. 3-4 w obu językach.
6. Wygeneruj kilka fiszek AI przez `/generate` (2-3 fiszki, zaakceptuj wszystkie).
7. Wróć do `/dashboard` (PL) — sprawdź: Card 1 pokazuje total>0 i split "X AI (100%) · 0 ręcznie", Card 4 już bez accent (bo total>0), reszta bez zmian.
8. Ręcznie dodaj fiszkę na `/deck` (Add card button).
9. Wróć do `/dashboard` — sprawdź split "X AI (Y%) · 1 ręcznie".
10. Poczekaj lub przesuń `cards.due` na przeszłość (przez Supabase SQL editor) żeby fiszki weszły w due-today.
11. Odśwież `/dashboard` — Card 2 pokazuje liczbę > 0 i jest teraz linkiem do `/review`.
12. Klik Card 2 → prowadzi do `/review`.
13. Sign-out z Topbar → redirect do `/`.
14. Zaloguj ponownie → `/dashboard` renderuje się z zapisanym stanem.
15. (Regression S-05) Uruchom flow "Usuń konto" na `/account`; próbuj `/dashboard` → sprawdź że middleware redirectuje na `/auth/restore-account` zamiast pokazać dashboard z pustymi liczbami.

## Performance Considerations

- 3 count queries per page load. Supabase count queries z `{ count: 'exact', head: true }` są O(index-scan) na `cards(user_id)` (main index). Na skalę `target_scale.users: medium` (PRD frontmatter) — < 10ms per query, mniej niż 30ms sumarycznie równolegle. Dodanie 3 queries do Astro SSR to +30ms na p95 dashboard load; akceptowalne bez cache.
- Cache: nie wprowadzamy. Cloudflare Worker już edge-terminuje SSR blisko usera; cache byłby premature.
- Wywołanie `getDeckStats` przez `Promise.all` = queries równoległe, nie sekwencyjne.
- Bundle size: brak nowych React islands, brak nowych client-side dependencies. Wpływ na Cloudflare Worker bundle = szacunkowo +2KB (Lucide icons już w bundle z Topbar/MobileNav; shadcn Card już używane).

## Migration Notes

- **Brak migracji DB.** Schema, RLS bez zmian.
- **i18n changes:**
  - Usunięte: `dashboard_welcome`, `dashboard_auth_only`, `dashboard_signout` (parytet zachowany bo usuwamy w obu plikach synchronicznie).
  - Dodane: 10 nowych `dashboard_stat_*` i `dashboard_cta_*` w obu plikach.
- **Rollback:** revert commit z: `deck-stats.ts`, `dashboard.astro`, `messages/{pl,en}.json`. Nic w persistent state.
- **Feature flag:** nie potrzebny. Dashboard = statyczny widok, mały slice, rollback trywialny.

## References

- Roadmap slice: `context/foundation/roadmap.md` § `S-09: Panel użytkownika na /dashboard z metrykami talii`
- PRD refs: `context/foundation/prd.md` § `US-03`, `FR-016`, `FR-017` (v2, dodane w commit f069d88)
- Existing query patterns: `src/pages/api/cards.ts:34-38`, `src/pages/api/review/next.ts:28-35`
- Supabase client: `src/lib/supabase.ts:6-9`, wystawiony na `Astro.locals.supabase` przez middleware
- shadcn Card: `src/components/ui/card.tsx`; przykład użycia: `src/components/generate/ProposalCard.tsx:32`
- Cosmic theme: `src/styles/global.css:113-115`
- Migration schema: `supabase/migrations/20260707200908_initial_schema.sql:20-28` (cards + source), `20260709120000_fsrs_state_and_review_log.sql:27-38` (cards.due)
- RLS soft-delete gate: `supabase/migrations/20260723165737_soft_delete_and_retention.sql:111-197`
- Topbar (S-08): `src/components/Topbar.astro`; active-state via `pathname`
- i18n parity gate: `scripts/check-i18n-parity.mjs`, `AGENTS.md § Internationalization`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Query layer — getDeckStats service

#### Automated

- [x] 1.1 `npm run lint` — 0 errors, 0 nowych warningów
- [x] 1.2 `npx astro check` — brak nowych błędów TS
- [x] 1.3 `npm run build` — build przechodzi

#### Manual

- [x] 1.4 Weryfikacja odłożona do Fazy 2 (helper nie jest jeszcze wywoływany)

### Phase 2: i18n keys + dashboard.astro rewrite

#### Automated

- [ ] 2.1 `npm run lint` — 0 errors, 0 nowych warningów
- [ ] 2.2 `npm run prebuild` — parity OK (~199 keys)
- [ ] 2.3 `npm run build` — build przechodzi
- [ ] 2.4 `npx astro check` — brak nowych błędów TS

#### Manual

- [ ] 2.5 Empty user (talia=0): 6 Cards renderują się w 3×2 gridzie desktop; Card 4 (`/generate`) accentuated (ring/glow)
- [ ] 2.6 Mixed deck (>0 AI, >0 manual): Card 1 pokazuje total + split z procentem; Card 4 bez accent
- [ ] 2.7 Due-today > 0: Card 2 klikalny jako link do `/review`
- [ ] 2.8 Due-today == 0: Card 2 disabled (opacity-60, brak href)
- [ ] 2.9 Mobile (< 768px): grid zwija się do 1 kolumny; wszystkie 6 Cards klikalne
- [ ] 2.10 PL + EN: wszystkie stringi z i18n, brak leakage

### Phase 3: QA sweep + i18n parity gate + regression check

#### Automated

- [ ] 3.1 `npm run lint` — zero errorów, zero nowych warningów (baseline z master)
- [ ] 3.2 `npm run prebuild` — parity confirmed
- [ ] 3.3 `npm run build` — Cloudflare Worker bundle się produkuje
- [ ] 3.4 `npx astro check` — brak nowych TS errorów

#### Manual

- [ ] 3.5 16 pozycji QA checklist (4 stany × 2 języki × 2 breakpointy) zaznaczone
- [ ] 3.6 Zero string leakage
- [ ] 3.7 Regression: Topbar (S-08) active-state na `/dashboard` działa; aria-current="page" ustawione
- [ ] 3.8 Regression: sign-out z Topbar prowadzi do `/`; sesja niedostępna
- [ ] 3.9 Regression: soft-deleted user (S-05) próbujący `/dashboard` jest redirectowany do `/auth/restore-account` (middleware, nie dashboard renderuje 0/0)
- [ ] 3.10 Wygląd wizualny spójny z Cosmic theme + istniejącymi Cards (ProposalCard, CardListItem)
