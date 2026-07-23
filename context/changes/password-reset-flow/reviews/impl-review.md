<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Password Reset via Email (S-04)

- **Plan**: `context/changes/password-reset-flow/plan.md`
- **Scope**: Full plan (Phase 1, 2, 3)
- **Date**: 2026-07-23
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical / 3 warnings / 3 observations
- **Commit under review**: `bfba965` on branch `feat/password-reset-flow`

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

Automated verification (lint / astro sync / build) all pass in the worktree. Manual verification (17 checkboxes across 3 phases) is entirely unrecorded — the implementer merged Phase 1→2→3 without pausing at the plan's explicit "manual confirmation" gates.

## Findings

### F1 — Open-redirect via `next` param in `/auth/confirm`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: `src/pages/auth/confirm.astro:8,24`
- **Detail**: The frontmatter reads `const next = Astro.url.searchParams.get("next") ?? "/auth/update-password";` and later does `return Astro.redirect(next);` with no allowlist or same-origin check. If an attacker rewrites the `next` query on a legitimate recovery link (email forwarded / scraped / copied), the flow will authenticate the user via `verifyOtp` and then bounce them to an arbitrary URL — including protocol-relative (`//evil.com`) and absolute (`https://evil.com`) targets. This is a phishing pivot, not direct cookie theft (cookies stay origin-scoped), but it converts our verified auth callback into a click-through amplifier for lookalike-domain attacks. The plan's Critical Implementation Details section documented the PKCE `next` flow but did not constrain it.
- **Fix ⭐**: Constrain `next` to a same-origin path before redirect: `const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/auth/update-password";`. One-line change, keeps the plan's `next` semantic for our own routes only.
  - Strength: Removes the phishing vector entirely; costs nothing at the current call site (we only ever set `next=/auth/update-password` in the email template).
  - Tradeoff: Minor — future flows that legitimately want to send users elsewhere post-verify will need to reason about the allowlist.
  - Confidence: HIGH — same pattern is idiomatic in Supabase's own SSR docs.
  - Blind spot: None significant.
- **Decision**: FIXED (safeNext allowlist applied at confirm.astro:8-9,24)

### F2 — Unplanned `eslint.config.js` change without amendment

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: `eslint.config.js:64-72`
- **Detail**: The astro config block gained `"@typescript-eslint/no-misused-promises": "off"` scoped to `**/*.astro`. Rationale (in-code comment): astro-eslint-parser produces frontmatter AST nodes without `.parent`, crashing the type-aware rule on `return Astro.redirect(...)` after an `await`. Verified: the rule is scoped only to `.astro`, and remains active for `.ts`/`.tsx` via `baseConfig`. The workaround is reasonable — but it wasn't in the plan and no lesson has been appended to `context/foundation/lessons.md` codifying the parser bug for future SSR-Astro work. The commit body and a memory note document it locally, but neither is on the repo's plan/lessons paper trail.
- **Fix A ⭐ Recommended**: Append a lesson to `context/foundation/lessons.md` via `/10x-lesson` capturing the parser-bug tripwire, so any future Astro SSR page with `await + return Astro.redirect(...)` doesn't rediscover this by crashing lint.
  - Strength: Turns implementation-time discovery into a durable review prior; matches the exact use case lessons.md exists for.
  - Tradeoff: One extra file touched; append-only, low ceremony.
  - Confidence: HIGH — pattern-fit for lessons.md is textbook.
  - Blind spot: None.
- **Fix B**: Amend the plan retroactively with a Phase 3 addendum acknowledging the eslint override.
  - Strength: Keeps the plan as source of truth complete.
  - Tradeoff: Plan drift; retro-amendments erode "plan-as-contract".
  - Confidence: MEDIUM — depends on team convention.
  - Blind spot: Whether other slices retroactively amended.
- **Decision**: ACCEPTED-AS-RULE (lesson appended to lessons.md; eslint override already in place)

