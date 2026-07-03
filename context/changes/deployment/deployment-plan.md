# Cloudflare Workers Integration & First Production Deploy

## Context

`context/foundation/infrastructure.md` (researched 2026-06-15) selected **Cloudflare Workers** as the MVP platform for the 10xcards project. The starter is already pre-wired for it — `@astrojs/cloudflare` v13.5, `wrangler.jsonc` on the Workers-with-static-assets path, `nodejs_compat`, `compatibility_date: 2026-05-08`, and Supabase already reads secrets via `astro:env/server`.

What's missing for a first production deploy:
- Three API routes violate AGENTS.md's `prerender = false` hard rule.
- No `deploy` script in `package.json`; no `wrangler deploy` step in CI.
- Wrangler is not yet logged in for this session; production secrets are not yet bound to the Worker.
- No `context/deployment/` directory.
- The `astro:env/server` → Workers secrets path has never been smoke-tested in production (risk register row, infrastructure.md).

Outcome: a first production deploy from the developer's machine, followed by an automated CI/CD deploy job on push-to-master, with guardrails (rollback drill, billing alert, free-tier alert) in place before any public traffic. OpenRouter is referenced in `infrastructure.md` but is **not yet integrated** in code; the plan treats it as a future-work flag, not a deploy gate.

Progress indicator legend: `[ ]` not started, `[~]` in progress, `[x]` done, `[!]` blocked / needs human gate.

---

## Phase P — Prerequisites: CLI & Supabase setup `[x]`

Stand up the local toolchain and the Supabase production project **before** any other phase. Skip steps already complete. Every later phase assumes both are ready.

### P.1 — Local CLI toolchain

- `[x]` **Node.js 22.14.0** — pinned in `.nvmrc`. Verify: `node -v`. If using `nvm`: `nvm use` (or `nvm install` if missing).
- `[x]` **npm** — bundled with Node 22. Verify: `npm -v` ≥ 10.x.
- `[x]` **Install workspace deps**: `npm ci`. This installs Wrangler 4.90 from `devDependencies` — no global install required.
- `[x]` **Verify Wrangler**: `npx wrangler --version` → prints `4.x.x`.
- `[x]` **Cloudflare account** exists at <https://dash.cloudflare.com>. Free tier is sufficient for MVP (100k requests/day).

**Optional but useful:**
- Global Wrangler for tab-completion: `npm i -g wrangler`. Otherwise `npx wrangler` everywhere is fine.
- Add the Cloudflare Workers Observability MCP server (`observability.mcp.cloudflare.com/mcp`) after the first stable deploy — typed log surface for the agent.
- Verify `git config user.email` so future CI deploys can reference commit SHAs.

**Extra support — CLI edge cases:**
- **Windows + Node version manager**: prefer `nvm-windows` or `fnm` over manual installs. Mixing a system Node with an nvm Node causes Wrangler to bind the wrong `node_modules/.bin` paths.
- **Corporate proxy / SSL inspection**: set `HTTPS_PROXY` and `NODE_EXTRA_CA_CERTS` **before** `npm ci` and **before** `wrangler login`. The browser-auth callback to `localhost` will silently fail otherwise.
- **`npx wrangler` slow on first run (Windows)**: Defender real-time scan inspects every binary under `node_modules/.bin`. Add the project directory to Defender exclusions for dev only.
- **WSL users**: run all commands from WSL (`wsl bash`) for consistent line endings — Wrangler emits `\n` and Windows shell tools sometimes mangle them.

### P.2 — Supabase production project

- `[x]` **Supabase account** at <https://supabase.com> (free tier).
- `[x]` **Create a new project**: Organization → New Project. Region: pick the one geographically closest to your **users**, not the Worker. Workers run at the edge worldwide; the Supabase region dictates every auth/db round-trip latency.
- `[x]` Wait ~2 min for provisioning (status indicator turns green).
- `[x]` **Capture credentials** from Project Settings → API:
  - `Project URL` → becomes `SUPABASE_URL`.
  - `anon public` key → becomes `SUPABASE_KEY`. This is the public key; per AGENTS.md it still flows through `astro:env/server` so it never lands in client bundles.
  - **Do NOT capture or use the `service_role` key** — it bypasses RLS. This app does not need it.
