<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Globalne menu nawigacyjne

- **Plan**: `context/changes/global-navigation-menu/plan.md`
- **Scope**: Full plan (Phase 1-4, all `[x]`)
- **Date**: 2026-07-27
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical / 3 warnings / 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Automated gates re-run fresh: `npm run lint` 0 errors (24 pre-existing `no-console` warnings), `npm run prebuild` i18n-parity OK 193 keys, `npm run build` 16.64s. All Progress rows `[x]` with SHAs.

## Findings

### F1 — `lucide-react` `MenuIcon` used despite plan saying "bez Lucide"

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: `src/components/MobileNav.tsx:1, 27`
- **Detail**: Plan Contract for MobileNav explicitly said "`<SheetTrigger>` jako hamburger button (ikona SVG lub 3 kreski w CSS — **bez Lucide, żeby nie dodawać zależności**)" (plan.md:145). Actual code imports `MenuIcon` from `lucide-react`. However — `lucide-react@^1.14.0` was already in `package.json` (pre-existing), so no new dep was added; the plan's stated reason ("nie dodawać zależności") does not materialize. But the letter of the plan was violated.
- **Fix A ⭐ Recommended**: Keep `MenuIcon` and add a plan addendum
  - Strength: `lucide-react` was already a dep before Phase 2; using `MenuIcon` doesn't grow the bundle beyond what shadcn Sheet already imports (`XIcon` at `sheet.tsx:2`). The "bez Lucide" guidance was based on a false assumption. Updating the plan makes future reviews accurate.
  - Tradeoff: Plan becomes a slightly moving target.
  - Confidence: HIGH — dep audit confirms lucide-react was pre-existing.
  - Blind spot: None significant.
- **Fix B**: Replace `MenuIcon` with an inline 3-line SVG in MobileNav
  - Strength: Literally satisfies the plan's Contract; zero dep footprint for this specific import.
  - Tradeoff: Inconsistent with `sheet.tsx:2` which already uses `lucide-react` `XIcon`; would look worse than the current state.
  - Confidence: MED — the shadcn primitive itself has `XIcon`, so removing `MenuIcon` from MobileNav wouldn't remove `lucide-react` from the bundle.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A (plan addendum added at Phase 2 Change #3 — no code change needed; lucide-react confirmed pre-existing)

### F2 — `pathname` prop optional, not required (plan Contract diverges)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/components/Topbar.astro:7-9, 12`
- **Detail**: Plan Contract (plan.md:98) said `interface Props { pathname: string }` — required. Actual: `pathname?: string` with default `""`. This adaptation was documented mid-Phase-1 (Welcome.astro rendered `<Topbar />` without a prop, so required would have broken build). Post-Phase-3, `Welcome.astro` no longer imports Topbar and the only caller (Layout.astro:43) always passes `pathname={pathname}` — the transient reason for optional is gone. A future caller could mount Topbar without pathname and silently get no active-state highlighting.
- **Fix**: Make `pathname` required again — change `pathname?: string` to `pathname: string` and drop the `= ""` default in `Topbar.astro`. Layout.astro:43 already passes the prop, so no other change needed.
- **Decision**: FIXED — Topbar.astro:7-9,12 now declares `pathname: string` required, default dropped. Verified via `npx astro check` (only pre-existing rate.ts errors remain).

