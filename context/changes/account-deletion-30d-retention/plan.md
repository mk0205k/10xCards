# Usunięcie konta z 30-dniową retencją Implementation Plan

## Overview

S-05 dodaje soft-delete konta z 30-dniowym oknem retencji. Nowa tabela `public.profiles` trzyma `deleted_at` + `scheduled_hard_delete_at`; SECURITY DEFINER funkcja `execute_hard_delete()` wywoływana codziennie o 03:00 UTC przez `pg_cron` kasuje `auth.users` dla wierszy z `scheduled_hard_delete_at <= now()` — CASCADE wyczyści `cards`, `review_history`, `profiles`. RLS na tabelach użytkownika dostaje EXISTS gate na `profiles.deleted_at is null`, więc soft-deleted user nie widzi/nie edytuje niczego mimo valid JWT. Middleware kieruje soft-deleted usera do `/auth/restore-account` gdzie może przywrócić konto jednym klikiem. Signup na email z pending soft-delete zwraca 409 z podpowiedzią do restore. `POST /api/account/delete` z type-to-confirm AlertDialog na nowej stronie `/account` wywołuje `supabase.auth.signOut({ scope: 'global' })` na SSR clencie — jego bearer token propaguje do GoTrue `/logout?scope=global` i unieważnia wszystkie refresh tokeny tego usera (SSR client zna sesję z cookie, nie potrzebujemy service_role).

## Current State Analysis

- **Schema** (`supabase/migrations/20260707200908_initial_schema.sql`, `20260709120000_fsrs_state_and_review_log.sql`): tabele `public.cards` i `public.review_history` z FK `on delete cascade` do `auth.users(id)`. RLS enabled + 6 policies (`cards_{select,insert,update,delete}_own`, `review_history_{select,insert}_own`). Brak `deleted_at`/soft-delete columns.
- **Auth** (`src/middleware.ts:1-25`, `src/pages/api/auth/{signin,signup,signout}.ts`): SSR anon client z `@supabase/ssr`, `context.locals.user` populowany w middleware, protected routes: `["/dashboard", "/generate", "/review", "/deck"]`. Brak service-role klienta w kodzie.
- **UI** (`src/components/Topbar.astro:6-37`): navbar z linkami do `/dashboard` + Sign out (POST `/api/auth/signout`), brak Settings/Account. Brak shadcn Dialog/AlertDialog — install wymagany.
- **Infra** (`wrangler.jsonc`): brak `triggers.crons`. `astro.config.mjs:24-32` env schema: `SUPABASE_URL`, `SUPABASE_KEY` (obie `optional: true`, `context: server, access: secret`), `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`. Brak `SUPABASE_SERVICE_ROLE_KEY` — i nie dodajemy (patrz Implementation Approach).
- **Testy**: `supabase/tests/rls.test.sql` pokrywa RLS isolation dla cards + review_history + commit_review (20 asercji). Vitest zainstalowany, `src/pages/api/cards.test.ts`, `src/pages/api/review/**/*.test.ts` istnieją jako pattern.
- **Roadmap** flaguje S-05 dwoma `Block: yes` Open Questions — obie rozstrzygnięte w tej sesji.
- **Sąsiednie prace**: S-03 (`deck-management-crud`) `implementing` — jego DELETE cards CASCADE'uje `review_history` przez FK; S-04 (`password-reset-flow`) `proposed` — wprowadza `PUBLIC_SITE_URL` env var i pattern dla auth-adjacent stron; oba są kompatybilne, nie kolidują z S-05.

## Desired End State

- Migracja `<YYYYMMDDHHmmss>_soft_delete_and_retention.sql` istnieje i aplikuje się czysto (`supabase db reset` lub `supabase db push`).
- Tabela `public.profiles (user_id uuid pk fk auth.users on delete cascade, deleted_at timestamptz null, scheduled_hard_delete_at timestamptz null, created_at timestamptz not null)` z RLS + policies (SELECT/UPDATE own).
- Trigger `on_auth_user_created` na `auth.users` autoinsertuje `profiles(user_id)` wiersz przy każdym signup.
- 6 zaktualizowanych policies na `cards` + `review_history` z EXISTS gate na `profiles.deleted_at is null`.
- `public.enqueue_hard_delete(uuid)` SECURITY DEFINER ustawia `deleted_at = now()` i `scheduled_hard_delete_at = now() + interval '30 days'`.
- `public.restore_account()` SECURITY INVOKER czyści oba pola dla `auth.uid()`.
- `public.execute_hard_delete()` SECURITY DEFINER kasuje z `auth.users` gdzie `id in (select user_id from profiles where scheduled_hard_delete_at <= now())` — CASCADE odzyskuje wszystko.
- `select cron.schedule('hard_delete_expired_accounts', '0 3 * * *', 'select public.execute_hard_delete()');` — codzienny job.
- Watchdog query dokumentowana w README: `select count(*) from public.profiles where scheduled_hard_delete_at < now() - interval '1 day';` (>0 = cron cichy fail).
- `POST /api/account/delete` — soft-delete via `supabase.rpc('enqueue_hard_delete', { p_user_id: user.id })` na SSR clencie (RLS + funkcja SECURITY DEFINER walidują ownership), następnie `supabase.auth.signOut({ scope: 'global' })` na tym samym SSR clencie (bearer JWT z cookie propaguje do GoTrue `/logout?scope=global` → wszystkie sessions unieważnione), redirect 303 na `/`.
- `POST /api/account/restore` — wywołuje `restore_account()` RPC na SSR clencie, 303 na `/dashboard`.
- Signup endpoint (`src/pages/api/auth/signup.ts`) — pre-check przez ten sam SSR anon client `supabase.rpc('email_pending_deletion', { p_email })` (RPC ma `grant execute to anon, authenticated` bo signup jest przed sesją); jeśli true, redirect `?error=account_pending_deletion` z konkretnym Polish komunikatem + link do signin.
- Middleware gate: gdy `context.locals.user != null` i user ma `profiles.deleted_at != null`, a URL nie jest `/auth/restore-account` ani `/api/account/restore` ani `/api/auth/signout`, redirect na `/auth/restore-account`.
- Strona `/auth/restore-account.astro` (unprotected przez middleware ale wymaga session; jeśli brak sesji → redirect `/auth/signin`): pokazuje maskowany email + informację o retention + form POST z jednym przyciskiem "Przywróć konto" → `/api/account/restore`.
- Strona `/account/index.astro` (protected) z sekcją "Strefa niebezpieczna" i przyciskiem "Usuń konto" → otwiera `DeleteAccountDialog` (React island) z type-to-confirm (input musi zawierać dokładnie email usera).
- Link "Konto" w `src/components/Topbar.astro` obok "Sign out".
- shadcn `@radix-ui/react-alert-dialog` + `src/components/ui/alert-dialog.tsx` wrapper install.
- pgTAP suite rozszerzone o soft-delete gate + retention cron function + trigger; vitest testy dla `/api/account/{delete,restore}` + signup guard 409.

### Key Discoveries:

