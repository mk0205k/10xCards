# Repository Guidelines

10x Astro Starter — an Astro 6 SSR app (React 19 islands, Tailwind 4, Supabase auth, shadcn/ui) deployed to Cloudflare Workers. See `@README.md` for setup and `@CLAUDE.md` for the full convention set.

## Hard rules

- API routes (`src/pages/api/**/*.ts`) **must** export `const prerender = false`. The project runs in `output: "server"` mode; omit this and the endpoint will be statically prerendered and break at build.
- No Next.js directives (`"use client"`, `"use server"`) in React components. Interactivity is configured via Astro's `client:*` directives on the parent `.astro` island, not the React file.
- Server-only secrets flow through `astro:env/server` (declared in `@astro.config.mjs` under `env.schema`). Never import `SUPABASE_KEY` from client code.
- New Supabase tables: enable RLS and add granular per-operation, per-role policies in the same migration that creates the table.
- Cloudflare local dev reads `.dev.vars`; plain Node tooling (e.g. `supabase` CLI) reads `.env`. Keep both in sync.

## Project Structure

- `src/pages/` — Astro routes; API endpoints in `src/pages/api/`, auth pages in `src/pages/auth/`.
- `src/components/` — Astro by default; React (`.tsx`) only when the component needs client-side state. shadcn primitives in `src/components/ui/`.
- `src/lib/` — services and helpers (`supabase.ts`, `utils.ts` with `cn()`).
- `src/middleware.ts` — resolves the current user and gates `PROTECTED_ROUTES`.
- `supabase/migrations/` — migration files named `YYYYMMDDHHmmss_short_description.sql`.

## Build & Development Commands

See `@README.md` § Available Scripts and § Deployment.

## Coding Style & Naming

- TypeScript strict (`@tsconfig.json` extends `astro/tsconfigs/strict`); path alias `@/*` → `./src/*`.
- Merge Tailwind classes with `cn()` from `@/lib/utils` — do not concatenate class strings manually.
- `react-compiler/react-compiler` is set to `error`: components must be React-compiler-safe or lint (and CI) fail.
- Unused identifiers must be prefixed with `_` (`argsIgnorePattern`/`varsIgnorePattern` in ESLint config).
- Place extracted hooks in `src/components/hooks/`, business logic in `src/lib/services/`, shared entity/DTO types in `src/types.ts`.

## CI & Pre-commit

- GitHub Actions (`@.github/workflows/ci.yml`) runs `npm ci → npx astro sync → npm run lint → npm run build` on push/PR to `master`. Build needs `SUPABASE_URL` and `SUPABASE_KEY` repo secrets.
- husky + lint-staged auto-runs `eslint --fix` on `*.{ts,tsx,astro}` and `prettier --write` on `*.{json,css,md}` at commit time.
