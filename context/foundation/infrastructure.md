---
project: 10xcards
researched_at: 2026-06-15
recommended_platform: Cloudflare Workers
runner_up: Vercel
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6 (SSR) + React 19 islands
  runtime: Cloudflare workerd
---

## Recommendation

**Deploy on Cloudflare Workers.**

The starter ships pre-wired with `@astrojs/cloudflare`; the developer has prior hands-on familiarity (interview Q3); and Cloudflare Workers is the only researched platform whose pricing model does not bill while a request awaits I/O — a structural advantage for an LLM-call workload where every generation waits 5–30s on OpenRouter. The 30s OpenRouter timeout sits well inside Workers' 90s outbound `fetch()` cap and the 30s default CPU limit (CPU isn't accumulated while idle on I/O). Cloudflare Workers scored 5/5 on the agent-friendly criteria and tied with Render at the top; familiarity and zero-config alignment with the starter break the tie.

## Platform Comparison

| Platform | CLI | Managed | Docs | Deploy API | MCP | Hard-stack fit |
|---|---|---|---|---|---|---|
| Cloudflare Workers | Pass | Pass | Pass | Pass | Pass | Pre-wired (`@astrojs/cloudflare` GA) |
| Vercel | Pass | Pass | Pass | Pass | Partial — MCP public beta + Claude OAuth bug | `@astrojs/vercel` GA (Node runtime); Edge deprecated |
| Netlify | Partial — rollback UI-only | Pass | Pass | Pass | Pass | `@astrojs/netlify` GA; **10s sync timeout breaks 30s OpenRouter call** without streaming |
| Fly.io | Pass | Partial — Dockerfile ownership | Pass | Pass | Partial — MCP stability unlabeled | `@astrojs/node` + Dockerfile required |
| Railway | Pass | Pass | Partial — no llms.txt | Pass | Pass | `@astrojs/node` via Railpack auto-detect |
| Render | Pass | Pass | Pass | Pass | Pass | `@astrojs/node` + render.yaml; free tier cold start 30–60s breaks LLM UX |

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

CPU-time-only billing means waiting on OpenRouter is free — uniquely well-aligned with a generation workload that idles on I/O. Multiple GA MCP servers (Workers Bindings, Observability, Docs). Subrequest cap raised from 50 to 10,000 in Feb 2026. Free tier (100k req/day) covers the entire 3-week MVP; paid tier $5/mo if traffic exceeds. The starter is pre-configured for this path — zero adapter migration work.

#### 2. Vercel