- **AGENTS.md hard rule** (`AGENTS.md:8`) — policies per-op, per-role, w tej samej migracji co CREATE TABLE. Aktualizacja policies (DROP + CREATE z EXISTS) w tej samej migracji co CREATE TABLE profiles + trigger + cron.
- **FK cascade already in place**: `cards.user_id → auth.users(id) on delete cascade` i `review_history.user_id → auth.users(id) on delete cascade` (`supabase/migrations/20260707200908_initial_schema.sql:22,33`). Hard-delete `auth.users` automatycznie wyczyści wszystko — brak potrzeby explicit DELETE per-table w cron function.
- **Supabase `supabase.auth.signOut({ scope: 'global' })` na SSR clencie** (nie admin!) unieważnia wszystkie refresh tokeny tego usera: SSR client używa cookie bearer JWT do POST `/logout?scope=global`, GoTrue iteruje sesje i deletes wszystkie refresh_token rows dla `user_id`. `admin.signOut(jwt, scope)` w `@supabase/supabase-js/GoTrueAdminApi.ts` też przyjmuje JWT (nie userId) — nie mamy powodu iść przez admin API, bo SSR ma JWT natywnie. Wywoływane po commit `enqueue_hard_delete` — race na 1-2 sekundy tolerowany (RLS EXISTS gate blokuje w międzyczasie).
- **pg_cron on Supabase Cloud**: extension musi być enable'd przez `create extension if not exists pg_cron with schema extensions;` — Supabase Cloud whitelistuje extension. Local Supabase (`.dev.vars → cloud by default`, MEMORY.md) nie odpala schedulera domyślnie; testy pg_cron function testujemy przez bezpośrednie wywołanie `select execute_hard_delete()` z pgTAP z zamockowanym `now()` przez insert wierszy z `scheduled_hard_delete_at` w przeszłości.
- **`.dev.vars → cloud by default`** (MEMORY.md, `dev-vars-cloud-vs-local.md`) — nowy `SUPABASE_SERVICE_ROLE_KEY` w `.dev.vars` uderza w cloud, w migracje aplikują się do local. Musimy `supabase db push` do cloud przed manualnym smoke testem.
- **Existing signup pattern** (`src/pages/api/auth/signup.ts`): form-POST → `supabase.auth.signUp()` → redirect. Guard na soft-delete idzie przed `signUp()`, używa admin client do `admin.listUsers({filter: email})` + join z profiles (lub direct SQL query przez admin client).
- **Middleware ordering**: gate soft-delete DOPIERO PO ustawieniu `context.locals.user` i PRZED redirect na `/auth/signin` z braku user (`src/middleware.ts:18-22`). Trzeba dodatkowy query do profiles per request — cache przez memoized fetch w tym samym request nie potrzebny (jeden request = jeden middleware run).
- **Signup guard bez enumeration attack**: pre-check zwraca ten sam generic error jeśli email istnieje (soft-deleted lub live) — nie ujawnia stanu retention. Alternatywnie: bardziej pomocny komunikat konkretny dla soft-delete akceptowany za drobny enumeration cost (email + password-based auth i tak ma enumeration przez signin). **Decyzja plan-time**: konkretny komunikat "Konto z tym mailem oczekuje na usunięcie" — user experience > mikroskopijna enumeration surface.
- **Lokalny test cron function bez pg_cron dispatchera**: pgTAP wywołuje `select public.execute_hard_delete()` bezpośrednio; sam scheduler NIE JEST testowany lokalnie (cron.schedule zapisuje wpis w `cron.job`, ale dispatcher w local Supabase może być wyłączony). Wpis `cron.schedule` jest weryfikowany integracyjnie na cloud po `supabase db push` przez `select * from cron.job where jobname = 'hard_delete_expired_accounts'`.

## What We're NOT Doing

- **GDPR data export (Right to portability)** — poza scope MVP; roadmap S-05 tylko o delete.
- **Audit log** (`account_events` tabela z historią delete/restore) — S-06 territory, deferred.
- **Custom-branded email potwierdzający soft-delete** — restore flow polega na signin (user knows co się dzieje); mail = dodatkowy kanał, poza scope.
- **Turnstile/CAPTCHA na delete** — protected route z type-to-confirm ma wystarczający friction dla MVP.
- **Sesja read-only w oknie 30d** — decyzja round 3: signin dopuszczalny tylko do restore.
- **External alert email/Slack push przy watchdog fail** — automated signal jest w-Postgres (WARNING w `execute_hard_delete` + EXCEPTION w `retention_watchdog` daje czerwony job w Supabase Studio Cron history); zewnętrzny push (pg_net → webhook, email) poza scope MVP.
- **Multi-device signout confirmation UI** — `admin.signOut('global')` robi to cicho.
- **Reauthentication przy delete (re-enter password)** — decyzja round 3: type-to-confirm email wystarcza.
- **Flip `SUPABASE_URL`/`SUPABASE_KEY` z optional na required** — scope discipline, osobna troska.
- **Zmiana istniejącego DELETE flow w `/api/cards/[card_id]`** (S-03) — S-05 nie dotyka per-card delete.

## Implementation Approach

Trzy fazy, każda z self-contained verification kończąca się commitowalnym stanem.

**Faza 1** wprowadza cały stack SQL w jednej atomowej migracji (AGENTS.md hard rule, roadmap Risk mitigation): profiles + trigger + zaktualizowane RLS + 3 SECURITY DEFINER/INVOKER funkcje + cron.schedule. Regeneruje typy Database. Rozszerza pgTAP suite o: soft-delete gate izolacji (5+ asercji: soft-deleted user nie widzi swoich cards; nie widzi cudzych; nie insertuje; nie updateuje; restore czyści state), execute_hard_delete idempotent + kasuje >30d + zostawia <30d, enqueue_hard_delete ustawia oba pola. Test cron scheduling nie automatyzujemy — manualny check na cloud po push.

**Faza 2** dodaje service-role client (`src/lib/supabase-admin.ts`), env schema update (`SUPABASE_SERVICE_ROLE_KEY`), oba API endpointy (delete + restore) idące przez SSR client dla RLS + admin client tylko dla `admin.signOut`, oraz signup guard. Testy vitest per endpoint (soft-delete → 204 + Supabase state; restore → 204; delete unauth → 401; signup na soft-deleted email → 409 z redirect).

**Faza 3** wpina middleware soft-delete gate (dodatkowy select z profiles za `getUser()`), buduje `/auth/restore-account.astro` z form POST, `/account/index.astro` z sekcją Danger zone, wprowadza `AlertDialog` shadcn wrapper (`@radix-ui/react-alert-dialog` + `src/components/ui/alert-dialog.tsx`), `DeleteAccountDialog.tsx` island z type-to-confirm. Link "Konto" w Topbar. README rozszerzone o retention flow + monitoring watchdog query.

Zachowujemy istniejący pattern:
- `?error=<encoded>` na signin/signup po redirect (S-04 pattern, kompatybilne)
- `context.locals.user` w middleware
- `createClient(headers, cookies)` fabryka nie zmieniana — admin client to nowa, osobna funkcja
- `jsonResponse(status, body)` helper w endpoints (pattern z `/api/cards`)
- pgTAP DSL (dokładnie jak w `supabase/tests/rls.test.sql:40-41`): `set local role authenticated; set local request.jwt.claims to '{"sub":"<uuid>","role":"authenticated"}';` — JSON-object form, nie `.jwt.claim.sub` single-claim

