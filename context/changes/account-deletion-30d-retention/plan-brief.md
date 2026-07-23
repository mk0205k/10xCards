# Usunięcie konta z 30-dniową retencją (S-05) — Plan Brief

> Full plan: `context/changes/account-deletion-30d-retention/plan.md`

## What & Why

Roadmap S-05: user powinien móc usunąć konto z 30-dniowym oknem retencji (soft-delete → restore w oknie → hard-delete po 30 dniach). Bez tego produkt łamie Privacy NFR — nie ma sposobu na "prawo do usunięcia", a przypadkowy klik "usuń konto" byłby nieodwracalny. Slice zamyka roadmap Open Questions S-05 (mechanizm hard-delete + zachowanie re-signup w oknie) i wprowadza first-class kontrolę usera nad własnym kontem.

## Starting Point

F-01 dostarczyło schemat (`cards`, `review_history`) z FK `on delete cascade` do `auth.users` — hard-delete usera w naturalny sposób wyczyści dane, ale brak soft-delete state. S-02/S-03 dodały FSRS state + CRUD (S-03 `implementing`), oba scoping przez RLS `auth.uid() = user_id`. Auth surface (`signin`, `signup`, `signout`, middleware z `context.locals.user`) działa, ale brak service-role klienta, brak stron settings/account, brak Cloudflare cron ani pg_cron. `Topbar.astro` ma tylko "Dashboard" + Sign out. Brak zainstalowanego shadcn Dialog/AlertDialog.

## Desired End State

Zalogowany user może w `/account` uruchomić destructive AlertDialog z type-to-confirm email; klik "Usuń" zapisuje `profiles.deleted_at = now()` + `scheduled_hard_delete_at = now() + 30d`, wywołuje `supabase.auth.signOut({ scope: 'global' })` na SSR clencie (jego cookie JWT propaguje do GoTrue `/logout?scope=global` → wszystkie refresh tokeny tego usera zrewokowane, current cookie też). RLS EXISTS gate w policies cards + review_history natychmiast blokuje ten user's data. Powtórny signin uruchamia middleware gate → `/auth/restore-account` z przyciskiem "Przywróć konto" wywołującym RPC `restore_account()` (klaruje oba pola, user wraca do dashboardu z byte-identical fiszkami). Signup na email w soft-delete window zwraca `?error=account_pending_deletion` z Polish komunikatem. Codziennie 03:00 UTC `pg_cron` wywołuje `execute_hard_delete()` który kasuje `auth.users` gdzie `scheduled_hard_delete_at <= now()` — CASCADE odpala `cards`, `review_history`, `profiles`. Watchdog query `select count(*) from profiles where scheduled_hard_delete_at < now() - interval '1 day'` udokumentowana w README dla wykrycia cichego fail cronu.

## Key Decisions Made

