# Password Reset via Email (S-04) — Implementation Plan

## Overview

Add FR-003 password reset via email link on top of the existing Supabase Auth wiring. User requests reset from `/auth/reset-password` → Supabase sends a recovery email → user clicks a link that lands on `/auth/confirm?token_hash=…&type=recovery&next=/auth/update-password` → server calls `verifyOtp` (PKCE flow requires `token_hash`, not `code`) → user sets a new password on `/auth/update-password` → server calls `updateUser({ password })` → auto-signed-in redirect to `/`. The whole flow follows the existing native-form-POST + `?error=<message>` redirect convention used by `/api/auth/signin` and `/api/auth/signup`.

## Current State Analysis

- **Auth SSR wiring is in place.** `src/lib/supabase.ts:5-25` exports `createClient(headers, cookies)` returning a `@supabase/ssr` `createServerClient` — cookies flow via `getAll` / `setAll`. `@supabase/ssr` is version 0.10.3 and **forces PKCE** (`autoRefreshToken: false`, `detectSessionInUrl: false`, `flowType: "pkce"`, cookie storage). This has implications for the recovery link shape (see Critical Implementation Details).
- **Existing auth surface.** Pages: `src/pages/auth/{signin,signup,confirm-email}.astro`. API: `src/pages/api/auth/{signin,signup,signout}.ts`. All endpoints use the exact same shape: `POST FormData → context.redirect("/…?error=<encoded>")` on failure, `context.redirect("/…")` on success. React islands (`SignInForm`, `SignUpForm`) use native `<form method="POST">` with `useFormStatus`, `FormField`, `PasswordToggle`, `SubmitButton`, `ServerError` components.
- **Middleware** (`src/middleware.ts:4`) protects `/dashboard`, `/generate`, `/review` only. Auth pages and API endpoints are public. Attaches `context.locals.user` from `supabase.auth.getUser()`.
- **Env schema** (`astro.config.mjs:23-34`) declares `SUPABASE_URL`, `SUPABASE_KEY`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`. No `PUBLIC_SITE_URL`. Site URL is hardcoded at `astro.config.mjs:12` (`https://10x-astro-starter.mk-betasi.workers.dev`).
- **Supabase config** (`supabase/config.toml`): `site_url = "http://127.0.0.1:3000"` (line 154), `additional_redirect_urls = ["https://127.0.0.1:3000"]` (line 156). No `[auth.email.template.recovery]` block. `[auth.rate_limit].email_sent = 2` (per hour, line 182). `[auth.email].max_frequency = "1s"` (line 213). `enable_confirmations = false` (line 209). Inbucket enabled on port 54324 for local email testing.
- **Wrangler** (`wrangler.jsonc`) has no `vars` block — env vars come from `.dev.vars` locally and from GitHub Actions secrets in prod.
- **Tests**: no auth tests exist. Vitest is configured (`vitest.config.ts`); pattern from `src/pages/api/cards.test.ts` mocks Supabase.

### Key Discoveries:

- `SignInForm.tsx:43` — native `<form method="POST" action="/api/auth/signin">`. No JS fetch. Reuse this pattern.
- `src/pages/api/auth/signin.ts:6-22` — reference endpoint shape. `formData()` → `createClient(headers, cookies)` → Supabase call → `context.redirect` with `?error=…` on failure.
- `src/components/auth/FormField.tsx`, `PasswordToggle.tsx`, `SubmitButton.tsx`, `ServerError.tsx` — all reusable.
- `src/pages/auth/signin.astro:16` — pattern for `<ReactIsland client:load serverError={error} />` with error from `Astro.url.searchParams.get("error")`.
- Supabase recovery link default template (Context7 / `@supabase/ssr` docs): under PKCE it is `{SiteURL}/auth/confirm?token_hash=<>&type=recovery&next=<redirectTo>` and requires the app to call `verifyOtp({ type: "recovery", token_hash })` — NOT `exchangeCodeForSession`.

## Desired End State