### F3 — Missing `aria-current="page"` on active nav links

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/components/Topbar.astro:26-48`, `src/components/MobileNav.tsx:37-51`
- **Detail**: Active nav links receive visual styling (`underline-offset-4 text-purple-100`) via `linkActive` class, but no `aria-current="page"` attribute is set on the `<a>` element. Screen readers won't announce which nav item corresponds to the current page. This is standard practice for nav-with-active-state and matches the plan's Success Criteria for active state ("aktywna pozycja zaznaczona wizualnie" implies both visual and semantic).
- **Fix**: Add `aria-current={pathname === href ? "page" : undefined}` on each nav `<a>` in Topbar.astro's zalogowany branch (5 links) and MobileNav.tsx's `navLinkClass` sites (5 links). Zero visual impact, proper a11y semantics.
- **Decision**: FIXED — Added `navLinkAria(href)` helper in both Topbar.astro and MobileNav.tsx, applied on all 7 nav links per component (5 protected + 2 auth); lint green.

### F4 — Dead i18n key `topbar_menu_close` (sr-only "Close" hardcoded in EN)

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency / i18n
- **Location**: `messages/pl.json:13`, `messages/en.json:13`, `src/components/ui/sheet.tsx:69`
- **Detail**: Plan Phase 2 added `topbar_menu_close` key (PL: "Zamknij menu" / EN: "Close menu"), but the key is not referenced anywhere in code. The Sheet primitive's default close button uses a hardcoded `<span className="sr-only">Close</span>` (sheet.tsx:69), so screen readers announce "Close" in English regardless of locale. Mirrors the existing `dialog.tsx:63` pattern, so consistent with the repo, but the new i18n key suggests intent to localize.
- **Fix**: Either (a) remove `topbar_menu_close` from both message files as unused, or (b) wire it up — swap the default close in `SheetContent` (or override at MobileNav call site) with `aria-label={m.topbar_menu_close()}`. Option (b) is more useful for a11y in PL; option (a) is minimal cleanup.
- **Decision**: FIXED via option (a) — removed `topbar_menu_close` from `messages/pl.json` and `messages/en.json`; parity gate 192 kluczy w obu locale'ach.

### F5 — MobileNav renders empty `<span>` when user has no email

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: `src/components/Topbar.astro:19`, `src/components/MobileNav.tsx:35`
- **Detail**: Topbar.astro:19 constructs `mobileNavUser = user ? { email: user.email ?? "" } : null`; MobileNav.tsx:35 renders `{user.email}` inside a `<span>`. If Supabase returns a user without email (unlikely — email/password auth requires email — but possible for OAuth providers if the project ever adds them), an empty `<span>` is rendered. Not a bug today; a latent brittleness if auth providers expand.
- **Fix**: Guard the render: `{user.email && <span className="pb-2 text-sm text-blue-100/70">{user.email}</span>}` in MobileNav.tsx and analogously in Topbar.astro. Or fall back to a display name (would require schema).
- **Decision**: FIXED — guard added at Topbar.astro:30 and MobileNav.tsx:39 (`{user.email && <span>…</span>}`).

### F6 — `MobileNav` hydrates on desktop viewport where it's `hidden`

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Performance)
- **Location**: `src/components/Topbar.astro:31, 61`
- **Detail**: MobileNav mounts with `client:load` (Radix Dialog + lucide + LanguageSwitcher hydrate on every page load), but is wrapped in `<div class="md:hidden">` — hidden entirely on desktop. Component is stateless and minimal (no useState, useEffect, useRef), so hydration cost is small (~5-10KB). Not a blocker.
- **Fix A ⭐ Recommended**: Switch to `client:media="(max-width: 767px)"`
  - Strength: React island hydrates only when the viewport actually needs it; desktop users pay zero hydration cost. Matches the `md:hidden` visibility gate exactly.
  - Tradeoff: On viewport resize past the breakpoint (desktop → mobile without reload), the island isn't hydrated. But `md:hidden` also flips visibility instantly, so a desktop-only user resizing to mobile would need to reload for the hamburger to work — acceptable edge case.
  - Confidence: HIGH — standard Astro directive, documented in Astro 6.
  - Blind spot: None significant.
- **Fix B**: Keep `client:load`
  - Strength: Zero risk of "hamburger doesn't hydrate" edge cases.
  - Tradeoff: Every desktop page ships an unused React island (~5-10KB gzip).
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — Topbar.astro:32,62 now `client:media="(max-width: 767px)"`; build green.
