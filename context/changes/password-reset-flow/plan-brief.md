# Password Reset via Email (S-04) — Plan Brief

> Full plan: `context/changes/password-reset-flow/plan.md`

## What & Why

FR-003 from the PRD: an adult persona returning to 10xCards after a week or a month loses all their cards on the first forgotten password without this feature. This slice adds Supabase-driven email-link password reset on top of the existing auth surface (signin/signup/signout), following the same native-form-POST + `?error=` redirect pattern.

## Starting Point

Auth SSR is wired via `@supabase/ssr` (`src/lib/supabase.ts`) with PKCE forced by the SSR client. Existing pages (`signin.astro`, `signup.astro`, `confirm-email.astro`) and endpoints (`/api/auth/signin`, `/api/auth/signup`, `/api/auth/signout`) all use the same convention: React island form → native POST → endpoint calls Supabase → `context.redirect(...)` with `?error=<encoded>` on failure. Middleware protects `/dashboard`, `/generate`, `/review`. Inbucket is enabled at port 54324 for local email testing. No `PUBLIC_SITE_URL` env var exists; site URL is hardcoded at `astro.config.mjs:12`. `supabase/config.toml` has no `[auth.email.template.recovery]` block yet.

## Desired End State

A signed-out user who forgot their password can go to `/auth/signin`, click "Zapomniałeś hasła?", submit their email, receive a Supabase email at Inbucket (locally) or their inbox (prod), click the link, land on `/auth/update-password`, set a new password, and end up signed in at `/`. Rate limits (2/hour per address), expired links, and same/weak passwords surface as concrete Polish error messages via the existing `?error=` query-param pattern.

## Key Decisions Made

| Decision                                    | Choice                                                                                   | Why (1 sentence)                                                                                                                | Source |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Callback route shape                        | Dedicated `/auth/confirm?token_hash=&type=recovery&next=` (canonical Supabase pattern)   | One route can absorb invite/email-change/magic-link later without refactoring; matches published Supabase PKCE docs.            | Plan   |
| Post-reset behavior                         | Auto-signed-in redirect to `/`                                                            | `verifyOtp` already establishes a full session; adding a signout step buys negligible security for extra friction.               | Plan   |
| Middleware gate for recovery session        | No change — treat as ordinary session                                                     | Recovery link is single-use and short-lived; adding an AAL gate is disproportionate work for the 3-week MVP budget.              | Plan   |
| Recovery email template                     | Default Supabase body, but override to point at our `/auth/confirm` with `token_hash`     | PKCE requires `token_hash` + `verifyOtp` on our server, not the legacy `/auth/v1/verify` endpoint; no custom branding on MVP.    | Plan   |
| `redirectTo` configuration strategy         | New `PUBLIC_SITE_URL` env var declared in `astro:env/server`                             | Single source of truth for absolute URLs; enables Supabase whitelist match; ready for invite/OAuth flows later.                  | Plan   |
| Edge-case handling (rate limit / expired / weak) | Distinct Polish messages via `?error=<encoded>` (3 classes)                          | User can act on each class (wait, re-request, choose stronger password); consistent with `ServerError` pattern.                 | Plan   |
| Test scope                                  | Manual only via Inbucket                                                                 | No auth tests exist in the repo; matches existing convention; time-boxed for MVP.                                                | Plan   |

## Scope

**In scope:**
- New pages: `/auth/reset-password`, `/auth/reset-password-sent`, `/auth/confirm`, `/auth/update-password`
- New API endpoints: `POST /api/auth/reset-request`, `POST /api/auth/reset-confirm`
- New React islands: `ResetPasswordForm.tsx`, `UpdatePasswordForm.tsx`
- `PUBLIC_SITE_URL` in `astro.config.mjs` env schema, `.dev.vars.example`, GitHub Actions env
- `supabase/config.toml` updates: expand `additional_redirect_urls`, add `[auth.email.template.recovery]` pointing at `supabase/templates/recovery.html`
- "Zapomniałeś hasła?" link on `/auth/signin`