- `[x]` **Auth → URL Configuration**:
  - **Site URL**: `http://localhost:4321` for now. Update to `https://<worker-name>.<account>.workers.dev` after Phase 4 prints it.
  - **Redirect URLs** allow-list: add `http://localhost:4321/**` and (once known) `https://<worker-name>.<account>.workers.dev/**`. Without these, email-confirmation links fail with a generic error.
- `[x]` **Auth → Providers**: confirm Email is enabled (default).
- `[x]` **Auth → Email Templates** (optional): customize the confirm-email template now or accept defaults for MVP.
- `[x]` **Populate `.dev.vars`** at the repo root (file is gitignored — see Phase 0):
  ```
  SUPABASE_URL=https://<project-ref>.supabase.co
  SUPABASE_KEY=<anon-public-key>
  ```
- `[x]` **Pre-deploy parity check**: `npm run dev` → visit `http://localhost:4321/auth/signup` → create a test user → confirm the row appears under **Authentication → Users** in the Supabase dashboard. If this works locally, the production deploy will work too. If it fails, fix here before touching Cloudflare.

**Extra support — Supabase edge cases:**
- **"Email rate limit exceeded"** during dev signups: free tier caps confirmation emails (~30/hour). Use disposable inboxes (mailinator, etc.) or temporarily set **Auth → Providers → Email → Confirm email = off** for early dev only — re-enable before launch.
- **`/auth/confirm-email` page missing**: `src/pages/api/auth/signup.ts:19` redirects to `/auth/confirm-email` after signup. If the page doesn't exist yet, post-signup 404s. Add a placeholder `src/pages/auth/confirm-email.astro` or treat as known-broken until built.
- **Anon key rotated / leaked**: Project Settings → API → Rotate. Then immediately re-run Phase 3 `wrangler secret put SUPABASE_KEY` with the new value and update `.dev.vars`. Workers pick up the new secret on the next request — no redeploy needed.
- **Project paused (free-tier inactivity)**: Supabase pauses free-tier projects after 7 idle days. If production starts returning 500s after a quiet week, check the Supabase dashboard before suspecting Workers.
- **RLS posture for future tables**: this app today has no application tables (Supabase manages the auth schema). Per AGENTS.md hard rule, the **first** `CREATE TABLE` migration must enable RLS and add granular per-operation, per-role policies in the same SQL file. Skipping RLS is a security incident in this codebase.
- **CORS or "Invalid Refresh Token" right after first prod deploy**: almost always a missing entry in the Supabase Redirect URLs list. Compare the actual `*.workers.dev` URL Wrangler printed against the allow-list.

---

## Phase 0 — Pre-flight (read-only verification) `[x]`

Validate the starter is on the Workers (not Pages) path and that no AGENTS.md hard rules are violated before any mutation.

- `[x]` Confirm `astro.config.mjs` adapter is `cloudflare()` from `@astrojs/cloudflare` with **no** `mode: 'directory'` argument. ✅ already verified — line 16 of `astro.config.mjs`.
- `[x]` Confirm `wrangler.jsonc` uses `assets.binding = "ASSETS"` and `assets.directory = "./dist"` (Workers-with-static-assets), **not** `pages_build_output_dir` (legacy Pages path). ✅ already verified.
- `[x]` Confirm `compatibility_flags` contains `"nodejs_compat"`. ✅ verified.
- `[x]` Confirm `.dev.vars` and `.env` are in `.gitignore`. ✅ verified.
- `[x]` Run `npm run lint && npm run build` locally and confirm both pass with the current `.dev.vars`. Capture the `dist/` size for the Phase 4 dry-run baseline. → **dist = 3.5 MB uncompressed** (well under 8 MB soft limit). Required two unblocks first: (a) added `"endOfLine": "auto"` to `.prettierrc.json` (Windows CRLF checkout was tripping every file), and (b) ran `npx astro sync` to generate the type declarations that `middleware.ts` / `supabase.ts` / `confirm-email.astro` depend on. Sitemap emits a warning about missing `site` — addressed in Phase 4.
- `[x]` **BLOCKER — fix before any deploy:** `src/pages/api/auth/signin.ts`, `signup.ts`, and `signout.ts` do **not** export `const prerender = false`. AGENTS.md hard rule:
  > API routes (`src/pages/api/**/*.ts`) must export `const prerender = false`. The project runs in `output: "server"` mode; omit this and the endpoint will be statically prerendered and break at build.

  Fixed in Phase 1.

