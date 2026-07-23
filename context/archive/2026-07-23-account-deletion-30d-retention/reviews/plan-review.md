<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Usunięcie konta z 30-dniową retencją (S-05)

- **Plan**: `context/changes/account-deletion-30d-retention/plan.md`
- **Mode**: Deep
- **Date**: 2026-07-23
- **Verdict**: REVISE → SOUND (po triage: F1/F2/F3/F4/F5/F6 wszystkie FIXED)
- **Findings**: 1 critical  2 warnings  2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING (blocked by F1) |
| Lean Execution | FAIL (F1) |
| Architectural Fitness | WARNING (F1) |
| Blind Spots | WARNING (F2) |
| Plan Completeness | WARNING (F3, F4) |

## Grounding

Grounding: 6/6 paths ✓ (`src/middleware.ts`, `src/lib/supabase.ts`, `src/components/Topbar.astro`, `astro.config.mjs`, `supabase/tests/rls.test.sql`, `.dev.vars.example`), 3/3 symbols ✓ (`@supabase/ssr`, `@supabase/supabase-js` v2.99.1, no existing admin API usage), brief↔plan ✓ (12 decisions, 3 phases, scope matches).

## Findings

### F1 — admin.signOut(user_id, 'global') to zła sygnatura; service_role klient nie jest w ogóle potrzebny

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — refactor spans Phase 2 (env + factory + endpoint call)
- **Dimension**: Lean Execution / End-State Alignment
- **Location**: Phase 2 — Admin client + delete endpoint; plan.md Critical Details
- **Detail**: Plan Phase 2 point (5) opisuje `await admin.auth.admin.signOut(user.id, 'global')`. Faktyczna sygnatura w @supabase/supabase-js v2.99: `admin.signOut(jwt: string, scope: SignOutScope)` — pierwszy parametr to JWT usera (Bearer token), nie UUID (patrz `supabase-js/packages/core/auth-js/src/GoTrueAdminApi.ts`). Przekazanie user.id jako jwt → 401 lub silent no-op. GoTrue /logout wywołuje getUser(ctx) z Bearer tokenu, nie z parametru URL. Głębszy skutek: cała warstwa service_role jest zbędna — `email_pending_deletion(text)` już ma `grant execute to anon` (SSR anon może wywołać z signup endpointu bez service_role), `execute_hard_delete()` uruchamiane przez pg_cron jako superuser w DB (nie potrzebuje JS-side klienta), global signout: SSR client MA sesję usera i `supabase.auth.signOut({ scope: 'global' })` na SSR clencie unieważnia wszystkie refresh tokeny.
- **Fix A ⭐ Recommended**: Drop admin client — użyj SSR client's signOut({scope:'global'})
  - Approach: Usuń Phase 2 point (1) env schema, (2) .dev.vars.example entry, (3) src/lib/supabase-admin.ts, (4) fallback w signup guard ("if admin null"). W /api/account/delete zmień call na `await supabase.auth.signOut({ scope: 'global' })` po wywołaniu RPC enqueue_hard_delete. Signup guard używa istniejącego SSR client do rpc('email_pending_deletion').
  - Strength: Zero nowego secretu (żaden risk leak service_role); mniej infry (0 nowych plików w src/lib); zgodne z udokumentowanym API SDK v2.99; jeden JWT propaguje scope='global' do GoTrue który sam iteruje sessions.
  - Tradeoff: Bez admin klienta brak paths dla przyszłych admin cleanup other-user operacji (out-of-scope teraz).
  - Confidence: HIGH — udokumentowana ścieżka w Supabase docs "Sign Out with Scopes"; nie wymaga nowego packagu.
  - Blind spot: SSR client's signOut wymaga ważnego JWT — po `getUser()` w middleware wiemy że JWT ważny. Weryfikacja że session cookie flushuje się na Astro redirect Response.
- **Fix B**: Zachowaj admin client dla admin.signOut(jwt, 'global') ale wyciągnij JWT z SSR session
  - Approach: Przed admin.signOut, `const { data: { session } } = await supabase.auth.getSession()`, przekaż `session.access_token` jako jwt do admin.signOut.
  - Strength: Zachowuje pattern "admin czynności przez service_role"; audit log ma actor=service.
  - Tradeoff: 3x więcej kodu; utrzymuje niepotrzebny secret w prod; audit-value niewielki bo user sam wywołał /account/delete.
  - Confidence: MEDIUM — API dostępne, ale wymaga jeszcze 1 wywołania (getSession) na hot path.
  - Blind spot: getSession vs getUser rozróżnienie — session może być odświeżona i nie mieć current access_token.
- **Decision**: FIXED via Fix A (plan.md Phase 2 przepisane bez service_role; plan-brief.md Decisions/Scope/Risks zaktualizowane)

