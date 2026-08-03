# Raport Analizy MVP — projekt **10xCards** (`10xdevs/`)

Projekt zidentyfikowany jako aplikacja webowa (Astro 6 SSR + React 19 islands, Supabase, Cloudflare Workers) — narzędzie do tworzenia fiszek edukacyjnych generowanych przez AI (OpenRouter) z algorytmem powtórek FSRS.

Data analizy: 2026-08-03

## 1. Checklista kryteriów

### ✅ 1. Operacje CRUD
Wszystkie cztery operacje na encji `cards` działają na trwałych danych (Supabase Postgres):

- **Create** — `POST /api/cards` — `src/pages/api/cards.ts:52` (insert do tabeli `cards` z `emptyCardState()`)
- **Read** — `GET /api/cards` — `src/pages/api/cards.ts:23` (select z sortowaniem po `created_at`)
- **Update** — `PATCH /api/cards/[card_id]` — `src/pages/api/cards/[card_id].ts:28` (walidacja Zod → update `question`/`answer`)
- **Delete** — `DELETE /api/cards/[card_id]` — `src/pages/api/cards/[card_id].ts:89`

Uzupełniające endpointy: `POST /api/review/[card_id]/rate` (aktualizacja stanu FSRS), `POST /api/account/delete`, `POST /api/account/restore`.

### ✅ 2. Logika biznesowa
Projekt zawiera dwie odrębne, nietrywialne warstwy logiki:

- **Generowanie fiszek przez LLM** — `src/lib/ai/generate-proposals.ts` — streaming z OpenRouter, walidacja odpowiedzi względem `proposalsSchema` (Zod), system prompt narzucający ugruntowanie w tekście źródłowym i limit 15 propozycji.
- **Harmonogramowanie powtórek FSRS** — `src/lib/review/scheduler.ts` — obudowuje `ts-fsrs` (funkcje `createScheduler`, `computePreview`, `hydrateCard`, `emptyCardState`, `formatInterval`); wylicza kolejne terminy powtórek dla ocen again/hard/good/easy.
- **Soft-delete z 30-dniową retencją** — RPC `enqueue_hard_delete`/`restore_account` + dwa zadania `pg_cron` (`hard_delete_expired_accounts`, `retention_watchdog`) w migracjach Supabase.

### ✅ 3. Testy adresujące zdefiniowane ryzyko
Plan testów istnieje w `context/foundation/test-plan.md` z mapą sześciu ryzyk. Przykładowe mapowanie ryzyko → test:

- **Ryzyko #1** (§2 test-planu) — „AI-generation returns corrupted or truncated flashcards from OpenRouter response drift" → `src/pages/api/generate.test.ts` (16 asercji; testy happy-path, provider throw → `502 GENERATION_FAILED`, timeout → `504 GENERATION_TIMEOUT`, wykorzystanie fixture'ów w `src/test/fixtures/generate-stream.ts`).
- Inne pokrycia: `scheduler.test.ts`, `cards.test.ts`, `account/delete.test.ts`, `review/next.test.ts`, `review/[card_id]/rate.test.ts`, `auth/signup.test.ts` — łącznie 9 plików testowych. Faza 1 planu (`context/changes/testing-generation-flow-protection/`) oznaczona jako `complete`.

### ✅ 4. Autentykacja powiązana z użytkownikiem
- Rejestracja i logowanie e-mail/hasło przez Supabase Auth — `src/pages/auth/signup.astro`, `signin.astro`, endpointy w `src/pages/api/auth/`.
- Middleware `src/middleware.ts:5` chroni trasy `["/dashboard", "/generate", "/review", "/deck", "/account"]`, przekierowuje nieuwierzytelnionych do `/auth/signin`, a użytkowników w oknie retencji do `/auth/restore-account`.
- Zasoby zakresowe per-user: kolumna `user_id` w tabeli `cards`, polityki RLS (patrz `supabase/migrations/20260707200908_initial_schema.sql`) — zasób jest własnością konkretnego użytkownika, nie globalny.

### ✅ 5. Dokumentacja
Warstwa 10x foundation kompletna w `context/foundation/`:

- `prd.md` (182 linie) — wizja, persona, kryteria sukcesu, historie użytkownika, US-01…US-XX
- `shape-notes.md` (176 linii), `roadmap.md` (253 linie), `tech-stack.md`, `infrastructure.md`, `test-plan.md`, `lessons.md`
- `README.md` (222 linie) — setup Supabase (lokalny + hosted), skrypty, konfiguracja Cloudflare Workers, opis flow soft-delete
- `AGENTS.md` + `CLAUDE.md` — konwencje projektu dla agentów

## 2. Status projektu

**5/5 kryteriów spełnionych = 100%.**

## 3. Rekomendacje usprawnień

Brak nieujętych kryteriów — projekt spełnia próg techniczny w całości.

## 4. Elementy wykraczające poza minimum

Warto odnotować (potencjał na Demo Day):

- **Defence-in-depth w bezpieczeństwie**: RLS + walidacja Zod na endpointach + 42501 mapowane na 404 (brak wycieku istnienia rekordu) + soft-delete gate w middleware.
- **Realny integracyjny model AI** ze streamingiem, structured output (Zod schema), timeout 30 s zgodnie z guardrailem PRD.
- **Pełny FSRS** zamiast prostego interwału — algorytm klasy produkcyjnej (`ts-fsrs`).
- **i18n z parity check w CI** (`scripts/check-i18n-parity.mjs`) — nie wymagane, ale świadczy o dojrzałości.
- **Struktura 10x foundation** w komplecie: PRD → roadmap → tech-stack → infrastructure → test-plan z fazowym rolloutem (5 faz, faza 1 ukończona, faza 5 e2e w toku).
- **Retencja z pg_cron + fail-loud watchdog** — nietypowe dla MVP, adresuje realne wymaganie compliance.