---

## Phase 1 — Local prep `[x]`

Local-only, additive changes. Reversible. No prod touch.

- `[x]` Add `export const prerender = false;` to the top of all three API routes:
  - `src/pages/api/auth/signin.ts`
  - `src/pages/api/auth/signup.ts`
  - `src/pages/api/auth/signout.ts`
- `[x]` Add a `deploy` script to `package.json`:
  ```json
  "deploy": "astro build && wrangler deploy",
  "deploy:dry": "astro build && wrangler deploy --dry-run --outdir=dist-dry"
  ```
- `[x]` Create `.dev.vars.example` mirroring `.env.example` (so contributors know which Workers-local secrets to populate). Names only, no values:
  ```
  SUPABASE_URL=
  SUPABASE_KEY=
  ```
- `[x]` Create `context/deployment/` directory (the eventual home of `deploy-plan.md`, per CLAUDE.md hand-off).
- `[x]` Generate Worker types for editor autocomplete (optional but cheap): `npx wrangler types`. Adds `worker-configuration.d.ts`; gitignore it if you don't want it tracked. → generated; added to `.gitignore`.
- `[x]` Re-run `npm run build` and confirm the three API routes now show as **server-rendered** (not prerendered) in the Astro build summary. → build clean; `dist/` contains only `client/` and `server/` (no `api/auth/*.html`), confirming the three routes are in the SSR bundle.

**Why this phase comes before account setup:** none of these require a Cloudflare account; failing fast here keeps the human-gate phases cheap.

---

## Phase 2 — Cloudflare account & Wrangler auth `[x]`

Human gate. Touches the local Wrangler credential store; no production mutation.

- `[x]` Run `npx wrangler login` in an interactive terminal (opens browser). Confirm the correct Cloudflare account is selected if multiple are visible.
- `[x]` Run `npx wrangler whoami` and confirm: account email, account ID, token scopes include Workers Scripts:Edit. **Record the Account ID** — needed for CI in Phase 6. → `mk@betasi.pl` / Account ID `202105df17f5c8d8a06c0d83de11d86b` (OAuth token, workers write scope present).
- `[x]` Confirm a production Supabase project exists and you have its URL + anon key handy. (If not, provision before Phase 3.)

**Extra support — token / login edge cases:**
- If `wrangler login` opens the wrong account: run `npx wrangler logout`, clear the browser session for `dash.cloudflare.com`, retry.
- If the machine is headless (CI, devcontainer): skip the browser flow — export `CLOUDFLARE_API_TOKEN=<token>` and `CLOUDFLARE_ACCOUNT_ID=<id>` instead; Wrangler picks them up.
- Required token scopes (for the Phase 6 CI token too): **Account → Workers Scripts: Edit**, **Account → Account Settings: Read**, **User → User Details: Read**, **Account → Workers R2 Storage: Edit** (only if R2 added later — N/A today).

---

## Phase 3 — Production secrets `[x]`

Human gate. First production mutation: binds Supabase credentials into the Worker's secret store. Per AGENTS.md, `SUPABASE_KEY` is server-only and must never reach client bundles — `astro:env/server` already enforces this; this step makes the same secret available at runtime in production.

- `[x]` `npx wrangler secret put SUPABASE_URL` — bound to Worker `10x-astro-starter` with production URL `https://qxflwgkkhfgvgmoqkszm.supabase.co`.
- `[x]` `npx wrangler secret put SUPABASE_KEY` — bound to Worker `10x-astro-starter` with production `anon` `public` key (new `sb_publishable_*` format).
- `[x]` `npx wrangler secret list` — confirmed both `SUPABASE_URL` and `SUPABASE_KEY` present as `secret_text` (values never displayed).
- `[x]` `.dev.vars` synced with `.env` at repo root — both hold the production values per AGENTS.md hard rule. `.dev.vars.example` recreated (was missing despite Phase 1 marking it done).