## Critical Implementation Details

- **Trigger `on_auth_user_created` musi być SECURITY DEFINER, no ownership check** — trigger fires w kontekście PostgREST auth flow, więc bez SECURITY DEFINER `insert into profiles` z auth.uid() jeszcze not-set fails. Wzorzec: `create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$ begin insert into public.profiles (user_id) values (new.id); return new; end $$;`. **Bez tego** signup nie tworzy profile row i middleware EXISTS query zwraca 0 → user natychmiast redirect na /auth/restore-account = 100% breakage.
- **Backfill dla istniejących userów przed enable RLS EXISTS gate**: migracja MUSI zawierać `insert into public.profiles (user_id) select id from auth.users on conflict do nothing;` PRZED aktualizacją policies. Kolejność: (1) create profiles + trigger, (2) backfill istniejących userów, (3) DROP + CREATE policies z EXISTS. Bez tego kroku każdy user zarejestrowany przed migracją traci dostęp do swoich cards (istniejące env: użytkownicy z S-01/S-02 testów manualnych na cloud/local).
- **RLS EXISTS z indeksem, nie join**: policy uses `exists (select 1 from public.profiles where user_id = auth.uid() and deleted_at is null)`. Index `create index profiles_user_alive_idx on public.profiles (user_id) where deleted_at is null;` — partial index; planner uses index-only scan; overhead sub-ms per policy check. **Bez partial index** query planner robi seq scan przy każdej SELECT z cards przy skalowaniu.
- **`supabase.auth.signOut({ scope: 'global' })` musi być PO commit z DB, nie przed**: kolejność w `/api/account/delete`: (1) `supabase.rpc('enqueue_hard_delete', { p_user_id: user.id })` przez SSR client (RLS + SECURITY DEFINER walidują ownership), (2) `supabase.auth.signOut({ scope: 'global' })` na tym samym SSR clencie (jedno wywołanie unieważnia wszystkie sesje i wylogowuje current cookie), (3) redirect 303 na `/`. Jeśli signOut przed DB write, user re-login w ciągu 1s widzi live konto — pattern race.
- **`enqueue_hard_delete(uuid)` musi być SECURITY DEFINER żeby writes do profiles nawet gdy RLS zablokuje** (bo nowe policies mogą lock SELF-UPDATE do wierszy z deleted_at is null): funkcja bierze `p_user_id` i validuje `p_user_id = auth.uid()` explicit, następnie updateuje profiles jako owner. Alternatywa: policy `profiles_update_soft_delete_own` z warunkiem allowing self-mark-as-deleted — bardziej lokalne, ale rozprasza logikę. Wybieramy SECURITY DEFINER + explicit check w funkcji (analogicznie do `commit_review` z `first-review-session`).
- **Signup guard przez SSR anon client + SECURITY DEFINER RPC**: check istnienia wiersza w profiles dla danego emaila wymaga JOIN z auth.users, do której SSR anon client nie ma SELECT grantu. Rozwiązanie: `email_pending_deletion(text) returns boolean` jest SECURITY DEFINER (owner postgres) i wraca true jeśli `auth.users.email = lower(p_email) AND profiles.deleted_at IS NOT NULL`. `grant execute to anon, authenticated` — anon SSR client wywołuje `supabase.rpc('email_pending_deletion', { p_email: email })` przed `signUp()`. To eliminuje potrzebę service_role klienta.
- **Middleware profile query dodatkowy koszt: 1 DB hit per protected request**: dodać `.select('deleted_at').eq('user_id', user.id).maybeSingle()` po `getUser()`. Cache w kontekście request nie potrzebny (jeden run middleware = jeden request). Alternatywa (JWT custom claim `deleted_at`) — Supabase JWT customization nietrywialne, poza scope MVP.
- **AlertDialog install pattern**: `npx shadcn@latest add alert-dialog` — sprawdza istniejący `components.json` (istnieje w projekcie po S-03), instaluje `@radix-ui/react-alert-dialog`, generuje `src/components/ui/alert-dialog.tsx`. Jeśli emituje v0/v3 syntax pod Tailwind 4, drobny patch może być wymagany (S-03 open risk, plan-brief).
- **Local Supabase pg_cron dispatcher OFF**: `cron.schedule` zapisze wpis, ale scheduler w local Docker image może nie odpalać jobów (Supabase CLI limitation). Cron behavior weryfikujemy przez `supabase db push` do cloud project + manual check `cron.job` + wywołanie funkcji explicit w Studio SQL editor. To ustalona akceptowalna asymetria dla MVP.
- **Restore state**: po `restore_account()` cards, review_history, cards.due, cards.stability itd. pozostają byte-identyczne. Nie resetujemy FSRS scheduler'a — user wraca do stanu sprzed delete. To decyzja spójna z S-03 (edit != schedule reset).

---

## Phase 1: Schema migration + RLS gates + pg_cron + tests

### Overview

Jedna migracja SQL wprowadza: extension pg_cron, tabelę profiles z trigger auto-insert, backfill istniejących userów, DROP + CREATE 6 policies na cards/review_history z EXISTS gate, 3 funkcje (enqueue_hard_delete, restore_account, execute_hard_delete + helper email_pending_deletion), cron.schedule. Rozszerza pgTAP suite o soft-delete gate + retention function tests. Regeneruje `database.types.ts`.

### Changes Required:

#### 1. Retention migration

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_soft_delete_and_retention.sql`

**Intent**: Wprowadzić soft-delete + 30d retention w jednej atomowej migracji. `<YYYYMMDDHHmmss>` = timestamp UTC w chwili tworzenia. Ta migracja musi się aplikować czysto zarówno lokalnie (dla pgTAP) jak i na cloud (dla realnego cron dispatchera).

**Contract**:

- Extension: `create extension if not exists pg_cron with schema extensions;`
- Table `public.profiles`:
  - `user_id uuid primary key references auth.users(id) on delete cascade`
  - `deleted_at timestamptz null`
  - `scheduled_hard_delete_at timestamptz null`
  - `created_at timestamptz not null default now()`
- Partial index: `create index profiles_user_alive_idx on public.profiles (user_id) where deleted_at is null;`
- Grants: `grant select, update on table public.profiles to authenticated;` (INSERT tylko przez trigger — SECURITY DEFINER, więc grant do authenticated NIE potrzebny)
- RLS enable + policies:
  - `profiles_select_own` — for select to authenticated using (`auth.uid() = user_id`)
  - `profiles_update_own` — for update to authenticated using (`auth.uid() = user_id`) with check (`auth.uid() = user_id`)
- Trigger + function:
  - Function `public.handle_new_user()` — SECURITY DEFINER, `set search_path = public`, `insert into public.profiles (user_id) values (new.id) on conflict do nothing`
  - Trigger `on_auth_user_created` — `after insert on auth.users for each row execute function public.handle_new_user()`
- **Backfill (musi być PRZED zaktualizowaniem cards/review_history policies)**:
  - `insert into public.profiles (user_id) select id from auth.users on conflict (user_id) do nothing;`
- Zaktualizowane RLS policies na `cards` (DROP wszystkich 4 → CREATE z EXISTS gate):
  - `cards_select_own`: `for select to authenticated using (auth.uid() = user_id and exists(select 1 from public.profiles p where p.user_id = auth.uid() and p.deleted_at is null))`
  - `cards_insert_own`, `cards_update_own`, `cards_delete_own` — analogicznie (INSERT używa with check zamiast using)
- Zaktualizowane RLS policies na `review_history` (DROP `review_history_select_own`, `review_history_insert_own` → CREATE z tym samym EXISTS gate). Note: UPDATE/DELETE nie ma grantów, wystarczy 2 policies.
- Functions:
  - `public.enqueue_hard_delete(p_user_id uuid)` returns void — SECURITY DEFINER, `set search_path = public, auth`, sprawdza `p_user_id = auth.uid()` (raise exception 42501 jeśli mismatch), `update public.profiles set deleted_at = now(), scheduled_hard_delete_at = now() + interval '30 days' where user_id = p_user_id and deleted_at is null`. `grant execute` do `authenticated`, `revoke execute from public`.
  - `public.restore_account()` returns void — SECURITY INVOKER (używa auth.uid() bezpośrednio), `update public.profiles set deleted_at = null, scheduled_hard_delete_at = null where user_id = auth.uid() and deleted_at is not null`. `grant execute to authenticated`.
  - `public.execute_hard_delete()` returns integer (count of deleted) — SECURITY DEFINER, `set search_path = public, auth`. Kasuje wiersze z `auth.users` gdzie id in (`select user_id from public.profiles where scheduled_hard_delete_at is not null and scheduled_hard_delete_at <= now()`). Zwraca liczbę usuniętych. Na końcu, jeśli po delete pozostają orphany starsze niż 1 dzień (nie były delete'owane z jakiegoś powodu — RLS, cascade fail, lock), `raise warning 'retention_overdue: % orphans older than 1d', overdue_count` — pojawi się w `cron.job_run_details.return_message` jako fail-loud sygnał. `revoke execute from public`, `grant execute to service_role`.
  - `public.retention_watchdog()` returns void — SECURITY DEFINER, `set search_path = public`. `if exists(select 1 from public.profiles where scheduled_hard_delete_at is not null and scheduled_hard_delete_at < now() - interval '1 day') then raise exception 'retention_watchdog: % orphans past cutoff', count; end if;` — kiedy exception w cron job, `cron.job_run_details.status` = `'failed'`, `return_message` widoczne w Studio → Cron Jobs → History z czerwonym markerem. `revoke execute from public`, `grant execute to service_role`.
  - `public.email_pending_deletion(p_email text)` returns boolean — SECURITY DEFINER, `set search_path = public, auth`. Returns exists(`select 1 from auth.users u join public.profiles p on p.user_id = u.id where u.email = lower(p_email) and p.deleted_at is not null`). `grant execute to authenticated, anon`. Uwaga: `lower()` bo Supabase normalizuje email lowercase.
- Cron schedules (dwa joby):
  - `select cron.schedule('hard_delete_expired_accounts', '0 3 * * *', $$select public.execute_hard_delete();$$);` — codziennie 03:00 UTC, wykonuje hard-delete.
  - `select cron.schedule('retention_watchdog', '0 4 * * *', $$select public.retention_watchdog();$$);` — codziennie 04:00 UTC (godzinę po hard-delete run), fail-loud jeśli po wczorajszym runie pozostają orphany >1d. Podwójny sygnał: WARNING w execute_hard_delete + red status na retention_watchdog job.
- Wszystko w jednej transakcji — Supabase CLI już opakowuje pojedynczy plik migracji w BEGIN/COMMIT.

#### 2. Regenerated Database types

**File**: `src/db/database.types.ts`

**Intent**: Regeneracja przez `npm run db:types` po `supabase db reset` z nową migracją. Nie edytujemy ręcznie.

**Contract**: Output z `supabase gen types typescript --local` zawiera nowe typy: `profiles.Row`/`Insert`/`Update`, nowe RPC functions (`enqueue_hard_delete`, `restore_account`, `execute_hard_delete`, `email_pending_deletion`) w `Database['public']['Functions']`. Bez zmian w typach `cards`, `review_history`.

#### 3. Extended pgTAP suite

**File**: `supabase/tests/rls.test.sql`

**Intent**: Rozszerzyć istniejący plik testowy o soft-delete gate + retention logic. Zachowujemy dotychczasowe asercje (RLS isolation na cards/review_history, commit_review), dodajemy nową sekcję dla S-05.

**Contract**: Nowe asercje (~14-16 dodatkowych, sumaryczny plan przechodzi z 20 na ~36-38):

- Setup: trzeci user (userC) w insert.auth.users; profiles są autoinsertowane przez trigger — assert `select count(*) from profiles = 3`.
- Insert card + review_history dla userA, userB, userC (przez odpowiedni JWT).
- **soft-delete gate na cards**:
  - `select enqueue_hard_delete('<userA>')` jako userA — pass; następnie `select count(*) from public.cards` jako userA = 0 (RLS EXISTS gate blokuje).
  - Jako userA: `insert into public.cards ...` odrzucone przez RLS (nowa policy `with check` z EXISTS).
  - Jako userA: `update public.cards set question = 'x' where user_id = '<userA>'` — 0 rows affected.
  - Jako userB (nie soft-deleted): dalej widzi swoje cards (1 wiersz) — regression check.
- **enqueue_hard_delete authorization**:
  - Jako userA: `select enqueue_hard_delete('<userB>')` — `throws_ok` (raise 42501).
- **restore_account**:
  - Jako userA (soft-deleted): `select restore_account()` — pass; `select count(*) from public.cards` = 1 (odzyskany dostęp).
- **execute_hard_delete idempotent + cutoff**:
  - Reset: userA + userC soft-delete z `scheduled_hard_delete_at = now() - interval '1 day'`; userB soft-delete z `scheduled_hard_delete_at = now() + interval '15 days'`.
  - `select execute_hard_delete()` zwraca 2 (userA + userC).
  - `select count(*) from auth.users where id in ('<userA>','<userC>')` = 0 — CASCADE działa.
  - `select count(*) from public.cards where user_id in ('<userA>','<userC>')` = 0 — CASCADE działa.
  - `select count(*) from auth.users where id = '<userB>'` = 1 (jeszcze nie czas).
  - Second call: `select execute_hard_delete()` zwraca 0 (idempotent).
- **email_pending_deletion**:
  - Jako anon: `select email_pending_deletion('<userB_email>')` = true (soft-deleted, w oknie).
  - Jako anon: `select email_pending_deletion('nonexistent@example.com')` = false.
- **retention_watchdog fail-loud**:
  - Setup: insert soft-deleted user z `scheduled_hard_delete_at = now() - interval '2 days'` (symulacja: cron nie zdążył/padł).
  - `throws_ok('select public.retention_watchdog()')` — expect exception (fail-loud sygnał).
  - Cleanup: remove orphan row; `lives_ok('select public.retention_watchdog()')` (0 orphanów → clean run).
- **trigger auto-insert**: `insert into auth.users (id, email, ...) values (<newUuid>, 'trigger-test@example.com', ...)`; assert `select count(*) from public.profiles where user_id = <newUuid>` = 1.

Style i konwencja identyczne z istniejącym plikiem (`select plan(N)` na górze, `begin;` / `rollback;` wrapper, `set local role authenticated; set local request.jwt.claims to '{"sub":"<uuid>","role":"authenticated"}';` — JSON-object form).

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `supabase db reset` bez błędów
- `supabase db lint --level warning` nie zgłasza warningów o brakującym RLS na `public.profiles`
- `supabase test db` — exit 0, wszystkie ~36-38 asercji `ok`
- `npm run db:types` regeneruje bez błędów; drugi run daje pusty diff (idempotent)
- `npm run astro sync && npm run lint && npm run build` — zielone
- `psql ... -c "select extname from pg_extension where extname = 'pg_cron';"` zwraca jeden wiersz (na cloud po push)
- `psql ... -c "select jobname from cron.job where jobname = 'hard_delete_expired_accounts';"` zwraca jeden wiersz (na cloud po push)

#### Manual Verification:

- W Supabase Studio → Database → Tables widoczna tabela `public.profiles`
- W Studio → Database → Functions widoczne 4 nowe funkcje z poprawnymi security modes
- W Studio → Database → Triggers widoczny `on_auth_user_created`
- Na cloud po `supabase db push`: `select * from cron.job` pokazuje wpis dla `hard_delete_expired_accounts`
- Ręczne `select public.execute_hard_delete();` w Studio SQL editor na cloud po insercie testowego wiersza z `scheduled_hard_delete_at = now() - interval '1 hour'` — usuwa wiersz, log w `cron.job_run_details` (jeśli wywołane przez scheduler) lub bezpośredni return count

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Delete/restore endpoints + signup guard

### Overview

Zbudować 2 API endpointy (`/api/account/delete`, `/api/account/restore`) oraz zmodyfikować `/api/auth/signup.ts` o guard blokujący re-signup na email w soft-delete window. Vitest per endpoint. Wszystko przez istniejący SSR anon client (`src/lib/supabase.ts`) — service_role NIE jest potrzebny: `email_pending_deletion` ma `grant execute to anon`, RPCs `enqueue_hard_delete` / `restore_account` używają SECURITY DEFINER lub SECURITY INVOKER + explicit `auth.uid()` check, a global signout to `supabase.auth.signOut({ scope: 'global' })` na SSR clencie (nie admin API).

### Changes Required:

#### 1. Account delete endpoint

**File**: `src/pages/api/account/delete.ts`

**Intent**: Zainicjować soft-delete: wywołać `enqueue_hard_delete(user.id)` przez SSR client (RLS + SECURITY DEFINER walidują ownership), unieważnić wszystkie sesje usera przez `supabase.auth.signOut({ scope: 'global' })` na tym samym SSR clencie (bearer JWT z cookie propaguje do GoTrue `/logout?scope=global` → wszystkie refresh tokeny zrewokowane), redirect na `/`. Zachować `prerender = false` (hard rule z AGENTS.md).

**Contract**: `POST` handler, `export const prerender = false`. Sekwencja: (1) `user = context.locals.user; if (!user) return jsonResponse(401,...)`, (2) `supabase = createClient(context.request.headers, context.cookies)`; if null → 500, (3) `const { error } = await supabase.rpc('enqueue_hard_delete', { p_user_id: user.id })`; error → 500 z log strukturowanym, (4) `const { error: sErr } = await supabase.auth.signOut({ scope: 'global' })` — errors log-only (best effort, RLS EXISTS gate i tak blokuje wszystko po soft-delete), (5) `return context.redirect('/', 303)`. Error path: redirect `/account?error=<encoded>` z Polish message.

#### 2. Account restore endpoint

**File**: `src/pages/api/account/restore.ts`

**Intent**: Wywołać `restore_account()` RPC przez SSR client; RPC jest SECURITY INVOKER i validuje `auth.uid()` wewnątrz. Po restore redirect na `/dashboard`.

**Contract**: `POST` handler, `export const prerender = false`. Sekwencja: (1) auth check (`context.locals.user`), (2) SSR client, (3) `const { error } = await supabase.rpc('restore_account')`; error → redirect `/auth/restore-account?error=<encoded>`, (4) `return context.redirect('/dashboard', 303)`.

#### 3. Signup guard (block re-signup on soft-deleted email)

**File**: `src/pages/api/auth/signup.ts`

**Intent**: Przed wywołaniem `supabase.auth.signUp()` sprawdzić przez SSR anon client czy podany email jest w soft-delete window. Jeśli tak, redirect `/auth/signup?error=account_pending_deletion` z komunikatem Polish + link do signin. Zachować istniejący pattern `?error=` (S-04 kompatybilny). Anon client wystarczy — `email_pending_deletion` ma `grant execute to anon` bo signup uruchamia się przed sesją.

**Contract**: Dodać pre-check PRZED istniejącym `supabase.auth.signUp()`: (1) `const supabase = createClient(context.request.headers, context.cookies); if (!supabase)` → istniejąca ścieżka error handling, (2) `const { data: pending, error: peErr } = await supabase.rpc('email_pending_deletion', { p_email: email })`, (3) if `peErr` — log + kontynuuj do standard signUp (fail-open akceptowalny bo RPC jest read-only), (4) if `pending === true`, redirect z error `account_pending_deletion`.

#### 4. Signup page — add error message

**File**: `src/pages/auth/signup.astro`

**Intent**: Rozszerzyć mapę komunikatów o `account_pending_deletion`. Komunikat: "Konto z tym mailem oczekuje na usunięcie. Zaloguj się aby je przywrócić w ciągu 30 dni." + link do `/auth/signin`.

**Contract**: Jedna nowa gałąź w istniejącym error handling (grep dla existing `error === '...'` w frontmatter lub w island). Text i link zgodne z pattern signin.astro `?error=`.

#### 5. Vitest tests — endpoints + guard

**File**: `src/pages/api/account/delete.test.ts`, `src/pages/api/account/restore.test.ts`, `src/pages/api/auth/signup.test.ts`

**Intent**: Coverage golden path + error path dla każdego endpointu. Pattern z `src/pages/api/cards.test.ts` (mocked context, typed mocked supabase client `SupabaseClient<Database>` — TypeScript wyłapie divergent sygnatury RPC / signOut).

**Contract**: Per plik ~4-6 test cases:

- `delete.test.ts`:
  - 401 gdy brak `context.locals.user`
  - 500 gdy `createClient()` zwraca null
  - 500 gdy `rpc('enqueue_hard_delete')` zwraca error
  - Golden: 303 redirect na `/` + zawołane RPC + `signOut({ scope: 'global' })` na SSR clencie
- `restore.test.ts`:
  - 401 gdy brak user
  - Golden: 303 redirect na `/dashboard` + zawołane RPC restore_account
  - Error redirect gdy RPC fail
- `signup.test.ts`:
  - `account_pending_deletion` redirect gdy `email_pending_deletion` returns true
  - Golden signup gdy email czysty
  - Fail-open: gdy RPC zwraca error, przechodzi do standard signUp

### Success Criteria:

#### Automated Verification:

- `npm run test` — vitest zielony, 3 nowe test files pass
- `npm run lint` — react-compiler + eslint OK
- `npm run build` — zielony
- `npm run astro sync` — bez zmian w env schema (nic nie dodajemy w Phase 2)

#### Manual Verification:

- `curl -X POST http://localhost:4321/api/account/delete -b "sb-...-auth-token=<cookie>"` → 303 redirect
- W Studio (cloud): `select deleted_at, scheduled_hard_delete_at from profiles where user_id = '<uuid>'` — oba pola set
- W Studio: `select * from auth.audit_log_entries where actor_id = '<uuid>' order by created_at desc limit 5` — widać event `logout` scope=global
- W Studio: `select count(*) from auth.refresh_tokens where user_id = '<uuid>' and revoked = false` = 0 (wszystkie refresh tokens revoked)
- `curl -X POST http://localhost:4321/api/auth/signup -d "email=<soft-deleted-email>&password=..."` → 302 redirect z `?error=account_pending_deletion`
- Cookie current usera z prev signin już nie działa (401 na `/api/cards`) w innej karcie

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Middleware gate + restore page + /account page + delete dialog + docs

