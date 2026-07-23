<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Internacjonalizacja UI (PL/EN, domyślnie polski)

- **Plan**: context/changes/i18n-pl-en-toggle/plan.md
- **Scope**: Full plan (4 of 4 phases)
- **Date**: 2026-07-23
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | WARNING |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Raw Supabase `error.message` echoed to localized UI

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/auth/signin.ts:19, signup.ts:42, reset-request.ts:25, reset-confirm.ts:31; consumed by src/lib/error-messages.ts:44 (free-form pass-through)
- **Detail**: Endpoints that hit an unmapped Supabase failure still redirect with `?error=${encodeURIComponent(error.message)}`. `errorCodeToMessage` treats anything that doesn't match `/^[A-Z][A-Z0-9_]*$/` as free-form and returns it verbatim — so raw English SDK strings ("Invalid login credentials", vendor stack fragments, etc.) surface in the localized UI. Two consequences: (a) PL users see English error text mid-flow, breaking the "no cross-language leakage" acceptance criterion; (b) URL becomes a phishing-shaped vector — an attacker who can trigger any Supabase error can shape `?error=Your%20session%20was%20hijacked...` and the ServerError banner renders it. React auto-escapes so it is not XSS, but the plan explicitly said "one truth on the client".
- **Fix**: Extend the endpoint-side mapping (as `reset-confirm.ts` already does for `weak_password` / `same_password` / `AuthSessionMissingError`) to cover the remaining common Supabase codes, then change `errorCodeToMessage`'s free-form branch to return `m.error_unknown()` so any unmapped input renders as the generic fallback instead of raw vendor text.
  - Strength: Enforces the plan's "server returns codes only" contract, closes the PL/EN leak in unhappy paths, and eliminates the URL-text vector.
  - Tradeoff: Loses granular vendor-message detail for edge cases — users see a generic error instead of "Invalid login credentials". Add a `console.error` at the endpoint to keep the specific reason in logs.
  - Confidence: HIGH — the pattern is already in place for `weak_password` / `same_password` in reset-confirm; just extends it.
  - Blind spot: The full list of Supabase auth error codes we need to enumerate — likely need to enumerate against production logs.
- **Decision**: FIXED — endpoints now redirect with `?error=UNKNOWN` + `console.error` the raw code/status/message; `errorCodeToMessage` free-form branch collapses to `m.error_unknown()`.

### F2 — `account_pending_deletion` bypasses the ERROR_CODES contract

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/auth/signup.ts:35, src/pages/auth/signup.astro:6-8
- **Detail**: Every other endpoint redirects with `?error=<UPPER_SNAKE>` codes routed through `ERROR_CODES`. `signup.ts` writes the literal `?error=account_pending_deletion` (lowercase) and `signup.astro` special-cases the raw string with `rawError === "account_pending_deletion"` before calling `m.auth_signup_pending_deletion()`. Two consequences: (a) the code+message pair sits outside the single-source-of-truth pipeline; (b) if this code ever reached `ServerError` via a different route, `errorCodeToMessage`'s free-form branch would render the raw snake_case literal to the user.
- **Fix**: Add `ACCOUNT_PENDING_DELETION` to `ERROR_CODES` in `src/lib/error-messages.ts`, add `error_account_pending_deletion` key to both message files (with the current "Konto z tym mailem…" / "An account with this email…" copy — those keys already exist as `auth_signup_pending_deletion`, so either rename or add a second alias), redirect with `ERROR_CODES.ACCOUNT_PENDING_DELETION`, and simplify `signup.astro` to compare via `ERROR_CODES.ACCOUNT_PENDING_DELETION` instead of the magic string.
- **Decision**: FIXED — `ACCOUNT_PENDING_DELETION` added to `ERROR_CODES`, resolver aliased to existing `auth_signup_pending_deletion` (no new key needed), signup.ts redirects with the code, signup.astro compares via `ERROR_CODES.ACCOUNT_PENDING_DELETION` and passes the raw code through to SignUpForm's ServerError (which translates it via `errorCodeToMessage`).