**Extra support — secret edge cases (Windows shell quirks):**
- On PowerShell, `wrangler secret put` reads from stdin; if the prompt hangs, try `echo <value> | npx wrangler secret put NAME` (bash) or `"<value>" | npx wrangler secret put NAME` (PowerShell). Be aware the value lands in shell history — clear it after (`history -d` on bash, `Clear-History` on PowerShell).
- If you bind the wrong value: re-run `wrangler secret put` with the new value (overwrites). No need to delete first.
- Future secret rotation flow is identical — `wrangler secret put NAME` with the new value, then redeploy is **not required** (Workers picks up the new secret on next request).

---

## Phase 4 — First production deploy `[x]`

- `[x]` `npm run lint` — exit 0 (only benign `astro-eslint-parser` warnings about `projectService` fallback).
- `[x]` `npm run build` — exit 0. Server built in 16.40s. Sitemap warning about missing `site` surfaced (addressed later in this phase).
- `[x]` `npx wrangler deploy --dry-run --outdir=dist-dry` — bundle **1911.24 KiB / gzip 390.73 KiB** (~20× headroom under the 8 MB soft limit). Bindings surfaced: SESSION (KV), IMAGES, ASSETS.
- `[x]` `npx wrangler deploy` — first attempt uploaded the Worker but failed to publish to `workers.dev`: account had no `workers.dev` subdomain registered. Cloudflare removed the `/workers/onboarding` URL from the dashboard, so the fix was to run `npx wrangler deploy` **interactively** in a user terminal, answer `Y` to the "register subdomain now?" prompt, and pick a name.
  - **Account subdomain**: `mk-betasi` (chosen 2026-07-03).
  - **Production URL**: `https://10x-astro-starter.mk-betasi.workers.dev`.
  - **Version ID (first successful deploy)**: `85d8f71d-0838-4baa-bc68-bbc5a0cd6344` (interactive) → then `8642cae4-9129-46e6-a8e3-b16bf019fd5b` (after `site:` config).
  - **KV namespace auto-provisioned**: `10x-astro-starter-session` (`dd37693942794217a12b3e776dc3f37d`) for Supabase sessions.
- `[x]` URL recorded here inline; `context/deployment/deploy-plan.md` produced separately in Phase 8.
- `[x]` `astro.config.mjs` gained `site: "https://10x-astro-starter.mk-betasi.workers.dev"`. `npm run deploy` (build + wrangler deploy) succeeded — sitemap warning gone; `sitemap-index.xml` + `sitemap-0.xml` uploaded as new assets.

**⚠️ Follow-up before Phase 5:** the KV namespace `10x-astro-starter-session` binding is inherited across deploys but was NOT declared in `wrangler.jsonc` — Cloudflare auto-created it on first deploy. Confirm the binding survives future deploys; if it goes missing after a CI deploy in Phase 6, pin it explicitly in `wrangler.jsonc` under `kv_namespaces`.

**Extra support — first-deploy edge cases:**
- Bundle exceeds size limit: run `npx wrangler deploy --dry-run` again with `--minify` (if not on by default) and inspect `dist-dry/` for unexpectedly large files. Typical bloat sources for this stack: dev-only deps leaking through (`supabase` CLI is in `devDependencies` already ✅), source maps, unused shadcn primitives. Remove and retry.
- `nodejs_compat` mismatch surfaces as a runtime error like `Module not found: node:stream`. Fix path: confirm `compatibility_flags: ["nodejs_compat"]` in `wrangler.jsonc` (✅ present), and that the offending dep is in `dependencies` not transitively pulled by a dev-only one.
- DNS-resolution gotcha (infrastructure.md unknown-unknown): Workers' outbound `fetch()` uses Cloudflare's DNS. If Supabase auth requests fail with a timeout but work locally, suspect this and check the Supabase project's allowed-origins list.

---

## Phase 5 — Production smoke test `[ ]`

Verify the full `astro:env/server` → Workers-secret path works in production. This is the explicit mitigation for an infrastructure.md High-impact risk row.

In one terminal:
- `[ ]` `npx wrangler tail` — streams structured logs.

In a browser:
- `[ ]` Visit the `*.workers.dev` URL — homepage renders, no console errors.
- `[ ]` Visit `/auth/signup` — page renders.
- `[ ]` Sign up a throwaway user — confirm redirect to `/auth/confirm-email` and the corresponding Supabase row exists in the dashboard.
- `[ ]` Sign in with that user — confirm redirect to `/` and the auth cookie is set (DevTools → Application → Cookies).
- `[ ]` Visit `/dashboard` while signed in — protected route renders.
- `[ ]` Sign out — confirm redirect to `/` and cookie clears.
- `[ ]` Visit `/dashboard` while signed out — confirm middleware redirect.