### Overview

Wpiąć soft-delete gate w `src/middleware.ts` (dodatkowy select z profiles po `getUser()`), zbudować dwie nowe strony (`/auth/restore-account.astro`, `/account/index.astro`), zainstalować shadcn AlertDialog, zbudować `DeleteAccountDialog.tsx` island z type-to-confirm, wpiąć link "Konto" do Topbara, rozszerzyć README o retention flow + watchdog monitoring query.

### Changes Required:

#### 1. Middleware soft-delete gate

**File**: `src/middleware.ts`

**Intent**: Po `getUser()`, jeśli user istnieje, sprawdzić `profiles.deleted_at`. Jeśli != null i URL nie jest na whitelist ({`/auth/restore-account`, `/api/account/restore`, `/api/auth/signout`, `/auth/signin`, static assets}), redirect na `/auth/restore-account`. Whitelist musi obejmować drogę restore, żeby user w soft-delete state mógł ją wywołać.

**Contract**: Po istniejącym `supabase.auth.getUser()`, dodać: (1) if `context.locals.user`, `const { data: profile } = await supabase.from('profiles').select('deleted_at').eq('user_id', user.id).maybeSingle()`, (2) `if (profile?.deleted_at)` and URL nie jest na whitelist → `return context.redirect('/auth/restore-account')`. Whitelist jako `SOFT_DELETE_ALLOWED_PATHS = ['/auth/restore-account', '/auth/signin', '/api/account/restore', '/api/auth/signout']`; sprawdzać `pathname.startsWith(...)` po analogii do PROTECTED_ROUTES. Static assets (/`_astro/*`, /`favicon.ico`) middleware i tak przepuszcza (Astro internal).