A logged-out user who forgot their password can:

1. From `/auth/signin`, click "Zapomniałeś hasła?" → land on `/auth/reset-password`.
2. Submit email → land on `/auth/reset-password-sent` ("check your email"). The response is identical whether the email exists or not (Supabase Auth email-enumeration protection).
3. Receive an email visible at `http://127.0.0.1:54324` (Inbucket) with a Reset link.
4. Click the link → land on `/auth/confirm` → server calls `verifyOtp` → 302-redirect to `/auth/update-password`. On failure (expired / invalid token): 302 to `/auth/reset-password?error=Link+wygasł+lub+jest+nieprawidłowy,+zażądaj+nowego`.
5. Submit new password + confirmation → `POST /api/auth/reset-confirm` → `updateUser({ password })` → 302 to `/` with active session. On error: 302 back to `/auth/update-password?error=<konkretny+komunikat>` for `weak_password` or `same_password`.
6. Manual verification through Inbucket. No automated tests are added in this slice.

## What We're NOT Doing

- **No custom-branded email template.** The overridden body (`supabase/templates/recovery.html`, 5 lines) only exists to route the recovery link through our `/auth/confirm` callback with the PKCE `token_hash`+`type`+`next` shape — the default Supabase link points at `<supabase-url>/auth/v1/verify?token=…` which does not integrate with our SSR PKCE cookie flow. The body itself remains unbranded; no marketing copy, no logo, no styling beyond a heading and a link. Subject renamed to Polish.
- **No middleware changes.** Sessions from `verifyOtp({ type: "recovery" })` are treated as ordinary signed-in sessions. This slice does not add an AAL-gate on `/auth/update-password`.
- **No signout after successful password change.** User stays signed in and is redirected to `/`.
- **No JSON responses on new endpoints.** Native form POST + redirect-with-query-param, matching the existing pattern.
- **No automated tests.** Manual verification via Inbucket only. No unit tests for `reset-request.ts` / `reset-confirm.ts` (a follow-up task).
- **No password strength UI beyond min-6-chars.** The client-side validation matches `SignUpForm` (min 6, must match confirm). Server-side error from Supabase (`weak_password`, `same_password`) surfaces via `?error=`.
- **No dedicated success-notice UI component.** Sent confirmation is a plain page; no `?success=…` query param support is added to `ServerError` (out of scope).
- **No Turnstile / hCaptcha in front of `resetPasswordForEmail`.** Supabase's own rate-limit (`email_sent = 2/hour`) is the sole guard.
- **No email confirmation for signup change.** `enable_confirmations = false` stays; the recovery flow is independent.

## Implementation Approach

Three phases, each independently testable via Inbucket:

1. **Configuration** — Wire `PUBLIC_SITE_URL` through env schema, dev vars, and Supabase's redirect whitelist; override the recovery email template body so its link points at our `/auth/confirm` route with the PKCE `token_hash` shape.
2. **Request-reset flow** — Public page + React island + API endpoint that calls `resetPasswordForEmail` and a "check your email" landing page. Add discovery link on `/auth/signin`.
3. **Confirm callback + update-password flow** — SSR page that calls `verifyOtp` on GET, public page + React island for the new-password form, API endpoint that calls `updateUser` and redirects to `/`.

## Critical Implementation Details

**Recovery link uses `token_hash`, not `code`.** `@supabase/ssr` forces PKCE, but the Supabase recovery email uses `token_hash` verified via `supabase.auth.verifyOtp({ type: "recovery", token_hash })` — NOT `exchangeCodeForSession` (which is for OAuth). The `/auth/confirm` page must read the `token_hash` and `type` query params from the GET URL, call `verifyOtp`, and 302 to `next` (defaulting to `/auth/update-password`) or back to `/auth/reset-password?error=…` on failure.

**Cookie flushing on redirect.** `createServerClient` sets cookies through Astro's `context.cookies.set(name, value, options)` inside `setAll`. As long as the endpoint returns `context.redirect(...)` AFTER awaiting the Supabase call (as in `signin.ts:15-21`), cookies land on the redirect response. Do not construct the redirect Response before the Supabase call resolves.