### F3 — `supabase/templates/recovery.html` created despite plan's "No recovery.html file"

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `supabase/templates/recovery.html`, `supabase/config.toml:239-241`
- **Detail**: The plan's "What We're NOT Doing" section states verbatim: *"No custom-branded email template. Default Supabase template body, only overridden to point at our `/auth/confirm` callback with `token_hash`+`type`+`next`. Subject may be renamed to Polish. No `recovery.html` file."* But Phase 1's "Changes Required" step 5 explicitly instructs creating `supabase/templates/recovery.html` with a PL body. The plan is internally contradictory: the "no file" line and the "create this HTML" instruction contradict each other. The implementer picked the pragmatic reading (create the file) — necessary because the default Supabase recovery template's link shape (`{Supabase-URL}/auth/v1/verify?...`) does NOT integrate with our SSR PKCE flow and MUST be overridden with a `token_hash`-shaped link at our `/auth/confirm` route. The resulting file is 5 lines, unbranded, purely functional.
- **Fix**: Reconcile the plan retroactively — remove the "No `recovery.html` file" line from "What We're NOT Doing" (documentation-only edit, no code change).
- **Decision**: FIXED (plan.md "What We're NOT Doing" bullet rewritten to reflect the minimal-body override without contradicting itself)

### F4 — Progress section entirely unchecked (0/21)

- **Severity**: 📌 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `context/changes/password-reset-flow/plan.md:346-394`
- **Detail**: The plan's `## Progress` section defines 21 checkboxes (3 phases × ~7 items each) with the convention `- [x] — <commit sha>` on completion. Not one is ticked, and no commit SHAs are appended. Code matches plan intent (per drift check: 12/12 planned files MATCH), so this is a bookkeeping miss, not an implementation miss. Also, all three "Implementation Note: pause for manual confirmation before proceeding" gates were bypassed — Phase 1→2→3 landed in one commit without the human-in-the-loop verification the plan required.
- **Fix**: Backfill the Progress checkboxes for the automated items (1.1–1.3, 2.1–2.3, 3.1–3.3) with `bfba965`; leave manual items unchecked until the e2e walkthrough is done.
- **Decision**: FIXED (9 automated checkboxes backfilled with bfba965 SHA; manual items intentionally left unchecked pending user e2e)

### F5 — FormData `.get(...) as string` cast without null-guard (mirrored pre-existing pattern)

- **Severity**: 📌 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/pages/api/auth/reset-request.ts:9`, `src/pages/api/auth/reset-confirm.ts:11`
- **Detail**: Both new endpoints do `const email = form.get("email") as string;` / `const password = form.get("password") as string;`. `FormData.get` actually returns `FormDataEntryValue | null`. A crafted request omitting the field passes `null` to `resetPasswordForEmail`/`updateUser`, which throws a non-`AuthError` runtime exception → 500 instead of a graceful `?error=…` redirect. This mirrors `signin.ts:8-9` and `signup.ts` exactly — the plan told us to "mirror the S-01 patterns line-by-line", which we did. The pattern itself is a latent bug across all four auth endpoints.
- **Fix**: Not in scope for this slice. File a follow-up to harden all four endpoints together (`signin.ts`, `signup.ts`, `reset-request.ts`, `reset-confirm.ts`) rather than fixing two here.
- **Decision**: SKIPPED (deferred to follow-up covering all 4 auth endpoints together)

### F6 — `React.SubmitEvent<HTMLFormElement>` is not a real React type (pre-existing across auth forms)

- **Severity**: 📌 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/components/auth/ResetPasswordForm.tsx:30`, `src/components/auth/UpdatePasswordForm.tsx:44`
- **Detail**: Both new form islands type the submit handler as `React.SubmitEvent<HTMLFormElement>`. `@types/react` exports no `SubmitEvent`; the correct type is `React.FormEvent<HTMLFormElement>`. TypeScript compiles because `SubmitEvent` is a DOM-global type that happens to be assignable in this position, and `strictTypeChecked` doesn't flag it. `SignInForm.tsx:36` and `SignUpForm.tsx:51` use the exact same wrong type — the new forms mirror the existing pattern faithfully.
- **Fix**: Fix all four forms together as a small tidy-up follow-up; not blocking this PR.
- **Decision**: SKIPPED (deferred to follow-up covering all 4 auth forms together)

## Follow-up candidates (not findings)

- **AAL-gate on `/auth/update-password`** — plan explicitly out of scope; anyone with a stolen session cookie can reset a password. Belongs in a future security slice.
- **`PUBLIC_SITE_URL` runtime guard** — env schema is `optional: false`, so build should fail if missing; a defensive runtime check in `reset-request.ts` would be belt-and-braces.
- **`gh secret set PUBLIC_SITE_URL`** — reminder to set the repo secret before this ships to prod, or CI build will fail on the env-schema check.
