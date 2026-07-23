<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Usunięcie konta z 30-dniową retencją (S-05)

- **Plan**: `context/changes/account-deletion-30d-retention/plan.md`
- **Scope**: Full plan (Phase 1 + Phase 2 + Phase 3)
- **Date**: 2026-07-23
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical  1 warning  2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Grounding

- **Files planned vs shipped**: 15 planned files, 15 shipped (perfect coverage). Nothing shipped outside the plan except test files that the plan explicitly requested.
- **`git log --after=2026-07-22`**: 4 commits attributable to this change (`8233ef1`, `763854d`, `281c429`, `977ad91` epilogue).
- **AGENTS.md hard rules verified**: all 3 new endpoints export `const prerender = false`; no `"use client"` / `"use server"` directives in React components; RLS + per-op-per-role policies in the same migration that creates `profiles`.
- **Scope guardrails ("What We're NOT Doing") upheld**: no `src/lib/supabase-admin.ts`, no `SUPABASE_SERVICE_ROLE_KEY` env var, no `account_events` audit table, no Turnstile, no custom-branded email, no data-export flow.
- **Automated success criteria** (all confirmed during the phase-end rituals): `supabase db reset` clean, `supabase test db` 38/38 assertions pass (+18 for S-05), `npm run db:types` idempotent, `npm run astro sync && lint && build` green, `npm run test` 68/68.
- **Load-bearing invariant verified**: migration inserts profiles for existing auth.users (backfill @ line 99-101) BEFORE the DROP+CREATE of the EXISTS-gated cards/review_history policies (lines 104-197). Reversing this order would 100%-lock-out every pre-migration user.

## Findings

### F1 — Signup guard normalizes/validates email inconsistently with sibling endpoints

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality / Pattern Consistency
- **Location**: `src/pages/api/auth/signup.ts:7-9, 19`
- **Detail**: `email` is read as `form.get("email") as string` (silently casts a missing field to `null`), then passed to both `email_pending_deletion(p_email)` and `supabase.auth.signUp({ email })` without a trim + lowercase step. The RPC does `u.email = lower(p_email)` internally, so **case** variants are safe. But **whitespace-padded** variants (`" foo@test.local "`) do NOT match the RPC's `lower(p_email)` because `lower(" foo@test.local ")` still contains the spaces, while `auth.users.email` is stored trimmed. A user who soft-deleted `foo@test.local` and re-registers with a padded variant will skip the "account_pending_deletion" hint entirely — Supabase's own `signUp` will then trim server-side and hit the unique-email constraint, producing a generic "email already registered" error. Not a security bypass (no new account is created), but a UX regression that defeats the plan's whole point of routing re-signups to the restore flow. Sibling `src/pages/api/cards.ts:8-14, 65-68` uses a zod `.strict()` schema + 400 on invalid input — signup.ts is the odd one out.
- **Fix A ⭐ Recommended**: Normalize once, pass the normalized value to both calls.
  - Approach: `const rawEmail = form.get("email"); const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";` before the RPC and signUp. Add an early `if (!email) return context.redirect(...)` for the missing-field case.
  - Strength: One-line normalization closes the whitespace/case escape; also fixes the silent-null cast that produces the string `"null"` on missing input; consistent with how `email_pending_deletion` itself lowercases inside.
  - Tradeoff: None — no other endpoint depends on the raw value.
  - Confidence: HIGH — the RPC and Supabase both operate on lowercased/trimmed forms; this just aligns the boundary.
  - Blind spot: If a future auth-related endpoint needs the raw email (e.g. for exact-case display), it will need its own copy. Unlikely.
- **Fix B**: Introduce a zod schema (matching the `cards.ts` pattern) that trims + lowercases via `.transform()` and validates format.
  - Approach: `const bodySchema = z.object({ email: z.string().email().transform(v => v.trim().toLowerCase()), password: z.string().min(6) })`. Parse via `.safeParse(Object.fromEntries(form))`.
  - Strength: Elevates signup to the project's canonical validation pattern; catches other malformed inputs (missing password, bad email format) with a proper 400 path.
  - Tradeoff: Larger change surface; introduces a schema and a 400 response variant to the signup UX. Slightly beyond scope of a warning-level finding.
  - Confidence: HIGH — pattern is proven in `cards.ts`.
  - Blind spot: Existing `SignUpForm` island already does client-side validation; server 400 vs. current redirect-with-error is a small UX change to reconcile.
- **Decision**: FIXED via Fix A

### F2 — Plan contract for `delete.ts` error paths has internal contradiction; impl chose redirect

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `context/changes/account-deletion-30d-retention/plan.md` Phase 2 §1 Contract; `src/pages/api/account/delete.ts:20-38`
- **Detail**: The plan's Phase 2 §1 Contract says both "if null → 500" and "error → 500 z log strukturowanym" for the create-client and RPC-error branches, then closes with "Error path: redirect `/account?error=<encoded>` z Polish message." The impl went with redirect (matches the closing sentence + the auth-form UX pattern used elsewhere). Tests explicitly codify this: `delete.test.ts:62-67` asserts `res.status === 303` and `location` containing `/account?error=`. This is not a drift bug — the impl picked one of two contradictory instructions and self-documented via tests — but the plan text is stale and future readers will hit the same contradiction.
- **Fix**: Update plan.md Phase 2 §1 Contract to remove the "500" mentions in steps (2) and (3), leaving only the "redirect `/account?error=<encoded>`" clause as the canonical error handling.
- **Decision**: FIXED

### F3 — Middleware adds one Supabase round-trip per authenticated request

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Performance)
- **Location**: `src/middleware.ts:28-32`
- **Detail**: Every authenticated request outside `SOFT_DELETE_ALLOWED_PATHS` issues an extra `.select('deleted_at').eq('user_id', user.id).maybeSingle()` on top of `auth.getUser()`. The lookup is index-only (profiles PK on `user_id`, plus the partial `profiles_user_alive_idx WHERE deleted_at IS NULL`), so per-request cost is sub-ms in Postgres — but each hit still pays a full Cloudflare-Workers→Supabase RTT (~20-40ms on cloud). Plan Performance Considerations already acknowledges this and defers a JWT-claim optimization to post-MVP. Noting for the record.
- **Fix**: None required for MVP. If p95 latency on `/api/generate` (30s Guardrail budget) starts crowding the ceiling, promote the JWT custom-claim optimization from post-MVP.
- **Decision**: ACCEPTED — MVP-acceptable per plan Performance Considerations.

## Notes

- The plan-review-time F1 fix (drop admin client, use SSR `signOut({scope:'global'})`) is fully honoured in the impl — no service_role code path anywhere in the change.
- pgTAP suite (`supabase/tests/rls.test.sql`) grew from 20 to 38 assertions; new coverage includes the trigger auto-insert, cross-user enqueue authz, RLS EXISTS gate on both `cards` and `review_history`, `execute_hard_delete` idempotency + FK cascade end-to-end, `email_pending_deletion` true/false, and `retention_watchdog` fail-loud RAISE/EXCEPTION.
- All 5 SECURITY DEFINER functions set an explicit `search_path` per Supabase security guidance.
- No CRITICAL findings: no SQL injection, no hardcoded secrets, no XSS (Astro JSX auto-escapes the `?error=` param), no cascade misconfiguration, no cron function non-idempotency.
