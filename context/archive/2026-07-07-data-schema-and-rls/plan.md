# Schemat danych + RLS + typy Database Implementation Plan

## Overview

F-01 dostarcza pierwszą warstwę danych 10xCards: tabele `cards` i `review_history` w Supabase Postgres z RLS per-user, indexy pod query patterns S-02/S-03, wygenerowane typy `Database`, retypowany klient Supabase, oraz automated pgTAP test izolacji cross-user. Umożliwia S-01/S-02/S-03/S-04 — wszystkie one zależą od tej warstwy.

## Current State Analysis

- Klient Supabase istnieje: `src/lib/supabase.ts:9` używa `@supabase/ssr` `createServerClient` **bez generyka** — każde zapytanie jest dziś nietypowane.
- Auth middleware (`src/middleware.ts:11-13`) ustawia `context.locals.user` z JWT wyciągniętego z cookie — RLS zaufa temu JWT automatycznie po włączeniu policies.
- `supabase/config.toml` istnieje (project_id `10x-astro-starter`), CLI (`supabase` v2.109) jest w devDependencies.
- **BRAK**: `supabase/migrations/` (katalog nie istnieje), `src/db/` (typy niewygenerowane), tabele domenowe, RLS policies.
- `SUPABASE_URL`/`SUPABASE_KEY` w `astro.config.mjs:20-21` są `optional: true` — `createClient()` zwraca `null` gdy brak, callers null-guardą. **Nie zmieniamy** tego w F-01.
- CI (`.github/workflows/ci.yml`) uruchamia `astro sync` + `lint` + `build`, **nie odpala Supabase** — dlatego committed `database.types.ts` jest konieczne.
- Brak Vitest/Playwright w devDeps — używamy pgTAP który jest bundlowany w Supabase Postgres image.
- `lessons.md` ma jedynie regułę "kill date na feature flagach" — nie dotyczy F-01.

## Desired End State

- `supabase/migrations/<YYYYMMDDHHmmss>_initial_schema.sql` istnieje i aplikuje się czysto z `supabase db reset`.
- Tabele `public.cards` i `public.review_history` z RLS enabled i 8 policies (4 per tabela × per-operation) dla roli `authenticated`.
- `supabase/tests/rls.test.sql` uruchamiane przez `supabase test db` zwraca zielony — potwierdza że user A nie widzi wierszy user B oraz że anon nic nie widzi.
- `src/db/database.types.ts` jest wygenerowany, committed i eksportuje `Database`.
- `src/lib/supabase.ts` używa `createServerClient<Database>(...)`; API endpoints dostają typed query.
- `package.json` ma script `db:types` = `supabase gen types typescript --local > src/db/database.types.ts`.
- README ma sekcję o regeneracji typów po migracjach.
- Verify: `npm run astro sync && npm run lint && npm run build` zielone; `supabase db reset && supabase test db` zielone; manualny smoke z dwoma userami w Studio potwierdza że JWT z cookie egzekwuje RLS.

### Key Discoveries:

- `AGENTS.md` hard rule: policies per-operation, per-role, w tej samej migracji co CREATE TABLE — respektujemy w Phase 1.
- `src/lib/supabase.ts:9` — client bez generyka; retypowanie na `createServerClient<Database>(...)` jest jedynym miejscem w kodzie które zmieniamy w Phase 3.
- PRD Open Q1 (algo SR) odłożone do S-02 — `review_history` w F-01 jest algo-agnostic minimal; S-02 doda kolumny przez `ALTER TABLE` (Postgres additive migrations są tanie).
- PRD FR-011 wymaga hard delete → brak `deleted_at`.
- PRD Access Control "flat, single-tenant per user" + Non-Goals no-sharing → `ON DELETE CASCADE` na FK do `auth.users(id)`.
- Sekundarna metryka PRD "75% fiszek z AI" wymaga `cards.source ∈ {'ai','manual'}`.
- Migration naming (AGENTS.md): `YYYYMMDDHHmmss_short_description.sql`.

## What We're NOT Doing