**`updateUser` requires an active session.** After `verifyOtp({ type: "recovery" })` succeeds, cookies are set and the user is fully signed in. `/api/auth/reset-confirm` can then call `supabase.auth.updateUser({ password })` — this reuses the same `createClient(headers, cookies)` and picks up the session automatically. If the session is missing (e.g., cookies dropped by CDN), the endpoint returns `?error=Sesja+wygas\u0142a,+powt\u00f3rz+reset+has\u0142a`.

**`resetPasswordForEmail` return shape is enumeration-safe.** Success is returned regardless of whether the email exists. Only non-user errors (rate-limit 429, invalid email format, network) surface. The endpoint must always redirect to `/auth/reset-password-sent` on non-rate-limit paths so that the UI does not leak account existence.

## Phase 1: Configuration

### Overview

Introduce a `PUBLIC_SITE_URL` env var, propagate it into Supabase's redirect whitelist, and override the recovery email template so the link uses the PKCE `token_hash` shape and points at our own `/auth/confirm` route.

### Changes Required:

#### 1. Astro env schema

**File**: `astro.config.mjs`

**Intent**: Declare `PUBLIC_SITE_URL` as a server-context, public-access env variable so endpoints can pass it as the absolute `redirectTo` to `resetPasswordForEmail`. Also swap the hardcoded `site:` value on line 12 to read from the same env variable for consistency (still a string literal fallback for build time is acceptable).

**Contract**: Add one entry to `env.schema` alongside `SUPABASE_URL` — `PUBLIC_SITE_URL: envField.string({ context: "server", access: "public", optional: false })`. Import site value at the top and reuse if practical; if not, keep the hardcoded `site:` and simply add the env field.

#### 2. Local dev vars

**File**: `.dev.vars.example`

**Intent**: Document the new variable so contributors add it to their local `.dev.vars`.

**Contract**: Append line `PUBLIC_SITE_URL=http://127.0.0.1:3000`.

#### 3. Prod configuration

**File**: `wrangler.jsonc`

**Intent**: Since prod values in this project are supplied via GitHub Actions repo secrets (see AGENTS.md CI/Pre-commit note), record `PUBLIC_SITE_URL` in the CI workflow's env for `wrangler deploy` — no change to `wrangler.jsonc` itself unless we choose to inline a non-secret vars block. Preferred: add `PUBLIC_SITE_URL` to `.github/workflows/ci.yml` env alongside `SUPABASE_URL` / `SUPABASE_KEY`.

**Contract**: In `.github/workflows/ci.yml` add `PUBLIC_SITE_URL: ${{ secrets.PUBLIC_SITE_URL }}` (or `vars.PUBLIC_SITE_URL` — the repo owner adds the secret manually). Value in prod: `https://10x-astro-starter.mk-betasi.workers.dev`.

#### 4. Supabase redirect whitelist

**File**: `supabase/config.toml`

**Intent**: Add `/auth/confirm` and `/auth/update-password` under both localhost and prod hosts to `additional_redirect_urls`. The `redirectTo` passed to `resetPasswordForEmail` MUST match either `site_url` or an entry in this list, or Supabase Auth silently falls back to `site_url`.

**Contract**: Line 156 becomes:

```toml
additional_redirect_urls = [
  "http://127.0.0.1:3000/auth/confirm",
  "http://127.0.0.1:3000/auth/update-password",
  "https://10x-astro-starter.mk-betasi.workers.dev/auth/confirm",
  "https://10x-astro-starter.mk-betasi.workers.dev/auth/update-password",
]
```

#### 5. Recovery email template body

**File**: `supabase/config.toml`