| Decision                                             | Choice                                                                                    | Why (1 sentence)                                                                                                                        | Source |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Mechanizm hard-delete (roadmap Open Q1)              | `pg_cron` w Supabase + SECURITY DEFINER `execute_hard_delete()`                          | Zero nowej infry w Cloudflare; atomowo w tym samym silniku co dane; `cron.job_run_details` daje built-in observability.                 | Plan   |
| Zachowanie re-signup w oknie 30d (roadmap Open Q2)   | Blokada + hint do restore (`?error=account_pending_deletion` + link do signin)           | Jasna semantyka; user zawsze wie co się dzieje; brak accidental data loss przez nowe konto na tym samym mailu.                          | Plan   |
| Kształt danych soft-delete                           | Nowa `public.profiles (user_id PK/FK, deleted_at, scheduled_hard_delete_at, created_at)` | Nie ruszamy Supabase-managed `auth.users`; jeden punkt prawdy o retention; pattern testowalny w pgTAP; RLS EXISTS gate z partial index. | Plan   |
| Restore flow UX                                      | Signin uruchamia middleware gate → `/auth/restore-account` z jednym przyciskiem confirm  | Password auth wystarczy jako proof-of-identity; brak email token overhead; user friction proporcjonalny do "usuwam własne konto".        | Plan   |
| RLS interaction z soft-delete                        | `EXISTS(profiles WHERE deleted_at IS NULL)` gate w każdej z 6 policies cards + review_history | RLS to jedyny miejsce prawdy; middleware sam by nie wystarczył (nowy endpoint mógłby zapomnieć checkować).                               | Plan   |
| Service-role handling                                | Nie wprowadzamy — używamy SSR anon client + `signOut({scope:'global'})` + RPCs z SECURITY DEFINER | Weryfikacja SDK v2.99: `admin.signOut(jwt, scope)` przyjmuje JWT (nie userId); SSR client ma JWT z cookie, więc scope='global' unieważnia wszystkie sesje; `email_pending_deletion` ma grant do anon. Service_role byłby nadmiarowy. | Plan (F1 review) |
| Cron function scope                                  | `delete from auth.users where ... in soft-delete` — CASCADE robi resztę                  | Polega na istniejącym FK cascade z F-01; brak dublowania kaskady w JS; jeden atomowy DELETE per user.                                    | Plan   |
| Entry point "usuń konto"                             | Nowa strona `/account` + link "Konto" w Topbar                                            | Skalowalne na przyszłe settings (change password, itp.); pattern "settings + danger zone" znany.                                         | Plan   |
| Confirm pattern                                      | AlertDialog + type-to-confirm email                                                       | Standard destructive-action UX; wymusza intent; zero nowego bezpieczeństwa (auth cookie już weryfikuje user).                             | Plan   |
| Session invalidation przy delete                     | `supabase.auth.signOut({ scope: 'global' })` na SSR clencie (jedno wywołanie)             | Bearer JWT z cookie → POST `/logout?scope=global` → GoTrue kasuje wszystkie refresh_tokens dla user_id + current session; audit w `auth.audit_log_entries`. | Plan (F1 review) |
| Migration strategy                                   | Jeden plik `<ts>_soft_delete_and_retention.sql` (schema + backfill + policies + fn + cron) | Atomowo; jeden PR = jeden version bump; AGENTS.md hard rule (policies w tej samej migracji co CREATE TABLE) respektowany.                | Plan   |
| Cron cadence + monitoring                            | Dwa joby: `hard_delete_expired_accounts` @03:00 UTC + `retention_watchdog` @04:00 UTC z RAISE EXCEPTION gdy orphan >1d | Domyka roadmap Risk explicit "observability alert" bez zewnętrznej infry — czerwony status watchdog job'a w Supabase Studio to fail-loud signal. | Plan (F2 review) |
| Testing scope                                        | pgTAP schema/RLS/cron + vitest API endpoints + manual smoke                              | Cron cichy fail = najgorsza klasa bug'a; roadmap Risk wprost wymaga automated test izolacji analogicznie do F-01.                        | Plan   |

## Scope

**In scope:**

- Migracja SQL: `profiles` + trigger + backfill + zaktualizowane RLS + 4 funkcje + `cron.schedule`
- pgTAP rozszerzenie o soft-delete gate + retention functions + trigger auto-insert (~14-16 asercji)
- Regenerated `src/db/database.types.ts`
- API: `POST /api/account/delete`, `POST /api/account/restore`; signup guard na re-signup (wszystko przez istniejący SSR anon client — service_role NIE wprowadzamy)
- Vitest dla 3 endpointów (delete, restore, signup guard)
- Middleware soft-delete gate + `/account` w `PROTECTED_ROUTES`
- Strony: `/auth/restore-account.astro`, `/account/index.astro`
- shadcn `alert-dialog` install + `DeleteAccountDialog.tsx` island z type-to-confirm
- Link "Konto" w Topbar
- README: sekcja retention + watchdog query

**Out of scope:**

- GDPR data export (portability) — poza roadmap S-05
- Audit log `account_events` — S-06 territory
- Custom-branded email potwierdzający soft-delete — signin restore wystarczy
- Turnstile/CAPTCHA na delete — type-to-confirm + protected route wystarczą
- Read-only session w oknie 30d — decyzja "signin tylko do restore"
- Automated alert email przy watchdog >0 — tylko dokumentacja query
- Reauthentication (re-enter password przy delete) — type-to-confirm wystarczy
- Flip `SUPABASE_URL`/`SUPABASE_KEY` z `optional` na required — scope discipline
- Zmiany w `/api/cards/[card_id]` DELETE (S-03) — S-05 nie tyka per-card

## Architecture / Approach

Trzy fazy sekwencyjne. **Faza 1** — cała warstwa DB w jednej migracji (profiles + trigger + backfill + 6 policies z EXISTS gate + 4 SECURITY DEFINER/INVOKER funkcje + `cron.schedule`) + rozszerzona pgTAP suite. **Faza 2** — endpointy `/api/account/{delete,restore}` + signup guard blokujący re-signup na soft-deleted email, wszystko przez istniejący SSR anon client, vitest per endpoint. **Faza 3** — middleware soft-delete gate (dodatkowy select z profiles), `/auth/restore-account.astro`, `/account/index.astro`, shadcn `alert-dialog` install + `DeleteAccountDialog.tsx` z type-to-confirm, Topbar link, README docs.