#### 2. Restore account page

**File**: `src/pages/auth/restore-account.astro`

**Intent**: Strona pokazywana userowi w soft-delete state. Wymaga sesji (jeśli brak → redirect signin). Wyświetla maskowany email (`u***r@example.com`), datę scheduled_hard_delete_at, jednoprzyciskowy form POST do `/api/account/restore`. Obsługuje `?error=` z endpointu.

**Contract**: Frontmatter: (1) jeśli `Astro.locals.user` == null → redirect `/auth/signin`, (2) query profiles for `deleted_at` + `scheduled_hard_delete_at`; jeśli deleted_at == null → redirect `/dashboard` (już restored), (3) maskowanie emaila prostym pattern (`e[0] + '***' + '@' + domain`). Body: `<Layout>` + centered card z: tytuł "Twoje konto oczekuje na usunięcie", masked email, "Zostanie trwale usunięte {scheduled_hard_delete_at humanized in Polish}", opcjonalny error message ze `Astro.url.searchParams.get('error')`, form POST /api/account/restore z button "Przywróć konto". Link "Chcę pozostawić decyzję" wylogowuje przez POST `/api/auth/signout`.

#### 3. Account page (settings + danger zone)

**File**: `src/pages/account/index.astro`

**Intent**: Nowa protected route jako home dla ustawień konta. Pokazuje email, sekcję "Strefa niebezpieczna" z przyciskiem uruchamiającym AlertDialog. Pattern jak `/dashboard` z minimalnym layoutem — placeholder na przyszłe settings (change password, itd.).

**Contract**: Frontmatter: middleware już wymusza auth (dodać `/account` do `PROTECTED_ROUTES` w middleware.ts). Body: `<Layout title="Konto">` + sekcje: "Twój email: {user.email}", "Strefa niebezpieczna" (background red-tinted), przycisk "Usuń konto" opakowany w `<DeleteAccountDialog client:load userEmail={user.email} />`. Sekcje jako `<Card>` shadcn.

#### 4. Middleware PROTECTED_ROUTES extension

**File**: `src/middleware.ts`

**Intent**: Dodać `/account` do listy protected routes. Jedna linia edit.

**Contract**: `const PROTECTED_ROUTES = ["/dashboard", "/generate", "/review", "/deck", "/account"];`

#### 5. shadcn AlertDialog install

**File**: `src/components/ui/alert-dialog.tsx` + `package.json` dep add

**Intent**: `npx shadcn@latest add alert-dialog` — instaluje `@radix-ui/react-alert-dialog` + generuje wrapper. Jeśli emituje niekompatybilną z Tailwind 4 składnię, drobny patch (usunięcie deprecated variants).

**Contract**: Wygenerowany component eksportuje `AlertDialog`, `AlertDialogTrigger`, `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogFooter`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogAction`, `AlertDialogCancel`. Import via `@/components/ui/alert-dialog`.

#### 6. Delete account dialog (React island)

**File**: `src/components/account/DeleteAccountDialog.tsx`

**Intent**: Island uruchamiany z `/account/index.astro`. Zawiera Button "Usuń konto" jako AlertDialogTrigger. Dialog opisuje 30-day retention window, ma Input gdzie user musi wpisać dokładnie swój email. `AlertDialogAction` (submit) disabled dopóki input.value !== userEmail. Submit robi native form POST na `/api/account/delete` (nie fetch — spójny z resztą auth flow).

**Contract**: Props `{ userEmail: string }`. State `useState<string>('')` dla input. `const canSubmit = input === userEmail`. AlertDialog composition: Trigger = destructive Button "Usuń konto"; Content = Title "Usuń konto trwale", Description z tekstem retention (2-3 zdania: co się stanie, 30d retention, restore przez ponowne logowanie), Input z placeholder emaila, Cancel Button ("Anuluj"), Action (form) z method POST action="/api/account/delete", submit Button disabled przez canSubmit. Text Polish.

#### 7. Topbar link

**File**: `src/components/Topbar.astro`

**Intent**: Dodać link "Konto" między "Dashboard" a Sign out form.

**Contract**: Nowy `<a href="/account">Konto</a>` z tym samym stylem co "Dashboard" (dopasowanie klasy Tailwind).

#### 8. README documentation

**File**: `README.md`

**Intent**: Nowa sekcja "Retention & account deletion" opisująca: (1) 30-day soft-delete window, (2) dwa cron joby (`hard_delete_expired_accounts`, `retention_watchdog`), (3) gdzie szukać czerwonych statusów, (4) manual restore via Supabase Studio SQL editor jeśli user zablokowany.

**Contract**: Krótka sekcja (H2, ~20-30 linii): opis flow (user click delete → soft-delete + global signout → 30d window → cron hard-delete), następnie observability:

```
Monitoring:
  - Supabase Studio → Database → Cron Jobs → History
  - Green rows for `hard_delete_expired_accounts` (03:00 UTC daily) — normal.
  - Red row for `retention_watchdog` (04:00 UTC daily) = orphans >1d past cutoff.
    Investigate: `select * from public.profiles where scheduled_hard_delete_at
    < now() - interval '1 day'` → check `cron.job_run_details` for
    `hard_delete_expired_accounts` failures the previous day.