**Intent**: Override the default recovery template so the link uses the PKCE-compatible shape. Default Supabase templates use the legacy verify endpoint under `<supabase-url>/auth/v1/verify?token=...`, which does not integrate cleanly with our `@supabase/ssr` PKCE cookie flow. We want the email link to hit our own `/auth/confirm` route so we can call `verifyOtp` server-side and set cookies through the SSR client.

**Contract**: Uncomment and configure a `[auth.email.template.recovery]` block:

```toml
[auth.email.template.recovery]
subject = "Reset hasła — 10xCards"
content_path = "./supabase/templates/recovery.html"
```

Create `supabase/templates/recovery.html` with a minimal body:

```html
<h2>Reset hasła</h2>
<p>Kliknij poniższy link, aby ustawić nowe hasło do konta 10xCards. Link wygasa po godzinie.</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/auth/update-password">Ustaw nowe hasło</a></p>
<p>Jeśli to nie Ty prosił(a)eś o reset, zignoruj tę wiadomość.</p>
```

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes.
- `npx astro sync` passes (env schema types generated).
- `npm run build` passes (`PUBLIC_SITE_URL` set in build env).

#### Manual Verification:

- Restart local Supabase (`supabase stop && supabase start`) — `config.toml` changes require restart.
- Inbucket UI loads at `http://127.0.0.1:54324`.
- New env var visible as import in a scratch endpoint (e.g., `console.log` in a temporary handler).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Request-reset flow

### Overview

Build the "I forgot my password" surface: a public form that collects an email, calls `resetPasswordForEmail`, and lands on a "check your email" confirmation. Add a discovery link on the signin page.

### Changes Required:

#### 1. Request-reset page

**File**: `src/pages/auth/reset-password.astro`

**Intent**: Public page mirroring `signin.astro:1-23` structure — Layout, cosmic backdrop, gradient title, React island form. Reads `?error=` from URL and passes it to the island as `serverError`.

**Contract**: Follows `signin.astro` verbatim except the title reads "Reset hasła", the form island is `<ResetPasswordForm client:load serverError={error} />`, and the footer link points to `/auth/signin` ("Wróć do logowania").

#### 2. Request-reset form island

**File**: `src/components/auth/ResetPasswordForm.tsx`

**Intent**: React island mirroring `SignInForm.tsx:12-87` but with a single email field. Client-side validation: required + regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`. Native `<form method="POST" action="/api/auth/reset-request">`. Uses `FormField`, `SubmitButton`, `ServerError`.

**Contract**: Exports default `function ResetPasswordForm({ serverError }: { serverError?: string | null })`. Renders one `<FormField id="email" type="email" label="Email" ... icon={<Mail />} />`, one `<ServerError message={serverError} />`, one `<SubmitButton pendingText="Wysyłanie..." icon={<Mail />}>Wyślij link</SubmitButton>`. Submit calls `validate()` and calls `e.preventDefault()` on failure — matches `SignInForm.tsx:36-40`.

#### 3. Reset-request endpoint

**File**: `src/pages/api/auth/reset-request.ts`

**Intent**: POST endpoint that reads email from FormData, calls `supabase.auth.resetPasswordForEmail(email, { redirectTo: PUBLIC_SITE_URL + "/auth/update-password" })`, and redirects.

**Contract**: `export const prerender = false;` and `export const POST: APIRoute`. Success (and email-not-found) → `context.redirect("/auth/reset-password-sent")`. On rate-limit (`error.status === 429`) → `context.redirect("/auth/reset-password?error=" + encodeURIComponent("Za dużo prób — spróbuj ponownie za godzinę."))`. On other errors → `context.redirect("/auth/reset-password?error=" + encodeURIComponent(error.message))`. On no-Supabase (client=null) → same shape as `signin.ts:12-14`.

#### 4. "Check your email" landing page

**File**: `src/pages/auth/reset-password-sent.astro`

**Intent**: Static page that tells the user to check their email. Mirrors `confirm-email.astro:1-37` structure.

**Contract**: Layout, cosmic backdrop, heading "Sprawdź swój email", paragraph explaining the link expires in 1 hour, "Wróć do logowania" link. No form. In dev, optionally include a note pointing at Inbucket (`http://127.0.0.1:54324`).