Astro 6 SSR works cleanly on the Node runtime (Edge deprecated as of 2026-06). 60s Hobby timeout fits 30s OpenRouter. Pricing risk: Hobby is non-commercial only — if 10xCards monetizes, Pro is $20/seat/mo from day one. MCP is in public beta with a known Claude Code OAuth bug (open issue #44223).

#### 3. Railway

Cleanest Node-adapter path. Railpack auto-detects Astro since March 2026. Mature `railway` CLI; MCP server GA and bundled into the CLI. $5/mo Hobby minimum, realistic total ~$5–10/mo at MVP scale. Idle services still bill (no scale-to-zero by default). Switching from Cloudflare means swapping `@astrojs/cloudflare` for `@astrojs/node` and dropping `astro:env/server` workerd-specifics.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **Adapter path churn.** The Pages → Workers-with-static-assets consolidation is recent. Older tutorials reference deprecated config (`@astrojs/cloudflare/directory` mode, `pages_build_output_dir`); solo devs hit contradictory advice mid-build.
2. **workerd is not Node.** Every npm dep needs Workers compatibility. Polyfills (`Buffer`, `stream`, certain Postgres drivers) intermittently break with `nodejs_compat` and `compatibility_date` changes.
3. **Subrequest cap is per-request.** Free tier 50/req is fine but a fan-out page (Supabase + OpenRouter + assets) can creep up. Paid is 10,000.
4. **Bundle size 10 MB compressed.** LLM-adjacent SDKs (tokenizers, retry libs) bloat fast. `wrangler deploy` blocks at the limit.
5. **Local dev doesn't fully mirror prod.** `wrangler dev` skips rate limits, DDoS rules, and some MIME behaviors.

### Pre-Mortem — How This Could Fail

10xCards launched on Cloudflare Workers and worked. Three weeks in, OpenRouter shipped a streaming-first response format and the team's fetch handler — built request/response, never streaming — returned truncated cards. UX degraded silently because the failure was "card content looks weird," not a hard 500. Worse, when users began binge-reviewing on weekends, the free tier's 100k requests/day cap hit twice; the team didn't know because alerting lived on Cloudflare's dashboard, not in their inbox. They upgraded to the $5/mo paid tier, but a vocal user had already posted the outage screenshot to social media. Six months in, the team needed a job to garbage-collect orphaned card drafts, and reached for a "Node-style background worker" — only then learning Workers Cron Triggers were the answer all along. The lesson: an edge-first platform punishes you for writing stateful, blocking-style code on top of it. The choice was sound; the team's mental model wasn't.

### Unknown Unknowns

- `astro:env/server` declares secrets via Astro's schema; in production they bind from Workers' secrets, not Pages' env vars. Mixing the two surfaces silently fails at runtime, not build time.
- `compatibility_date` is load-bearing. Bumping it can change `Buffer`/`stream`/`fetch` semantics. Treat the starter's pinned date like a dependency lockfile.
- Wrangler v4 renamed `wrangler publish` → `wrangler deploy` and removed `wrangler pages publish`. Older blog posts and AI suggestions are wrong about command names.
- Cloudflare's outbound `fetch()` has its own DNS path. Geo-restricted APIs sometimes resolve differently from Workers than from a Node server.
- CPU-time billing isn't free of runaway loops. Cloudflare does not sandbox CPU spend by default — set explicit cost alerts in the dashboard before launch.

## Operational Story

- **Preview deploys**: Wrangler creates a versioned preview URL on every `wrangler deploy` (no PR branch builds without GitHub Actions wiring). Routine PR previews require a GitHub Actions workflow that calls `wrangler deploy --env preview` and posts the URL — not in the starter today, add before opening external PRs.
- **Secrets**: `SUPABASE_URL`, `SUPABASE_KEY`, and the OpenRouter API key are set via `npx wrangler secret put <name>` (production) and `.dev.vars` (local). Astro reads them through `astro:env/server`. No dashboard step is required — rotation flow is `wrangler secret put <name>` with the new value.
- **Rollback**: `npx wrangler rollback [version-id]` reverts to a prior deployment (limit raised to 100 versions in Sep 2025). Typical revert <30s. Supabase migrations do not roll back automatically — coordinate schema changes with deploys.
- **Approval**: Routine `wrangler deploy` is agent-safe in a session. Human gates: rotating the OpenRouter key, dropping production Supabase tables, changing `compatibility_date` in `wrangler.jsonc`, bumping the paid plan, adjusting `nodejs_compat` flags.
- **Logs**: `npx wrangler tail` streams structured runtime logs to the terminal. Observability MCP (`observability.mcp.cloudflare.com/mcp`) exposes the same surface as a typed tool for agent use; pipeline logs live in the GitHub Actions run.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| OpenRouter switches to streaming-first responses; non-streaming handler returns truncated cards | Pre-mortem | M | H | Build the OpenRouter call as a `ReadableStream` from day one even if the UI consumes the full body; rerun an end-to-end card-generation test on every OpenRouter SDK bump. |
| Free-tier 100k req/day cap hit during traffic spikes; outage not noticed | Pre-mortem | L | M | Set a Cloudflare email alert at 80k req/day; upgrade to paid tier ($5/mo) before public launch. |
| `compatibility_date` bump silently changes `Buffer`/`stream`/`fetch` semantics | Unknown unknowns | L | H | Pin the date in `wrangler.jsonc`; treat any bump as a separate PR with a dedicated regression pass. |
| `astro:env/server` schema and Workers secret bindings diverge in production | Unknown unknowns | M | H | Smoke-test the full `astro:env` → Workers secret path in a preview deploy before any production deploy. |
| Bundle size approaches 10 MB compressed; `wrangler deploy` starts failing close to launch | Devil's advocate | L | M | Add `wrangler deploy --dry-run` to the CI pipeline; track bundle size as a build artifact. |
| `nodejs_compat` polyfill mismatch with Supabase JS / OpenRouter SDK | Devil's advocate | M | M | Pin SDK versions in `package.json`; smoke-test both clients on `wrangler dev` and on a deployed preview before merging dependency bumps. |
| Subrequest count creeps above 50 on free tier during dev | Devil's advocate | L | L | Upgrade to paid tier ($5/mo, 10,000 subrequests) before public launch. |
| Wrangler v4 command renames cause stale tutorial advice to misfire | Unknown unknowns | M | L | Reference Cloudflare's `/workers/llms.txt` over external tutorials; stick to `wrangler deploy` / `wrangler rollback` / `wrangler tail` / `wrangler secret put`. |
| Runaway CPU loop in paid Worker bills unbounded | Unknown unknowns | L | M | Set a Cloudflare billing alert; cap monthly Workers spend in the dashboard before launch. |
| Local `wrangler dev` misses production-only behaviors (rate limits, DDoS, MIME) | Devil's advocate | M | L | Deploy to a preview environment for any auth/payments/security-sensitive change; do not trust `wrangler dev` for these. |

## Getting Started

Note on the existing starter: `10x-astro-starter` already targets Cloudflare via `@astrojs/cloudflare`. Verify the adapter and Wrangler versions match the Workers-with-static-assets path documented at `https://developers.cloudflare.com/workers/framework-guides/web-apps/astro/` before adding deploy steps below — Cloudflare's Pages → Workers consolidation in late 2025/early 2026 means older starters may still reference the legacy `@astrojs/cloudflare/directory` mode.

1. **Confirm the starter targets Workers, not Pages.** Open `astro.config.mjs` and verify the adapter is `cloudflare()` from `@astrojs/cloudflare` (no `mode: 'directory'`). Check `wrangler.jsonc` exists (not `wrangler.toml` for Pages) and that `main` points at the SSR entry.
2. **Authenticate Wrangler:** `npx wrangler login` (opens browser). Confirm the right Cloudflare account with `npx wrangler whoami`.
3. **Set production secrets:** `npx wrangler secret put SUPABASE_URL`, `npx wrangler secret put SUPABASE_KEY`, plus the OpenRouter API key. Keep `.dev.vars` in sync for local dev.
4. **First deploy:** `npm run build && npx wrangler deploy`. Wrangler prints the production URL. Use `npx wrangler tail` to follow runtime logs in another terminal.
5. **Wire CI:** confirm the existing `.github/workflows/ci.yml` runs lint + build; add a deploy job that calls `wrangler deploy` on push to `master` using `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repo secrets.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup (only the deploy step is referenced; the full pipeline shape is owned by the existing CI workflow)
- Production-scale architecture (multi-region failover, dedicated support tiers, SLA commitments)