### F3 — Astro `i18n` block is declared but inert; two i18n systems wired in parallel

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architecture
- **Location**: astro.config.mjs:15-18 (Astro `i18n: { defaultLocale: "pl", locales: ["pl", "en"] }`) vs Paraglide strategy `["cookie", "globalVariable", "baseLocale"]` in the same file
- **Detail**: Two independent i18n systems coexist: Astro's native `i18n` config and Paraglide via its Vite plugin. Because the Paraglide strategy omits `"url"`, no URL-based routing ever fires — `/en/dashboard` and `/dashboard` render identically. The Astro `i18n` block therefore has no observable effect today. But `src/paraglide/runtime.js` still emits `urlPatterns` (`en` → `/en/...`), and future readers will assume URL prefixes work. If someone later adds `"url"` to the strategy, the two configs may diverge silently.
- **Fix A ⭐ Recommended**: Remove the `i18n` block from `astro.config.mjs`; Paraglide is the single source of truth.
  - Strength: Eliminates ambiguity; matches the plan's decision "cookie-only, no URL prefix" (plan §"What We're NOT Doing" — "Prefixed routes").
  - Tradeoff: Loses discoverability for future contributors who might expect Astro-native i18n. Add a one-line comment above the `paraglideVitePlugin` call pointing to `AGENTS.md` § Internationalization.
  - Confidence: HIGH — the block currently does nothing; removing it is safe.
  - Blind spot: If Astro adapters later inspect `i18n.locales` for something orthogonal (e.g. sitemap), we would need to restore it.
- **Fix B**: Add `"url"` to the Paraglide strategy and commit to URL-prefixed routes.
  - Strength: Aligns both systems and enables shareable, SEO-friendly locale URLs.
  - Tradeoff: Contradicts the plan's decision; would require rewriting internal links and redirects (see plan §"Scope").
  - Confidence: MEDIUM — larger scope change; belongs in a follow-up.
  - Blind spot: Downstream impact on all `Astro.redirect(...)` calls and static asset paths.
- **Decision**: FIXED via Fix A — `i18n` block removed from `astro.config.mjs`; short comment added above `paraglideVitePlugin` pointing to AGENTS.md.

### F4 — `paraglideMiddleware` callback discards the delocalized request

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/middleware.ts:17
- **Detail**: `paraglideMiddleware(context.request, async () => { ... })` throws away the callback's `{ request, locale }` argument. Today this is harmless (no `"url"` strategy → no delocalization happens). But if `"url"` is ever added (see F3), `context.url.pathname` will still contain the localized prefix (`/en/dashboard`), so the `PROTECTED_ROUTES` and `SOFT_DELETE_ALLOWED_PATHS` matchers silently stop matching — the auth gate would disengage without warning.
- **Fix**: Accept the callback param — `async ({ request }) => { ... }` — and derive `pathname` from `new URL(request.url).pathname` instead of `context.url.pathname`. Makes the middleware future-proof against enabling URL strategy.
- **Decision**: FIXED — middleware now accepts `{ request }` and uses `new URL(request.url).pathname` for both the soft-delete and PROTECTED_ROUTES matchers.

### O1 — `SOURCE_LABELS` renders hardcoded English chips

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/deck/CardListItem.tsx:12-21
- **Detail**: The visible source badges — `"AI"` and `"manual"` — are hardcoded strings. Not caught by the parity guard because they aren't keys. Arguably proper nouns / dev-facing tags (Anki-style), but the plan's inclusion test ("every user-visible string") suggests they should either be keyed or explicitly noted as intentional. `prebuild` cannot catch a bare literal that never was a key.
- **Fix**: Either add `deck_card_source_ai` / `deck_card_source_manual` (probably kept identical in both locales, or `"AI"` / `"Ręcznie"` in PL), or add a short comment noting these are intentionally untranslated brand-style tags.
- **Decision**: FIXED via "Add keys" — added `deck_card_source_ai` / `deck_card_source_manual` (PL: "AI" / "ręcznie", EN: "AI" / "manual") and rewired `SOURCE_BADGES` in CardListItem to use lazy `m.*` references.

### O2 — `restore-account.astro` — the "Konto" prefix before the masked email was dropped in Phase 2

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/auth/restore-account.astro:51-53
- **Detail**: The pre-i18n page rendered `Konto <span>{maskedEmail}</span>`; my Phase 2 rewrite dropped the "Konto"/"Account" prefix in favor of just the email span. Behavior-equivalent (email is still shown) but a small cosmetic regression from master. Not part of the plan's success criteria; noted for awareness in case the design intent was to keep the word.
- **Fix**: If the prefix should be preserved, add `auth_restore_account_email_prefix` ("Konto"/"Account") and render it in front of the span.
- **Decision**: FIXED — added `auth_restore_account_email_prefix` key and rendered before the masked email span.