#### 5. "Forgot password?" discovery link

**File**: `src/pages/auth/signin.astro`

**Intent**: Add a "Zapomniałeś hasła?" link between the form and the "Sign up" footer link so users can find the reset flow.

**Contract**: Insert after `<SignInForm ... />` (line 16) and before the "Don't have an account?" paragraph (line 17): `<p class="mt-4 text-center text-sm text-blue-100/60"><a href="/auth/reset-password" class="text-purple-300 hover:underline">Zapomniałeś hasła?</a></p>`.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes.
- `npm run build` passes.
- `npx astro sync` passes (new routes registered).

#### Manual Verification:

- Navigate to `/auth/signin` → "Zapomniałeś hasła?" link visible and clickable.
- `/auth/reset-password` renders form with cosmic backdrop matching signin.
- Submitting invalid email → inline error under field.
- Submitting valid email → lands on `/auth/reset-password-sent`.
- Inbucket (`http://127.0.0.1:54324`) shows a "Reset hasła — 10xCards" email with a link matching `<SiteURL>/auth/confirm?token_hash=...&type=recovery&next=/auth/update-password`.
- Submitting the same email 3+ times in a row → 3rd attempt redirects to `/auth/reset-password?error=Za+du%C5%BCo+pr%C3%B3b…` (rate-limit).
- Submitting a nonexistent email → still lands on `/auth/reset-password-sent` (email-enumeration protection).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Confirm callback + update-password flow

### Overview

Build the "click the link → set new password → signed in" half of the flow. `/auth/confirm` is a server-rendered Astro page that calls `verifyOtp` in its frontmatter and redirects. `/auth/update-password` is a public page + React island. `/api/auth/reset-confirm` calls `updateUser` and redirects to `/`.

### Changes Required:

#### 1. Confirm callback page

**File**: `src/pages/auth/confirm.astro`

**Intent**: SSR page that runs in Astro's frontmatter on GET. Reads `token_hash`, `type`, and `next` from `Astro.url.searchParams`. Calls `supabase.auth.verifyOtp({ type, token_hash })`. On success, returns `Astro.redirect(next ?? "/auth/update-password")`. On failure, returns `Astro.redirect("/auth/reset-password?error=" + encodeURIComponent("Link wygasł lub jest nieprawidłowy — zażądaj nowego."))`.

**Contract**: The file body renders nothing user-visible (all logic in frontmatter returns a redirect). Access Supabase via `createClient(Astro.request.headers, Astro.cookies)` — same helper as endpoints. Guard against missing `token_hash` (redirect to `/auth/reset-password?error=…`). If `type` is anything other than `"recovery"`, redirect to reset-password with error so the route stays specific to this flow (invite/email-change join later as separate cases).

```
Astro frontmatter shape (skeleton, not full code):
  const { token_hash, type, next } = Astro.url.searchParams;
  if (!token_hash || type !== "recovery") return Astro.redirect(...error...);
  const supabase = createClient(Astro.request.headers, Astro.cookies);
  const { error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash });
  if (error) return Astro.redirect(...error...);
  return Astro.redirect(next ?? "/auth/update-password");
```

#### 2. Update-password page

**File**: `src/pages/auth/update-password.astro`

**Intent**: Public page mirroring `signup.astro` — Layout, cosmic backdrop, gradient title, React island form. Reads `?error=` from URL and passes it to the island. If the user is NOT signed in (verifyOtp did not run or session dropped), redirect back to `/auth/reset-password?error=…` in the frontmatter as a safety net.

**Contract**: Frontmatter reads `Astro.locals.user`; if null → `Astro.redirect("/auth/reset-password?error=" + encodeURIComponent("Sesja resetu wygasła — zażądaj nowego linku."))`. Otherwise renders the form island: `<UpdatePasswordForm client:load serverError={error} />`.

#### 3. Update-password form island