Ad-hoc query (manual double-check):
  select count(*) from public.profiles
  where scheduled_hard_delete_at is not null
    and scheduled_hard_delete_at < now() - interval '1 day';
  -- 0 = healthy; >0 = investigate as above.
```

+ krótkie note że watchdog jest fail-loud (RAISE EXCEPTION) więc czerwony job = konkretny sygnał, nie tylko licznik.

### Success Criteria:

#### Automated Verification:

- `npm run astro sync && npm run lint && npm run build` — zielone
- `npm run test` — istniejące i nowe testy z Phase 2 dalej zielone
- Vitest snapshot dla `DeleteAccountDialog.tsx` (opcjonalnie — jeśli pattern istnieje w S-03; pomijamy jeśli brak)

#### Manual Verification:

- Signin jako testowy user → widoczny link "Konto" w Topbar
- Klik "Konto" → strona z sekcją "Strefa niebezpieczna"
- Klik "Usuń konto" → AlertDialog otwiera się; submit disabled
- Wpisanie emaila w input → submit enabled; klik "Usuń konto" (submit) → redirect na `/`
- Powrót na aplikację (nowa karta z tym samym cookie) → redirect na `/auth/restore-account`
- Restore-account strona pokazuje masked email + scheduled_hard_delete_at
- Klik "Przywróć konto" → redirect na `/dashboard`, wszystkie fiszki widoczne (byte-identical)
- Ponowny signin w drugiej przeglądarce/incognito → strona restore-account (weryfikuje że global signout unieważnił JWT — jeśli user zmieni zdanie i chce się zalogować, musi się zalogować nowym cookie)
- Test signup guard: signout, próba signup na email soft-deleted usera → `?error=account_pending_deletion` widoczny w signup form
- Klik "Zaloguj się" → signin → restore → dashboard
- SQL na cloud po manualnym insert profiles wiersza z `scheduled_hard_delete_at = now() - interval '1 hour'` + wywołanie `select execute_hard_delete()`: user usunięty z auth.users, cards + review_history zerowane przez cascade

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `src/pages/api/account/delete.test.ts` — 4-6 cases (auth, RPC error, admin.signOut fail-graceful, golden)
- `src/pages/api/account/restore.test.ts` — 3-4 cases (auth, RPC error, golden)
- `src/pages/api/auth/signup.test.ts` — 3-4 cases (guard blocks re-signup, guard fail-open, golden pass-through)

Pattern z `src/pages/api/cards.test.ts` (vi.mock supabase clients, factory dla `context.locals.user`).

### Integration Tests:

pgTAP suite w `supabase/tests/rls.test.sql` rozszerzony o ~14-16 asercji (soft-delete gate + retention functions + trigger). Uruchamiany przez `supabase test db`. Symulacja retention window przez insert wierszy z `scheduled_hard_delete_at` w przeszłości/przyszłości — `now()` nie mockujemy, tylko dane.

### Manual Testing Steps:

1. `supabase db reset` — migracja aplikuje się czysto
2. `supabase test db` — wszystkie asercje ok
3. `npm run db:types` — regeneracja czysta
4. `npm run test` — vitest zielony
5. `npm run astro sync && npm run lint && npm run build` — zielone
6. `supabase db push` do cloud project — nowa migracja + `cron.schedule` widoczne w cloud Studio
7. `npm run dev` — signin jako user A → /account → delete flow → restore flow (full e2e)
8. Signout + próba signup na email userA → widzi `account_pending_deletion` błąd
9. Signin userA → restore-account → restore → dashboard (fiszki wracają)
10. Manual w cloud SQL: `update profiles set scheduled_hard_delete_at = now() - interval '1 hour' where user_id = '<userA>'; select public.execute_hard_delete();` → user zniknął z auth.users, cards + review_history wyczyszczone przez cascade
11. Watchdog query po każdym tygodniu w prod (`select count(*) from profiles where scheduled_hard_delete_at < now() - interval '1 day'`) — powinno być 0

## Performance Considerations

- **Middleware +1 DB query per request**: `.select('deleted_at').eq('user_id', user.id).maybeSingle()` — index na profiles PK, hit sub-ms. Cloudflare Workers RTT do Supabase 20-40ms dominuje. Fires per KAŻDY authenticated request — nie tylko `/dashboard/generate/review/deck/account`, ale też `/api/generate` (PRD Guardrail p95 < 30s dla OpenRouter call). Dodatkowe 20-40ms mieści się w budżecie 30s bez marginesu problemowego. Optymalizacja (JWT custom claim `deleted_at` w app_metadata unikające DB hit) deferred do post-MVP — Supabase JWT customization nietrywialne i nie na budget MVP.
- **RLS EXISTS gate w hot path (cards SELECT)**: partial index `profiles_user_alive_idx (user_id) where deleted_at is null` daje index-only scan; planner uses `index_scan` — kilku us. Zero-cost przy skalowaniu.
- **pg_cron job daily 03:00 UTC**: mały load; execute_hard_delete używa index na profiles.scheduled_hard_delete_at (dodać jeśli >100k userów w przyszłości).
- **admin.signOut('global')**: Supabase revokes refresh tokens — I/O bound, ~50-200ms. Nie blocking dla usera bo redirect na `/` i tak wywalił się z sesji.

## Migration Notes

- **Kolejność w migracji**: (1) create profiles + trigger, (2) backfill wszystkich `auth.users` do profiles, (3) DROP + CREATE 6 policies z EXISTS gate, (4) CREATE functions, (5) CREATE cron.schedule.
- **Rollback**: Supabase CLI nie generuje automated `.down`. Jeśli trzeba revert po Phase 1, utwórz nową migrację `<ts>_revert_soft_delete_and_retention.sql` z poniższym blokiem SQL (przekopiowanym z F-01, patrz `supabase/migrations/20260707200908_initial_schema.sql:79-129` dla oryginalnych 6 policies):

```sql
-- 1. Unschedule crons
select cron.unschedule('hard_delete_expired_accounts');
select cron.unschedule('retention_watchdog');

-- 2. Drop functions (order matters — dependents first)
drop function if exists public.retention_watchdog();
drop function if exists public.execute_hard_delete();
drop function if exists public.restore_account();
drop function if exists public.enqueue_hard_delete(uuid);
drop function if exists public.email_pending_deletion(text);

-- 3. Drop trigger + handler
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