**Out of scope:**
- Custom-branded email HTML (only URL and subject override)
- Automated tests (unit / integration)
- Middleware changes / AAL gates on recovery sessions
- Signout-after-reset (user stays signed in)
- Turnstile / CAPTCHA on the reset request
- Success-notice UI on `signin.astro` (no `?success=` in `ServerError`)

## Architecture / Approach

Two-step flow: **request** (email in, email out) and **complete** (link in, session in, password out).

```
/auth/signin
  ↓ (link)
/auth/reset-password ──POST──► /api/auth/reset-request
  ↓                              ↓ (resetPasswordForEmail)
  └──302──► /auth/reset-password-sent   (Supabase queues email)

Email link  ─────GET──►  /auth/confirm?token_hash&type=recovery&next=/auth/update-password
                            ↓ (verifyOtp → cookies set)
                          302 → /auth/update-password ──POST──► /api/auth/reset-confirm
                                                                    ↓ (updateUser)
                                                                  302 → /
```

Every endpoint follows the `signin.ts` pattern: `formData()` → `createClient(headers, cookies)` → Supabase call → `context.redirect` (success or `?error=<encoded>`). The `/auth/confirm` page is server-rendered (frontmatter logic + redirect return, no user-visible body).

## Phases at a Glance

| Phase                                          | What it delivers                                                                                         | Key risk                                                                                                    |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1. Configuration                               | `PUBLIC_SITE_URL` env var wired, Supabase redirect whitelist expanded, recovery email template overridden | `config.toml` requires a Supabase restart; template path typo silently falls back to default template.       |
| 2. Request-reset flow                          | `/auth/reset-password` page + form + `/api/auth/reset-request` endpoint + "check your email" page + signin discovery link | `redirectTo` value not in whitelist → Supabase silently redirects to `site_url` (hard to debug).             |
| 3. Confirm callback + update-password flow     | `/auth/confirm` SSR verifyOtp + `/auth/update-password` page + form + `/api/auth/reset-confirm` endpoint | Cookie flushing on Astro `redirect` — session must land on redirect Response; `updateUser` needs live session. |

**Prerequisites:** F-01 (auth wiring already in place — done). Local Supabase running with Inbucket for manual test.
**Estimated effort:** ~1 session for Phase 1 (config), ~1 session for Phase 2, ~1-2 sessions for Phase 3. Total ~3-4 sessions across the three phases.

## Open Risks & Assumptions

- **Assumption:** The default Supabase recovery template can be overridden via `content_path` in `config.toml` and picks up changes on `supabase start`. If the Supabase CLI version in this project ignores `content_path`, we may need to fall back to inline `content = "..."` in the TOML.
- **Assumption:** `verifyOtp({ type: "recovery", token_hash })` sets cookies via the SSR `setAll` adapter and those cookies land on the `Astro.redirect(...)` response. If they don't, `updateUser` will hit `AuthSessionMissingError` and the flow breaks. The endpoint has an explicit fallback message for this case, but if it triggers routinely we need to switch to setting cookies manually.
- **Risk:** `PUBLIC_SITE_URL` misconfigured in prod (GitHub Actions secret missing) → build succeeds but reset links point at localhost. Mitigation: verify the value in the very first prod smoke test after this slice ships.
- **Risk:** `enable_confirmations = false` on signup means signup + immediate reset creates a valid attack path if an attacker knows a target email and can guess weak passwords. This is the same threat surface as today; not made worse by this slice.

## Success Criteria (Summary)

- A user who signed up previously, forgot their password, and clicks "Zapomniałeś hasła?" can complete the whole flow in ≤5 clicks (link, submit email, open email, click link, submit new password) and be signed in at `/`.
- Old password no longer works after reset; new password works.
- Rate-limit, expired-link, and weak-password errors each surface as distinct Polish messages the user can act on.