**File**: `src/components/auth/UpdatePasswordForm.tsx`

**Intent**: React island mirroring `SignUpForm.tsx` password + confirm section. Two password fields (with `PasswordToggle`), client-side validation (min 6, must match). Native `<form method="POST" action="/api/auth/reset-confirm">`.

**Contract**: Exports default `function UpdatePasswordForm({ serverError }: { serverError?: string | null })`. Renders two `<FormField type="password" ... />` with `<PasswordToggle>` end-content and per-field errors, one `<ServerError message={serverError} />`, one `<SubmitButton pendingText="Zapisywanie..." icon={<Lock />}>Ustaw hasło</SubmitButton>`. Hint text under first field: "Minimum 6 znaków" (mirrors `SignUpForm.tsx` character-count hint).

#### 4. Reset-confirm endpoint

**File**: `src/pages/api/auth/reset-confirm.ts`

**Intent**: POST endpoint that reads new password from FormData, calls `supabase.auth.updateUser({ password })`, and redirects to `/` on success or back to `/auth/update-password?error=…` on failure. Session comes from cookies set by the `/auth/confirm` `verifyOtp` step.

**Contract**: `export const prerender = false;` and `export const POST: APIRoute`. Success → `context.redirect("/")`. On `weak_password` (`error.code === "weak_password"`) → `context.redirect("/auth/update-password?error=" + encodeURIComponent("Hasło jest zbyt słabe — użyj co najmniej 6 znaków."))`. On `same_password` (`error.code === "same_password"`) → `context.redirect("/auth/update-password?error=" + encodeURIComponent("Nowe hasło musi się różnić od poprzedniego."))`. On missing session (`error.name === "AuthSessionMissingError"`) → `context.redirect("/auth/reset-password?error=" + encodeURIComponent("Sesja resetu wygasła — zażądaj nowego linku."))`. On other errors → `context.redirect("/auth/update-password?error=" + encodeURIComponent(error.message))`.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes.
- `npm run build` passes.
- `npx astro sync` passes.

#### Manual Verification:

- End-to-end: submit `/auth/reset-password` with a real signed-up email → open Inbucket → click link → land on `/auth/update-password` (URL bar shows path only, no token). Set a new password (min 6 chars, both match) → land on `/` while signed in.
- Wait > 1 hour after email delivery, then click the link → redirected to `/auth/reset-password?error=Link+wygas%C5%82…`.
- Try to submit the same password as before → `/auth/update-password?error=Nowe+has%C5%82o+musi+si%C4%99+r%C3%B3%C5%BCni%C4%87…`.
- Try to submit a 3-char password → client-side validation catches it inline; if bypassed via curl, endpoint returns `weak_password` error.
- Open `/auth/update-password` directly (without going through the callback) while logged out → 302 to `/auth/reset-password?error=Sesja…`.
- After successful update, sign out (`POST /api/auth/signout`) and sign in with the new password.
- Verify old password no longer works (should show `Invalid login credentials`).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the full end-to-end flow was walked through with Inbucket.

---

## Testing Strategy

### Unit Tests:

None in this slice (per decision). Existing endpoint test pattern (`src/pages/api/cards.test.ts`) can be picked up in a follow-up.

### Integration Tests:

None in this slice.

### Manual Testing Steps:

See Phase 2 and Phase 3 Manual Verification lists. The full end-to-end walkthrough:

1. Ensure Supabase local is running (`supabase start`), Astro dev server is running (`npm run dev`), Inbucket is at `http://127.0.0.1:54324`.
2. Sign up a test account at `/auth/signup` (email confirmation is off — signup completes immediately).
3. Sign out.
4. Go to `/auth/signin` → click "Zapomniałeś hasła?" → submit the test email → confirm redirect to `/auth/reset-password-sent`.
5. Open Inbucket → find the "Reset hasła — 10xCards" email → click the link.
6. Confirm the redirect chain: `/auth/confirm?token_hash=...&type=recovery&next=/auth/update-password` → `/auth/update-password` (with active session cookie).
7. Submit new password → confirm redirect to `/` with the user's dashboard/home visible (signed in).
8. Sign out → try to sign in with old password → should fail.
9. Sign in with new password → succeeds.
10. Rate-limit smoke: request 3 resets in a row → 3rd attempt shows rate-limit error.