Watch `wrangler tail` for any 5xx, polyfill warnings, or `astro:env` config errors during the above.

---

## Phase 6 — CI/CD deploy automation `[ ]`

Push-to-master deploys via GitHub Actions, per `infrastructure.md` Getting Started step 5.

- `[ ]` In Cloudflare dashboard, **create a scoped API token** (My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template, then narrow to just this Worker if possible). Scopes: Workers Scripts:Edit, Account Settings:Read, User Details:Read. Save the token value once shown.
- `[x]` Add repo secrets in GitHub (Settings → Secrets and variables → Actions): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. Confirm `SUPABASE_URL` and `SUPABASE_KEY` are already present (CI build needs them).
- `[ ]` Extend `.github/workflows/ci.yml`. Add a `deploy` job that runs only on push to `master`, depends on `ci`, and calls `wrangler deploy`:
  ```yaml
  deploy:
    needs: ci
    if: github.event_name == 'push' && github.ref == 'refs/heads/master'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npx astro sync
      - run: npm run build
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_KEY: ${{ secrets.SUPABASE_KEY }}
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: deploy
  ```
- `[ ]` Push the workflow change on a branch, open a PR — CI build runs but deploy job is skipped (because `if:` gates on push to master). Merge.
- `[ ]` After merge, watch the Actions run — deploy job succeeds. Hit the production URL — change is live.
- `[ ]` Note: this is **production-on-merge**, not preview-per-PR. Adding preview previews requires a separate `wrangler deploy --env preview` job + `[env.preview]` block in `wrangler.jsonc`. Out of scope for first deploy; revisit when opening to external contributors.

**Extra support — CI deploy edge cases:**
- "Authentication error [code: 10000]" from `wrangler-action`: token is wrong scope or expired. Regenerate with the scopes listed in Phase 2.
- Deploy job succeeds but the site shows a 500: secrets in the Worker were never set (Phase 3). The CI deploy job does **not** set secrets — they are bound to the Worker out-of-band and persist across deploys.
- Two deploys racing (manual `wrangler deploy` + CI run): Cloudflare serializes; the last write wins. Avoid by always letting CI deploy after Phase 6 is live.

---

## Phase 7 — Observability & rollback drill `[ ]`

Practice rollback before you need it.

- `[ ]` `npx wrangler deployments list` — confirm the production deployment appears with a version ID.
- `[ ]` Make a trivial change (e.g. a comment in `src/pages/index.astro`), commit, push, wait for CI to deploy.
- `[ ]` `npx wrangler deployments list` — confirm the new version. Note both version IDs.
- `[ ]` `npx wrangler rollback <previous-version-id>` — Wrangler should revert in < 30s.
- `[ ]` Hit the production URL, confirm the trivial change is gone.
- `[ ]` `npx wrangler deployments list` — confirm the rollback created a new deployment that points to the prior bundle.
- `[ ]` Roll forward to the latest by running `npx wrangler deploy` from the latest local main (or trigger CI). Confirm site is back to current.
- `[ ]` Confirm `npx wrangler tail` still streams logs from production.

**Extra support — rollback edge cases:**
- Rollback never reverts Supabase migrations. If a deploy introduced a migration, plan the **schema** rollback in tandem (or design migrations to be backwards-compatible — the AGENTS.md RLS-on-create rule helps here).
- Rollback history is capped (100 versions per `infrastructure.md`). Very old rollbacks are unreachable; redeploying from git history is the fallback.

---

## Phase 8 — Guardrails & artifact `[ ]`

Lock in the alerts and the audit trail before public traffic.