-- 4. Revert RLS policies on cards + review_history to F-01 shape
drop policy if exists cards_select_own on public.cards;
drop policy if exists cards_insert_own on public.cards;
drop policy if exists cards_update_own on public.cards;
drop policy if exists cards_delete_own on public.cards;
drop policy if exists review_history_select_own on public.review_history;
drop policy if exists review_history_insert_own on public.review_history;

create policy cards_select_own on public.cards for select to authenticated using (auth.uid() = user_id);
create policy cards_insert_own on public.cards for insert to authenticated with check (auth.uid() = user_id);
create policy cards_update_own on public.cards for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy cards_delete_own on public.cards for delete to authenticated using (auth.uid() = user_id);
create policy review_history_select_own on public.review_history for select to authenticated using (auth.uid() = user_id);
create policy review_history_insert_own on public.review_history for insert to authenticated with check (auth.uid() = user_id);

-- 5. Drop profiles table (cascade removes partial index + grants)
drop table if exists public.profiles cascade;

-- 6. Optional: keep pg_cron extension (used only by S-05; drop only if no other migration depends)
-- drop extension if exists pg_cron;
```

Note: revert po Phase 2/3 wymaga dodatkowo `git revert` na plikach `src/pages/api/account/*`, `src/pages/auth/restore-account.astro`, `src/pages/account/*`, `src/components/account/*`, `src/components/ui/alert-dialog.tsx`, edycji `src/middleware.ts`, `src/components/Topbar.astro`, README.md.
- **Cloud vs local**: pg_cron dispatcher w Supabase Cloud działa domyślnie po enable extension. Local Docker image może nie odpalać jobów — testy funkcji direct call w pgTAP, cron schedule verified manualnie na cloud po push.
- **Istniejący userzy w cloud DB (po S-01/S-02 testach manualnych)**: backfill w migracji dodaje profiles row per user — bez tego kroku każdy istniejący user natychmiast trafia w EXISTS gate = 0 → redirect na /auth/restore-account. Kolejność w migracji krytyczna.

## References

- Roadmap S-05: `context/foundation/roadmap.md:133-144`
- PRD Access Control (single-tenant per user): `context/foundation/prd.md:141-146`
- PRD NFR Privacy: `context/foundation/prd.md:126`
- F-01 schemat i RLS pattern: `context/archive/2026-07-07-data-schema-and-rls/plan.md`
- F-01 pgTAP pattern: `supabase/tests/rls.test.sql`
- S-02 SECURITY INVOKER RPC pattern: `supabase/migrations/20260709120000_fsrs_state_and_review_log.sql:106-164`
- S-04 auth `?error=` pattern: `context/changes/password-reset-flow/plan-brief.md`
- AGENTS.md hard rule (policies w migration z CREATE TABLE): `AGENTS.md`
- Cloudflare Workers Cron Triggers docs (context7): reference dla `wrangler.jsonc.triggers.crons` — NOT USED w tym slice, but zachowane dla przyszłej alternatywy
- Supabase admin.signOut docs (context7): reference dla globalnego unieważnienia refresh tokens
- Existing DELETE cascade pattern: `supabase/migrations/20260707200908_initial_schema.sql:22,33`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Schema migration + RLS gates + pg_cron + tests

#### Automated

- [x] 1.1 `supabase db reset` bez błędów — 8233ef1
- [x] 1.2 `supabase db lint --level warning` bez warningów o RLS na profiles — 8233ef1
- [x] 1.3 `supabase test db` — exit 0, ~36-38 asercji ok — 8233ef1
- [x] 1.4 `npm run db:types` regeneracja bez błędów; drugi run pusty diff — 8233ef1
- [x] 1.5 `npm run astro sync && npm run lint && npm run build` zielone — 8233ef1
- [x] 1.6 Na cloud: `select extname from pg_extension where extname = 'pg_cron'` zwraca wiersz — 8233ef1
- [x] 1.7 Na cloud: `select jobname from cron.job where jobname in ('hard_delete_expired_accounts','retention_watchdog')` zwraca 2 wiersze — 8233ef1

#### Manual

- [x] 1.8 W Studio widoczna tabela `public.profiles` — 8233ef1
- [x] 1.9 W Studio widocznych 5 nowych funkcji z poprawnymi security modes (enqueue/restore/execute/watchdog/email_pending) — 8233ef1
- [x] 1.10 W Studio widoczny trigger `on_auth_user_created` — 8233ef1
- [x] 1.11 Na cloud: `select * from cron.job` pokazuje oba joby — 8233ef1
- [x] 1.12 Ręczne wywołanie `select public.execute_hard_delete()` na cloud po insercie testowego wiersza usuwa wiersz — 8233ef1
- [x] 1.13 Ręczne wywołanie `select public.retention_watchdog()` na cloud z orphanem >1d — exception (fail-loud); bez orphanów — clean run — 8233ef1

### Phase 2: Delete/restore endpoints + signup guard

#### Automated

- [x] 2.1 `npm run test` — 3 nowe test files pass — 763854d
- [x] 2.2 `npm run lint` OK — 763854d
- [x] 2.3 `npm run build` zielony — 763854d
- [x] 2.4 `npm run astro sync` — bez zmian w env schema — 763854d

#### Manual

- [x] 2.5 `curl POST /api/account/delete` z valid cookie → 303 redirect — 763854d
- [x] 2.6 W Studio: `select deleted_at, scheduled_hard_delete_at from profiles where user_id=<uuid>` — oba set — 763854d
- [x] 2.7 W Studio: `select * from auth.audit_log_entries where actor_id = '<uuid>'` — widać logout scope=global — 763854d
- [x] 2.8 W Studio: `select count(*) from auth.refresh_tokens where user_id='<uuid>' and revoked=false` = 0 — 763854d
- [x] 2.9 `curl POST /api/auth/signup` z soft-deleted emailem → redirect z `?error=account_pending_deletion` — 763854d
- [x] 2.10 Cookie current usera po delete już nie działa (401 na `/api/cards`) w innej karcie — 763854d

### Phase 3: Middleware gate + restore page + /account page + delete dialog + docs

#### Automated

- [x] 3.1 `npm run astro sync && npm run lint && npm run build` zielone
- [x] 3.2 `npm run test` — istniejące + Phase 2 testy dalej zielone

#### Manual

- [x] 3.3 Signin jako user → widoczny link "Konto" w Topbar
- [x] 3.4 `/account` renderuje sekcję "Strefa niebezpieczna"
- [x] 3.5 AlertDialog otwiera się; submit disabled dopóki input != email
- [x] 3.6 Po delete: nowa karta z tym samym cookie → redirect `/auth/restore-account`
- [x] 3.7 Restore-account strona pokazuje masked email + scheduled_hard_delete_at
- [x] 3.8 Klik "Przywróć konto" → `/dashboard`, wszystkie fiszki widoczne (byte-identical)
- [x] 3.9 Signout + signup na email userA → `?error=account_pending_deletion` widoczny
- [x] 3.10 Signin userA → restore-account → restore → dashboard
- [x] 3.11 SQL na cloud: manual `execute_hard_delete()` po backdate `scheduled_hard_delete_at` → user zniknął z auth.users; cards + review_history wyczyszczone przez cascade
- [x] 3.12 Watchdog query zwraca 0 w steady state