### F2 — Watchdog tylko manualny; roadmap Risk explicite wymaga automated signal

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 — README docs; plan.md Out of Scope
- **Detail**: Roadmap S-05 Risk (`context/foundation/roadmap.md:143`): "Ryzyko mitiguje: idempotent hard-delete job z observability alertem gdy licznik soft-deleted starszych niż 30d rośnie". Plan deferuje automated alert do "MVP tylko dokumentacja query". To przeciwieństwo zaplanowanego mitigation: cichy fail cronu → dane wiszą w nieskończoność → compliance risk BEZ zewnętrznego sygnału. Watchdog query "manualny" jest tym samym failure mode co "manual runbook" odrzucony w rundzie 1 questioningu.
- **Fix ⭐ Recommended**: Self-reporting execute_hard_delete + drugi cron alertujący via RAISE WARNING
  - Approach: (a) `execute_hard_delete()` na końcu dodaje: `if exists(select 1 from profiles where scheduled_hard_delete_at < now() - interval '1 day') then raise warning 'retention overdue: % rows', count; end if;` — WARNING pojawi się w `cron.job_run_details` jako fail-loud sygnał. (b) Osobny cron `retention_watchdog` co 24h wywołuje pure-query function która raise'uje EXCEPTION gdy count>0 — cron job history pokaże czerwony status w Supabase Studio.
  - Strength: Zero nowej infry poza pgSQL; sygnał widoczny w tym samym miejscu co legit runs; domyka roadmap Risk paragraph bez rozszerzania scope; koszt ~15 linii SQL w tej samej migracji.
  - Tradeoff: Alert wymaga że ktoś zagląda w Studio (bez email/Slack push). Pełny e-mail alert = pg_net + external webhook, poza scope MVP.
  - Confidence: HIGH — Postgres `raise warning` w function daje status entry w pg_cron; `job_run_details.return_message` jest sortowalne w Studio.
  - Blind spot: Retention >30d w naturalnym flow (bo cron pojawia się CO 24h) — pierwsza detekcja może być na 31 dniu, nie 30. Acceptable.
- **Decision**: FIXED via Fix (plan.md: dodane `retention_watchdog()` SECURITY DEFINER, drugi cron `retention_watchdog` @ 04:00 UTC, RAISE WARNING w execute_hard_delete; pgTAP fail-loud asercji; Progress 1.13; README opisuje red job = signal)

### F3 — pgTAP JWT claim pattern w planie diverguje od istniejącego wzorca

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — Contract dla pgTAP (plan.md "Style i konwencja")
- **Detail**: Plan pisze: "pattern: `set local role authenticated; set local request.jwt.claim.sub = '<uuid>'`". Faktyczny działający pattern w `supabase/tests/rls.test.sql:40-41` to JSON-object form: `set local request.jwt.claims to '{"sub":"...", "role":"authenticated"}'`. Wariant single-claim `.jwt.claim.sub` bywa niekompatybilny z PostgREST 9+/GoTrue. Implementer kopiujący plan literalnie może dostać RLS pass-through gdy claim nie jest widoczny.
- **Fix**: Poprawić w plan.md pgTAP Contract na `set local request.jwt.claims to '{"sub":"...", "role":"authenticated"}'` — dokładnie jak w istniejącym `rls.test.sql:41`.
- **Decision**: FIXED (plan.md 2 miejsca: Style i konwencja + Implementation Approach reference)

### F4 — Migration rollback tylko prozą — brak konkretnej revert-migration file lub SQL block

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; add rollback runbook section
- **Dimension**: Plan Completeness
- **Location**: plan.md Migration Notes
- **Detail**: Migration Notes wymienia kroki rollback prozą ale nie daje gotowego SQL do revert. Jeśli po Phase 1 wykryty jest problem, implementer musi z pamięci odbudować DROP POLICY + CREATE POLICY z F-01. Supabase CLI nie generuje automated .down.
- **Fix**: Dodaj do Migration Notes explicit SQL snippet dla `<ts>_revert_soft_delete.sql`: `select cron.unschedule(...); drop function...; drop trigger...; drop table public.profiles cascade;` + `-- restore F-01 policies` (przekopiuj z `supabase/migrations/20260707200908_initial_schema.sql:79-129`).
- **Decision**: FIXED (plan.md Migration Notes → pełny SQL block: unschedule 2 crony, drop 6 functions, drop trigger + handler, revert 6 F-01 policies verbatim, drop table cascade, note o revert Phase 2/3 przez git revert)

### F5 — Middleware +1 DB roundtrip też uderza w /api/generate hot path

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — accepted tradeoff; just make explicit
- **Dimension**: Blind Spots
- **Location**: Phase 3 — Middleware soft-delete gate
- **Detail**: Middleware fires dla WSZYSTKICH requestów gdzie context.locals.user != null (bo `getUser()` już zrobiony wcześniej). Dotyczy to nie tylko /dashboard/generate/review/deck/account, ale też /api/generate — endpoint z PRD Guardrail p95 < 30s. Dodatkowe 20-40ms RTT do Supabase Cloud — mieści się w 30s budgecie, ale powinno być explicite.
- **Fix**: Dodaj do Performance Considerations: "Middleware +1 roundtrip fires per authenticated request including /api/generate; acceptable within 30s Guardrail budget; optimization (JWT custom claim `deleted_at`) deferred to post-MVP."
- **Decision**: FIXED (plan.md Performance Considerations rozszerzone o `/api/generate` mention + JWT custom claim optymalizacja jako post-MVP)

### F6 — Vitest mock dla admin.signOut przetestuje wrong signature happy path

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — bundled with F1; if F1 fixed this evaporates
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — delete.test.ts
- **Detail**: Plan mockuje admin client z mock.calls patternem `admin.signOut(user.id, 'global')`. Test przejdzie zielony bo mock nie waliduje sygnatury vs real SDK types. Jeśli F1 nie fixed, vitest zielony przy prod broken.
- **Fix**: Bundled z F1 — po fix F1 użyć typed `SupabaseClient` z generic `<Database>` w mock, TypeScript wyłapie mismatch przy compile.
- **Decision**: FIXED (evaporuje razem z F1: brak admin klienta w Phase 2; vitest mockuje typed SSR client — Phase 2 Contract point (5) już wpisuje "typed mocked supabase client `SupabaseClient<Database>` — TypeScript wyłapie divergent sygnatury")
