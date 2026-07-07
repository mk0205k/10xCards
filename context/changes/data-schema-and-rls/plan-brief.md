# Schemat danych + RLS + typy Database — Plan Brief

> Full plan: `context/changes/data-schema-and-rls/plan.md`

## What & Why

Zbudować pierwszą warstwę danych 10xCards: tabele `cards` i `review_history` w Supabase Postgres, z RLS per-user, wygenerowanymi typami TypeScript, i automatycznym testem izolacji cross-user. Bez tej warstwy żaden zależny slice (S-01 generacja AI, S-02 sesja review, S-03 CRUD, S-04 reset hasła) nie może zapisać ani odczytać danych — F-01 jest hard-blockerem czterech z pięciu roadmap items.

## Starting Point

Projekt ma zainstalowany klient Supabase (`@supabase/ssr`), skonfigurowany auth flow (middleware + signin/signup/signout endpoints), i lokalny `supabase/config.toml`. **Brakuje** katalogu `supabase/migrations/` (pierwsza migracja wprowadza tę konwencję), typów `Database` w `src/db/`, oraz jakichkolwiek tabel domenowych z RLS. Klient w `src/lib/supabase.ts:9` używa `createServerClient` bez generyka — każde query jest dziś any-typed.

## Desired End State

Migracja `<YYYYMMDDHHmmss>_initial_schema.sql` istnieje i aplikuje się czysto z `supabase db reset`. Tabele `cards` (uuid PK, source enum `'ai'|'manual'`) i `review_history` (algo-agnostic minimum: rating + next_review_at) mają RLS + 8 policies (4 per tabela × per-operation dla authenticated). `src/db/database.types.ts` jest wygenerowany i committed, klient używa `createServerClient<Database>(...)`. pgTAP test w `supabase/tests/rls.test.sql` uruchamiany przez `supabase test db` weryfikuje że user A nie widzi wierszy user B oraz że anon nic nie widzi.

## Key Decisions Made

| Decision                        | Choice                                                          | Why (1 sentence)                                                                                                            | Source |
| ------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------ |
| review_history algo-coupling    | Minimal algo-agnostic (rating + next_review_at)                 | S-02 doda algo-specific kolumny gdy PRD Open Q1 rozstrzygnięte; F-01 nie blokujemy na decyzji dotyczącej innego slice'a     | Plan   |
| cards secondary columns         | +source enum (`'ai'\|'manual'`), nic poza tym                   | Konieczne do sekundarnej metryki PRD "75% AI"; denormalizacja next_review_at przedwczesna; source_text łamie Privacy NFR    | Plan   |
| PK & FK behavior                | uuid + `on delete cascade` do auth.users                        | Standard Supabase; PRD Access Control "single-tenant per user" → user delete = wipe deck                                    | Plan   |
| Migration structure             | Jeden plik `<ts>_initial_schema.sql`                            | F-01 atomowo; jedna transakcja apply/revert; AGENTS.md hard rule policies w tej samej migracji co CREATE TABLE              | Plan   |
| Type generation                 | Local CLI + committed `src/db/database.types.ts`, npm `db:types` | Solo dev, MVP; CI dostaje typy z repo bez odpalania Supabase; regen manualny po każdej migracji                             | Plan   |
| RLS isolation test              | pgTAP via `supabase test db`                                    | Native Supabase; policzalne w CI; Risk mitigation z roadmapy wprost wymaga automated test                                   | Plan   |
| Env schema (`optional: true`)   | Zostawić bez zmian                                              | F-01 tyka tylko schema/RLS/types; env hardening to osobna troska (scope discipline)                                         | Plan   |

## Scope

**In scope:**

- Migracja SQL: enum `card_source`, tabele `cards` + `review_history`, indexy, trigger `updated_at`, RLS + 8 policies, extension pgtap
- pgTAP test file weryfikujący izolację cross-user i anon lockout
- Type generation setup: npm script + wygenerowany `src/db/database.types.ts` + retypowany klient
- README doc dla `db:types` regen workflow

**Out of scope:**

- Algo-specific kolumny w review_history (S-02, po Open Q1)
- Soft delete (PRD wymaga hard)
- Denormalizowany `next_review_at` na `cards` (przedwczesne)
- `source_text` na `cards` (Privacy NFR)
- Flip env z `optional` na required
- Vitest/Playwright test runner
- Seed data dla dev
- Wpis do `docs/reference/contract-surfaces.md` (katalog nie istnieje w repo)

## Architecture / Approach

Pojedynczy migration file (`YYYYMMDDHHmmss_initial_schema.sql`) definiuje enum, obie tabele, FK/indexes/trigger, i pełny stack RLS w jednej transakcji. Test izolacji siedzi w `supabase/tests/`, uruchamiany przez `supabase test db`, wykorzystuje wbudowany pgTAP i `set local request.jwt.claim.sub` do symulacji różnych userów. Type-gen jest lokalnym npm scriptem (`db:types`) który uderza w lokalną instancję Supabase i outputuje do `src/db/database.types.ts`. Klient w `src/lib/supabase.ts` dostaje generic `<Database>` — retypowanie propaguje autocomplete/typecheck do wszystkich dalszych API endpoints.

## Phases at a Glance

| Phase                                    | What it delivers                                                            | Key risk                                                                                          |
| ---------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1. Schema migration + RLS + indexes      | Pierwszą migrację; obie tabele z RLS + 8 policies + trigger + indexy        | Źle skonstruowana policy = cichy leak cross-user (Privacy NFR breach)                             |
| 2. pgTAP isolation test                  | `supabase/tests/rls.test.sql` — automated proof że Phase 1 nie leak         | pgTAP DSL nietrywialny; łatwo napisać test który zawsze passuje (fałszywy sygnał)                 |
| 3. Database types + typed client         | `src/db/database.types.ts` + retypowany client + `db:types` script + README | Regen ręczny → schema/types drift jeśli deweloper zapomni (fail-loud w CI przez `astro sync`)     |

**Prerequisites:** Docker (dla lokalnego Supabase — `supabase start`); `supabase` CLI (już w devDeps).

**Estimated effort:** ~1 sesja programistyczna (2–3h) rozłożona na 3 commity — Phase 1 mechaniczny, Phase 2 wymaga myślenia o pgTAP DSL, Phase 3 wymaga jednego re-runu przy iteracji nad naming.

## Open Risks & Assumptions

- Zakładamy że Docker jest lokalnie dostępny — inaczej `supabase db reset` i `supabase test db` nie zadziałają (fallback: `supabase link` do remote, ale poza scope F-01).
- Przyjmujemy że S-02 doda algo-specific kolumny do `review_history` przez `ALTER TABLE`, nie big-bang rewrite.
- Regen types manualny — jeśli deweloper zapomni po migracji w przyszłości, CI build się wywali na `astro sync` i to zasygnalizuje drift (fail-loud, akceptowalne).

## Success Criteria (Summary)

- `supabase db reset && supabase test db` — obie komendy zielone bez interwencji
- `npm run astro sync && npm run lint && npm run build` zielone; typed queries `supabase.from('cards')` autocomplete'ują kolumny
- Manual smoke: dwóch userów zarejestrowanych przez browser, każdy widzi tylko swoje wiersze w Studio SQL editor po `set local request.jwt.claim.sub`