- SM-2/FSRS/binary algo-specific kolumny w `review_history` (ease_factor, stability, interval_days, itd.) — dodane w S-02 gdy Open Q1 rozstrzygnięty.
- Soft delete (`deleted_at`) — PRD FR-011 wymaga hard delete.
- Denormalizowany `next_review_at` na `cards` — query z indeksem na `review_history(user_id, next_review_at)` wystarcza dla MVP volume.
- `source_text` (snippet z którego AI wygenerowało fiszkę) — Privacy NFR + PRD Non-Goals.
- Flip `SUPABASE_URL/KEY` z `optional` na required — scope discipline; osobna troska.
- Vitest/Playwright test runner — poza scope F-01; pgTAP wystarcza.
- Wpis do `docs/reference/contract-surfaces.md` — katalog nie istnieje w repo; osobna decyzja.
- Seed data dla dev — userzy tworzeni przez auth flow (już działa), cards przez S-01/S-03.
- Real-time subscriptions na tabelach — nie w scope MVP (PRD Non-Goals: notyfikacje).

## Implementation Approach

Trzy fazy — schemat, test, typy — każda z self-contained verification kończąca się commitowalnym stanem. Phase 1 wprowadza cały stack SQL w jednym atomowym pliku migracji (extension, tabele, FK, indexy, trigger, RLS, policies). Phase 2 dodaje automated proof izolacji (Risk mitigation z roadmapy). Phase 3 podpina typed layer nad Postgresem i doc-uje workflow regeneracji. Zachowujemy istniejący pattern nullable klienta Supabase — F-01 nie tyka env schema ani middleware.

## Critical Implementation Details

- **RLS-friendly denormalization `user_id` w review_history**: `review_history` ma zarówno `card_id` FK do `cards` jak i `user_id` FK do `auth.users`. Ta redundancja jest celowa — policy `auth.uid() = user_id` egzekwuje się bez joina przez `cards`, co planner Postgres optymalizuje lepiej i utrzymuje policy statements identyczne w obu tabelach. Bez tego join-based policy byłby wolniejszy i asymetryczny.
- **pgTAP extension bootstrap**: `create extension if not exists pgtap with schema extensions;` musi wylądować w migracji (nie w test file), inaczej `supabase test db` po `supabase db reset` nie wykryje funkcji pgTAP. Supabase image bundluje binarkę, ale extension nie jest domyślnie enabled.
- **Type-gen ordering**: `npm run db:types` musi być uruchamiany PO `supabase db reset` (lub przy podpiętym remote ze schemą). Regeneracja bez zaaplikowanej migracji produkuje stub z samymi typami `auth` — CI zbuduje się "poprawnie", ale runtime queries będą any-typed. Regen manualny → deweloper commituje typy razem z migracją.

## Phase 1: Schema migration + RLS policies + indexes

### Overview

Napisać jeden plik migracji tworzący extension pgtap, obie tabele domenowe, FK z CASCADE, indexy pod query patterns, RLS enable, 8 policies (4 per tabela) dla roli `authenticated`, oraz trigger `updated_at` na `cards`. Po tej fazie `supabase db reset` czysto stawia cały schemat od zera i policies są widoczne w Studio.

### Changes Required:

#### 1. Initial schema migration

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_initial_schema.sql`

**Intent**: Wprowadzić pierwszą migrację projektu i pełną warstwę danych F-01 w jednym atomowym pliku. `<YYYYMMDDHHmmss>` = timestamp UTC wygenerowany w chwili utworzenia pliku (konwencja z AGENTS.md).

**Contract**:

- Extension `pgtap` w schema `extensions` (via `create extension if not exists pgtap with schema extensions`).
- Enum type `public.card_source` z wartościami `'ai'`, `'manual'`.
- Table `public.cards`:
  - `id uuid primary key default gen_random_uuid()`
  - `user_id uuid not null references auth.users(id) on delete cascade`
  - `question text not null`
  - `answer text not null`
  - `source public.card_source not null default 'manual'`
  - `created_at timestamptz not null default now()`
  - `updated_at timestamptz not null default now()`
- Table `public.review_history`:
  - `id uuid primary key default gen_random_uuid()`
  - `card_id uuid not null references public.cards(id) on delete cascade`
  - `user_id uuid not null references auth.users(id) on delete cascade`
  - `reviewed_at timestamptz not null default now()`
  - `rating smallint not null`
  - `next_review_at timestamptz not null`
- Indexes:
  - `create index cards_user_created_idx on public.cards (user_id, created_at desc);`
  - `create index review_history_user_due_idx on public.review_history (user_id, next_review_at);`
  - `create index review_history_card_idx on public.review_history (card_id);`
- Function `public.trigger_set_updated_at() returns trigger` — sets `NEW.updated_at = now()`; trigger `before update on public.cards for each row execute function public.trigger_set_updated_at()`.
- `alter table public.cards enable row level security;` — analogicznie `review_history`.
- 8 policies (naming: `<table>_<op>_own`), wszystkie `to authenticated`:
  - `cards_select_own` — `for select using (auth.uid() = user_id)`
  - `cards_insert_own` — `for insert with check (auth.uid() = user_id)`
  - `cards_update_own` — `for update using (auth.uid() = user_id) with check (auth.uid() = user_id)`
  - `cards_delete_own` — `for delete using (auth.uid() = user_id)`
  - `review_history_select_own`, `review_history_insert_own`, `review_history_update_own`, `review_history_delete_own` — analogicznie
- Brak policy dla roli `anon` — default deny RLS załatwia; anonim nie może nic czytać ani pisać.

### Success Criteria:

#### Automated Verification:

- `supabase db reset` kończy się bez błędów
- `supabase db lint --level warning` nie zgłasza warningów o brakującym RLS na tabelach `public.*`
- `psql ... -c "select extname from pg_extension where extname = 'pgtap';"` zwraca jeden wiersz

#### Manual Verification:

- W Supabase Studio (localhost:54323) obie tabele widoczne w schema `public`
- W Studio → Authentication → Policies każda z 8 policies widoczna z target role `authenticated` i wyrażeniem `(auth.uid() = user_id)`
- Manualny INSERT z Studio SQL editora jako authenticated user dla obcego `user_id` odrzucony przez `with check`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: pgTAP isolation test

### Overview

Dodać test file uruchamiany przez `supabase test db` weryfikujący pełną izolację cross-user na obu tabelach oraz brak dostępu dla anon. Ten test jest bezpośrednim wykonaniem Risk mitigation z roadmapy F-01 ("test integracyjny 'user A nie widzi wierszy user B'").

### Changes Required:

#### 1. RLS isolation test suite

**File**: `supabase/tests/rls.test.sql`

**Intent**: Automated pgTAP suite symulująca dwóch userów przez `set local request.jwt.claim.sub` i asertująca że policies SELECT/INSERT/UPDATE/DELETE odcinają cross-user access na obu tabelach, oraz że anon (bez JWT) nie widzi nic.

**Contract**:

- `begin;` + `select plan(N);` (N = liczba asercji, ~14-16)
- Setup: `insert into auth.users (id, email, ...)` — dwóch userów z znanymi UUID'ami (np. `'11111111-1111-1111-1111-111111111111'` i `'22222222-...'`). Po `supabase db reset` seed jest wyczyszczony, więc test może swobodnie insertować.
- `set local role authenticated;` + `set local request.jwt.claim.sub = '<A>';` przed grupą asercji user A.
- Insert 1 wiersz w `cards` i 1 w `review_history` per user (przez odpowiedni JWT).
- Asercje (używamy `pgtap.results_eq`, `pgtap.throws_ok`, `pgtap.is`):
  - As user A: `select count(*) from public.cards` = 1
  - As user A: `select count(*) from public.cards where user_id = '<B>'` = 0
  - As user A: `insert into public.cards (user_id, question, answer) values ('<B>', ...)` — `throws_ok` (row-level security)
  - As user A: `update public.cards set question = 'x' where user_id = '<B>'` zwraca 0 rows affected
  - As user A: `delete from public.cards where user_id = '<B>'` zwraca 0 rows affected
  - Identyczna piątka dla `review_history`
  - As anon (`set local role anon; reset request.jwt.claim.sub`): `select count(*) from public.cards` = 0
  - As anon: `select count(*) from public.review_history` = 0
- `select * from finish();` + `rollback;`

### Success Criteria:

#### Automated Verification:

- `supabase test db` zwraca exit 0
- Output raportuje `ok N` dla wszystkich asercji (N/N)
- Fail w jakiejkolwiek policy manifestuje się jako `not ok` z linią z testu

#### Manual Verification:

- Test file czyta się jako runbook — implementer S-01/S-02 może dodać kolejne asercje w tym samym stylu bez otwierania pgTAP docs

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Database types + typed client integration

### Overview

Dodać npm script `db:types` do regeneracji typów, wygenerować `src/db/database.types.ts`, retypowac `createServerClient<Database>(...)` w istniejącym kliencie, i doc-ować workflow w README. Po tej fazie każdy nowy API endpoint (S-01/S-03) startuje z pełnym typingiem `supabase.from('cards').select()`.

### Changes Required:

#### 1. npm script for type generation

**File**: `package.json`

**Intent**: Jedna komenda do regeneracji typów po każdej migracji. Wywołuje lokalną instancję Supabase (`--local`) i outputuje do committed file.

**Contract**: Dodać w `scripts`:

```json
"db:types": "supabase gen types typescript --local > src/db/database.types.ts"
```

Kolejność kluczy w `scripts` — obok istniejących `deploy`/`deploy:dry` (rytm CLI, nie alfabetyczny).

#### 2. Generated Database types

**File**: `src/db/database.types.ts`

**Intent**: Committed generated file — nie edytowany ręcznie. Regen przez `npm run db:types` po każdej zmianie schematu.

**Contract**: Output z `supabase gen types typescript --local` po zaaplikowaniu migracji z Phase 1. Zawiera `export type Database` z typami `Row`/`Insert`/`Update` per tabela (`cards`, `review_history`), auth schema types, oraz enum `card_source`.

#### 3. Typed Supabase client

**File**: `src/lib/supabase.ts`

**Intent**: Retypowac istniejący `createServerClient` z generic `<Database>` żeby wszystkie dalsze API endpoints dostawały pełny typing. Nie zmieniamy pattern nullable clienta ani cookie handlera.

**Contract**: Dodać `import type { Database } from "@/db/database.types";`. Zmienić `createServerClient(SUPABASE_URL, SUPABASE_KEY, { ... })` na `createServerClient<Database>(SUPABASE_URL, SUPABASE_KEY, { ... })`. Reszta funkcji bez zmian — null-guard na env-ach, cookie handler, sygnatura `createClient(requestHeaders, cookies)` identyczne.

#### 4. README doc — regenerating types

**File**: `README.md`

**Intent**: Powiedzieć następnemu deweloperowi (lub sobie za miesiąc) kiedy i jak regenerować typy, i że drift schema↔types jest fail-loud w CI (`astro sync` się wywali).

**Contract**: Dodać nową krótką sekcję (nagłówek H2/H3 zgodnie z istniejącym rytmem README) po sekcji "Available Scripts": jeden paragraf mówiący, że po dodaniu migracji należy uruchomić `supabase db reset` (aby zaaplikować lokalnie), potem `npm run db:types`, i commit wygenerowanego `src/db/database.types.ts` razem z migracją.

### Success Criteria:

#### Automated Verification:

- `npm run astro sync` przechodzi bez errorów
- `npm run lint` przechodzi (react-compiler `error`-level bez skarg)
- `npm run build` przechodzi
- `npm run db:types` regeneruje `src/db/database.types.ts` bez błędów
- Re-run `npm run db:types` bezpośrednio po pierwszym daje pusty diff (idempotent generation)

#### Manual Verification:

- `npm run dev` startuje, signin/signup/signout flow działa lokalnie w browser
- W editorze IDE otwierając dowolny `src/pages/api/**/*.ts` i pisząc `const supabase = createClient(...); const { data } = await supabase.from('cards').select();` — autocomplete pokazuje kolumny `id, user_id, question, answer, source, created_at, updated_at`
- Manual smoke izolacji: przez Supabase Studio SQL editor jako user A wstaw fiszkę (`set local request.jwt.claim.sub`), przelogowanie kontekstu na user B potwierdza że nie widzi wierszy A

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

Brak — F-01 to warstwa danych, nie logika w JS/TS. Type-checking (`astro sync` → `tsc`) jest pierwszym gate'em.

### Integration Tests:

pgTAP suite w `supabase/tests/rls.test.sql` uruchamiane przez `supabase test db`. To JEST kluczowy integration test F-01 — wykonuje Risk mitigation z roadmapy i musi zostawać zielony przez cały życie projektu.

### Manual Testing Steps:

1. `supabase db reset` — aplikuje pierwszą migrację od zera
2. `supabase test db` — pgTAP suite zielony (N/N ok)
3. `npm run db:types` — regeneruje `src/db/database.types.ts` bez błędów
4. `npm run astro sync && npm run lint && npm run build` — wszystko zielone
5. `npm run dev` → w browser: zarejestruj usera A i usera B (`/auth/signup`)
6. W Supabase Studio → SQL editor jako authenticated (session id = A): insert card A, insert review_history dla card A
7. Przełącz session na B (Studio ma UI do symulacji ról): `select * from public.cards;` — 0 rows
8. Powrót do B w browser (drugi profil / incognito) — potwierdzenie że sesja B nie widzi danych A na poziomie query

## Performance Considerations

- Index `cards(user_id, created_at desc)` obsługuje list view "moje fiszki, najnowsze pierwsze" (S-03 CRUD)
- Index `review_history(user_id, next_review_at)` obsługuje due-cards query (S-02 review session)
- Index `review_history(card_id)` obsługuje card timeline / edit-vs-schedule logic (S-03 open q)
- MVP volume (per PRD Open Q5 nierozstrzygnięty) prawdopodobnie <10k fiszek per user — standardowy Postgres bez tuning wystarczy
- RLS overhead: `auth.uid() = user_id` jest inline, planner używa indeksu na `user_id` — praktycznie zero-cost

## Migration Notes

- To pierwsza migracja projektu — nie ma zastanego stanu w produkcyjnej DB, więc nie potrzebujemy backfill/data migration.
- Cloudflare Workers deploy target nie ma DB (Supabase separate); wrangler secrets `SUPABASE_URL`/`SUPABASE_KEY` już skonfigurowane w CI.
- `supabase link` do remote projektu — decyzja poza scope F-01 (potrzebne gdy będzie pierwszy prawdziwy deploy z DB w chmurze; do teraz Supabase jest tylko lokalny).
- CI (`.github/workflows/ci.yml`) NIE uruchamia Supabase — dlatego committed types są krytyczne. Regen `db:types` jest manualnym krokiem dewelopera przed commit — fail-loud gdy zapomniany: `astro sync` się wywali w CI.

## References

- Roadmap F-01: `context/foundation/roadmap.md:64-75`
- PRD FR-001/002/004 + NFR Privacy: `context/foundation/prd.md`
- AGENTS.md hard rule o RLS w tej samej migracji: `AGENTS.md`
- Auth pattern do zmiany minimalnej: `src/middleware.ts`, `src/lib/supabase.ts:9`
- Supabase config: `supabase/config.toml`
- Env schema: `astro.config.mjs:18-23`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Schema migration + RLS policies + indexes

#### Automated

- [x] 1.1 `supabase db reset` kończy się bez błędów — e78e7a1
- [x] 1.2 `supabase db lint --level warning` nie zgłasza warningów o brakującym RLS — e78e7a1
- [x] 1.3 `pg_extension` zawiera wiersz `pgtap` — e78e7a1

#### Manual

- [x] 1.4 Obie tabele widoczne w Supabase Studio w schema `public` — e78e7a1
- [x] 1.5 8 policies widoczne w Studio z target role `authenticated` i wyrażeniem `(auth.uid() = user_id)` — e78e7a1
- [x] 1.6 Cross-user INSERT z Studio SQL editora odrzucony przez `with check` — e78e7a1

### Phase 2: pgTAP isolation test

#### Automated

- [x] 2.1 `supabase test db` zwraca exit 0 — fbf5ce6
- [x] 2.2 Wszystkie asercje pgTAP raportowane jako `ok` (N/N) — fbf5ce6

#### Manual

- [x] 2.3 Test file czyta się jako runbook — dodanie kolejnej asercji nie wymaga otwierania pgTAP docs — fbf5ce6

### Phase 3: Database types + typed client integration

#### Automated

- [x] 3.1 `npm run astro sync` przechodzi — 7f618aa
- [x] 3.2 `npm run lint` przechodzi — 7f618aa
- [x] 3.3 `npm run build` przechodzi — 7f618aa
- [x] 3.4 `npm run db:types` regeneruje `src/db/database.types.ts` bez błędów — 7f618aa
- [x] 3.5 Re-run `db:types` daje pusty diff (idempotent) — 7f618aa

#### Manual

- [x] 3.6 Signin/signup/signout flow działa lokalnie w browser — 7f618aa
- [x] 3.7 Autocomplete w API endpoint pokazuje kolumny `cards` po wpisaniu `supabase.from('cards').select()` — 7f618aa
- [x] 3.8 Manual smoke izolacji przez Studio + browser potwierdza że JWT z cookie egzekwuje RLS — 7f618aa