## Performance Considerations

`resetPasswordForEmail` and `verifyOtp` are single Supabase Auth calls with no application-side database queries in this slice. No performance considerations beyond what the platform already provides. Rate-limit at 2 recovery emails per hour per address is the intended DoS guard.

## Migration Notes

No data migrations. Users signed up before this slice retain their accounts unchanged — they simply gain a new self-service path to recover access.

## References

- Roadmap: `context/foundation/roadmap.md` (S-04, lines 120-129)
- PRD FR-003: `context/foundation/prd.md` (lines 88-89)
- Existing signin endpoint pattern: `src/pages/api/auth/signin.ts:6-22`
- Existing signin page pattern: `src/pages/auth/signin.astro:1-23`
- Existing signin form island: `src/components/auth/SignInForm.tsx:12-87`
- Supabase SSR wiring: `src/lib/supabase.ts:5-25`
- Middleware / protected routes: `src/middleware.ts:1-25`
- Supabase Auth PKCE recovery flow (Context7): `@supabase/ssr` `_autodocs/configuration.md`, `@supabase/supabase` `apps/docs/content/guides/auth/passwords.mdx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Configuration

#### Automated

- [x] 1.1 `npm run lint` passes — bfba965
- [x] 1.2 `npx astro sync` passes (env schema types generated) — bfba965
- [x] 1.3 `npm run build` passes (`PUBLIC_SITE_URL` set in build env) — bfba965

#### Manual

- [x] 1.4 Restart local Supabase — `config.toml` changes require restart
- [x] 1.5 Inbucket UI loads at `http://127.0.0.1:54324`
- [x] 1.6 New env var visible as import in a scratch endpoint

### Phase 2: Request-reset flow

#### Automated

- [x] 2.1 `npm run lint` passes — bfba965
- [x] 2.2 `npm run build` passes — bfba965
- [x] 2.3 `npx astro sync` passes (new routes registered) — bfba965

#### Manual

- [x] 2.4 `/auth/signin` shows "Zapomniałeś hasła?" link
- [x] 2.5 `/auth/reset-password` renders form matching signin backdrop
- [x] 2.6 Invalid email → inline error under field
- [x] 2.7 Valid email → lands on `/auth/reset-password-sent`
- [x] 2.8 Inbucket shows "Reset hasła — 10xCards" email with `/auth/confirm?token_hash=…&type=recovery&next=/auth/update-password` link
- [x] 2.9 3rd rapid reset attempt on same email → rate-limit error
- [x] 2.10 Nonexistent email → still lands on `/auth/reset-password-sent` (enumeration-safe)

### Phase 3: Confirm callback + update-password flow

#### Automated

- [x] 3.1 `npm run lint` passes — bfba965
- [x] 3.2 `npm run build` passes — bfba965
- [x] 3.3 `npx astro sync` passes — bfba965

#### Manual

- [x] 3.4 End-to-end: request reset → click Inbucket link → land on `/auth/update-password` (no token in URL) → set new password → land on `/` signed in
- [x] 3.5 Wait >1h then click link → redirected to `/auth/reset-password?error=Link+wygas\u0142…`
- [x] 3.6 Submitting same password → `?error=Nowe+has\u0142o+musi+si\u0119+r\u00f3\u017cni\u0107…`
- [x] 3.7 Submitting 3-char password via curl → `weak_password` error surfaced
- [x] 3.8 `/auth/update-password` accessed directly while logged out → 302 to `/auth/reset-password?error=Sesja…`
- [x] 3.9 Sign out and sign in with new password → succeeds
- [x] 3.10 Sign in with old password → fails (`Invalid login credentials`)