Kluczowe: RLS `EXISTS(profiles WHERE deleted_at IS NULL)` gate jest single source of truth — middleware to UX gate, RLS to security gate. `supabase.auth.signOut({ scope: 'global' })` na SSR clencie (nie admin API — SDK v2.99's `admin.signOut(jwt, scope)` wymaga JWT który SSR ma z cookie) wywoływane PO commit w DB. Local Supabase pg_cron dispatcher OFF — cron function testujemy przez direct call w pgTAP; scheduled trigger weryfikowany manualnie na cloud po `supabase db push`.

## Phases at a Glance

| Phase                                                       | What it delivers                                                                                                    | Key risk                                                                                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Schema + RLS + pg_cron + tests                           | Migracja atomowa; profiles; zaktualizowane 6 policies; 4 funkcje; cron.schedule; ~34-36 asercji pgTAP.              | Brak backfill dla istniejących userów → wszyscy natychmiast trafiają w EXISTS gate = 0 → redirect na restore-account (100% breakage).        |
| 2. Backend endpoints + signup guard                         | 2 endpointy (delete, restore) + signup guard, wszystko przez istniejący SSR anon client + vitest coverage.        | Race window (~1s) między commit soft-delete a global signout — RLS EXISTS gate blokuje w międzyczasie, więc akceptowalne.                    |
| 3. Middleware gate + strony + AlertDialog + docs            | Middleware soft-delete gate; 2 strony; AlertDialog install + type-to-confirm island; Topbar link; README docs.     | AlertDialog install pod Tailwind 4 może emitować niekompatybilną składnię (S-03 open risk); rozwiązanie manual patch po install.              |

**Prerequisites:** F-01 (schemat + RLS + typed client), S-01 (POST cards), S-02 (FSRS + review), S-03 (deck CRUD — nie hard dep, ale w toku; nie kolidują). Cloud Supabase project z `pg_cron` extension whitelistowanym.

**Estimated effort:** ~2-3 sesje. Phase 1 najcięższa (~1 sesja — SQL + pgTAP + manual test na cloud), Phase 2 mała (~0.5 sesja — 2 endpointy + guard + vitest; brak nowej infry), Phase 3 średnia (~1 sesja — 2 strony + AlertDialog install + Topbar + README + e2e manual test).

## Open Risks & Assumptions

- **Assumption**: Supabase Cloud whitelistuje `pg_cron` extension bez extra ticketa (potwierdzone dla większości projektów; jeśli nie — fallback na Cloudflare scheduled Worker via wrangler `triggers.crons`, wymaga tylko wrappera Astro entrypointu).
- **Verified**: SSR client's `supabase.auth.signOut({ scope: 'global' })` w SDK v2.99 propaguje scope przez `POST /logout?scope=global` z Bearer JWT z cookie — Postgres `auth.refresh_tokens` sesji tego usera są kasowane, current cookie się flushuje. Nie wymaga service_role klienta. (Ustalone w plan-review F1.)
- **Risk**: shadcn `alert-dialog` install pod Tailwind 4 może wymagać manual patch (S-03 open risk potwierdza — dialog + input mogły potrzebować drobnych zmian). Mitigation: install w Phase 3 z pinned Radix version.
- **Risk**: pg_cron w local Supabase może nie odpalać jobów (dispatcher OFF w local Docker). Mitigation: cron behavior weryfikowany na cloud po push; pgTAP testuje function directly. Ustalona asymetria dla MVP.
- **Risk**: Podczas migracji (backfill + policy DROP+CREATE) występuje krótkie okno (<100ms w typowej DB) gdy stare policies zniknęły a nowe jeszcze nie wprowadzone — wszystkie queries do cards/review_history są w tym momencie zablokowane. Akceptowalne dla MVP bez live traffic; Supabase CLI opakowuje migrację w BEGIN/COMMIT, więc DDL widoczne dopiero po commit.

## Success Criteria (Summary)

- User klika "Usuń konto" w `/account`, wpisuje email w AlertDialog, potwierdza — konto natychmiast staje się niedostępne we wszystkich kartach/urządzeniach (global signout + RLS gate); redirect na `/`.
- Ponowny signin w oknie 30d → automatyczny redirect na `/auth/restore-account` z widocznym scheduled_hard_delete_at; klik "Przywróć" → dashboard z byte-identical fiszkami i historią review.
- Signup na email soft-deleted usera zwraca komunikat "Konto oczekuje na usunięcie" z linkiem do signin — nowe konto NIE powstaje w oknie.
- Po 30 dniach `pg_cron` codziennie o 03:00 UTC wywołuje `execute_hard_delete()` — user nieodwracalnie usunięty z `auth.users`, wszystkie `cards`/`review_history`/`profiles` wyczyszczone przez cascade. Watchdog query zwraca 0 wierszy w steady state.
- pgTAP suite (~34-36 asercji) zielone; user B nie widzi wierszy user A po soft-delete (roadmap Risk mitigation domknięty analogicznie do F-01).