- `[!]` In the Cloudflare dashboard, set a **billing alert** on the account (Billing → Notifications). Even on the free tier, this catches a runaway CPU loop on a paid plan upgrade later (infrastructure.md unknown-unknown).
- `[!]` Set an **email alert at 80k requests/day** for the Worker (Workers & Pages → the Worker → Settings → Alerts). The free-tier ceiling is 100k/day; 80% gives lead time to upgrade to the $5/mo paid plan before users see 429s.
- `[ ]` Pin policy in `AGENTS.md` (or `CLAUDE.md`): any change to `wrangler.jsonc`'s `compatibility_date` or `compatibility_flags` ships as its **own PR** with a dedicated regression pass. Quote: "Treat the starter's pinned date like a dependency lockfile." (infrastructure.md unknown-unknown).
- `[ ]` Write `context/deployment/deploy-plan.md` capturing: production URL, account ID, deploy commands actually run, secret names bound, CI workflow path, rollback procedure, and any deviations from this plan. This is the load-bearing audit artifact the next lesson's milestone planning consumes.

---

## External integrations — current state and forward-look

- **Supabase (in scope, production):** SSR client at `src/lib/supabase.ts` reads `SUPABASE_URL` / `SUPABASE_KEY` from `astro:env/server`. Validated in Phase 5. Future tables must enable RLS in the same migration (AGENTS.md hard rule).
- **OpenRouter (NOT in code today):** `infrastructure.md` references it heavily because it shapes the platform-fit argument (Workers' CPU-only billing favours I/O-bound LLM calls). When introduced:
  - Build the call as a `ReadableStream` from day one, even if the UI consumes the full body — directly addresses the High-likelihood/High-impact pre-mortem row in the risk register.
  - Add the API key via `wrangler secret put OPENROUTER_API_KEY` (mirrors the Supabase flow); declare it in `astro.config.mjs` `env.schema` with `context: "server", access: "secret"`.
  - Add an end-to-end card-generation smoke test that runs on every OpenRouter SDK bump.
  - Until then, no Phase-3 step is needed for OpenRouter.

---

## Critical files

- `astro.config.mjs` — adapter config, `env.schema`, `site` URL (Phase 4).
- `wrangler.jsonc` — Workers entry, compatibility date/flags, ASSETS binding. **Do not modify in this plan; treat as a lockfile.**
- `src/pages/api/auth/signin.ts`, `signup.ts`, `signout.ts` — add `export const prerender = false;` (Phase 1).
- `src/lib/supabase.ts` — already correct (no edits in this plan).
- `src/middleware.ts` — already correct (no edits in this plan).
- `package.json` — add `deploy` and `deploy:dry` scripts (Phase 1).
- `.github/workflows/ci.yml` — add `deploy` job (Phase 6).
- `.dev.vars.example` — new file (Phase 1).
- `context/deployment/deploy-plan.md` — new audit artifact (Phase 8).

## Reuse — utilities already in the repo (do not duplicate)

- `createClient` from `src/lib/supabase.ts` — the only correct way to construct a Supabase client in this codebase; handles `astro:env/server` and `parseCookieHeader`.
- `PROTECTED_ROUTES` constant in `src/middleware.ts` — extend it rather than adding parallel auth checks.
- `cn()` from `src/lib/utils.ts` — Tailwind class merging.

## Verification — end-to-end checklist

Run after Phase 6 has shipped at least one CI-driven deploy:

- `[ ]` `npm run lint && npm run build` clean locally.
- `[ ]` Pushing a trivial commit to `master` triggers GitHub Actions, build green, deploy green.
- `[ ]` Production URL serves the homepage; `wrangler tail` shows the request.
- `[ ]` Sign-up flow: new user lands in the Supabase dashboard.
- `[ ]` Sign-in → `/dashboard` → sign-out round-trip clean, with `wrangler tail` showing no 5xx.
- `[ ]` `wrangler deployments list` shows ≥ 2 production deployments.
- `[ ]` `wrangler rollback` reverts a known-good prior deploy in < 30s.
- `[ ]` Cloudflare dashboard shows configured billing alert and 80k/day request alert.
- `[ ]` `context/deployment/deploy-plan.md` exists and records production URL + secret names + rollback procedure.

## References

- `context/foundation/infrastructure.md` — recommendation, risk register, operational story (this plan operationalizes its Getting Started + Risk Register sections).
- `context/foundation/tech-stack.md` — hard constraints (Astro 6 SSR + workerd).
- `AGENTS.md` — hard rules (prerender = false, astro:env/server, RLS, .dev.vars/.env parity).
- `CLAUDE.md` — lesson 5 chain; the `deploy-plan.md` artifact is the hand-off to the next lesson.
