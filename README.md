# 10x Astro Starter

![](./public/template.png)

A modern, opinionated starter template for building fast, accessible web applications.

## Tech Stack

- [Astro](https://astro.build/) v6 - Modern web framework with server-first rendering
- [React](https://react.dev/) v19 - UI library for interactive components
- [TypeScript](https://www.typescriptlang.org/) v5 - Type-safe JavaScript
- [Tailwind CSS](https://tailwindcss.com/) v4 - Utility-first CSS framework
- [Supabase](https://supabase.com/) - Authentication and backend-as-a-service
- [Cloudflare Workers](https://workers.cloudflare.com/) - Edge deployment runtime

## Prerequisites

- Node.js v22.14.0 (as specified in `.nvmrc`)
- npm (comes with Node.js)

## Getting Started

1. Clone the repository:

```bash
git clone https://github.com/przeprogramowani/10x-astro-starter.git
cd 10x-astro-starter
```

2. Install dependencies:

```bash
npm install
```

3. Set up Supabase and configure environment variables — see [Supabase Configuration](#supabase-configuration) below.

4. Create a `.dev.vars` file for local Cloudflare dev secrets:

```bash
cp .env.example .dev.vars
```

5. Run the development server:

```bash
npm run dev
```

## Available Scripts

- `npm run dev` - Start development server (Cloudflare workerd runtime)
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint with type-checked rules
- `npm run lint:fix` - Auto-fix ESLint issues
- `npm run format` - Run Prettier

## Project Structure

```md
.
├── src/
│ ├── layouts/ # Astro layouts
│ ├── pages/ # Astro pages
│ │ └── api/ # API endpoints
│ ├── components/ # UI components (Astro & React)
│ └── assets/ # Static assets
├── public/ # Public assets
├── wrangler.jsonc # Cloudflare Workers config
```

## Supabase Configuration

This project uses [Supabase](https://supabase.com/) for authentication. Environment variables are declared via Astro's `astro:env` schema and are treated as **server-only secrets** — they are never exposed to the client.

### First-time setup (local, no cloud project needed)

Requires [Docker](https://www.docker.com/) and ~7 GB RAM.

1. Create your `.env` file:

```bash
cp .env.example .env
```

2. Initialize the local Supabase project (creates a `supabase/` config folder):

```bash
npx supabase init
```

3. Start the local stack (downloads Docker images on first run):

```bash
npx supabase start
```

4. Copy the credentials printed by the CLI into your `.env` and `.dev.vars`:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<anon key from CLI output>
```

5. To stop the stack when done:

```bash
npx supabase stop
```

The local Studio UI is available at `http://localhost:54323`.

Migrations live under `supabase/migrations/`. Apply them locally with `npx supabase db reset` (destroys local DB, replays every migration from zero, seeds if `supabase/seed.sql` exists). Run pgTAP tests with `npx supabase test db`.

### Using a cloud Supabase project instead

If you prefer to use a hosted Supabase project, add these variables to your `.env` and `.dev.vars` files:

| Variable       | Description                                                |
| -------------- | ---------------------------------------------------------- |
| `SUPABASE_URL` | Project URL from Supabase dashboard → Settings → API       |
| `SUPABASE_KEY` | `anon` public key from Supabase dashboard → Settings → API |

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_KEY=<anon-key>
```

### Regenerating database types

TypeScript types for the schema live at `src/db/database.types.ts` and are checked into git. Regenerate them after any migration change:

```bash
npx supabase db reset   # apply latest migrations to the local stack
npm run db:types        # dump typescript definitions into src/db/database.types.ts
```

Commit the regenerated file with the migration that produced it. CI does not run Supabase, so a stale `database.types.ts` will surface as an `astro sync` / build failure on push.

### Email confirmation in local development

By default Supabase requires email confirmation before a user can sign in. To skip this during local development:

1. Open the Supabase dashboard for your project
2. Go to **Authentication → Email → Confirm email**
3. Toggle it **off**

Users can then sign in immediately after sign-up without clicking a confirmation link.

### Auth routes

| Route                 | Description                                                             |
| --------------------- | ----------------------------------------------------------------------- |
| `/auth/signin`        | Email/password sign-in form                                             |
| `/auth/signup`        | Email/password sign-up form                                             |
| `/auth/confirm-email` | Post-signup "check your inbox" page                                     |
| `/dashboard`          | Example protected page (redirects to `/auth/signin` if unauthenticated) |

Route protection is handled in `src/middleware.ts`. Add paths to the `PROTECTED_ROUTES` array there to require authentication.

## Account deletion & 30-day retention

Users can delete their account from `/account`. The flow is soft-delete + retention window rather than immediate hard-delete:

1. User clicks **Usuń konto** in `/account` → `AlertDialog` requires them to type their exact email.
2. `POST /api/account/delete` calls `enqueue_hard_delete(user_id)` which sets `profiles.deleted_at = now()` and `scheduled_hard_delete_at = now() + 30d`, then `supabase.auth.signOut({ scope: "global" })` revokes every refresh token for the user.
3. Any subsequent request with an old cookie hits the middleware soft-delete gate and is redirected to `/auth/restore-account`. RLS `EXISTS` gates on `cards` and `review_history` also block reads/writes even if a token slips through.
4. If the user logs in again within the 30-day window they land on `/auth/restore-account` and can click **Przywróć konto** → `POST /api/account/restore` calls `restore_account()` which clears `deleted_at`. Data (fiszki, historia FSRS) is byte-identical.
5. Two `pg_cron` jobs run daily on Supabase:
   - `hard_delete_expired_accounts` @ 03:00 UTC — deletes from `auth.users` for every row past cutoff. FK CASCADE clears `cards`, `review_history`, `profiles`.
   - `retention_watchdog` @ 04:00 UTC — RAISE EXCEPTION when any profile is more than 1 day past its cutoff. The failed job appears red in Supabase Studio → Cron Jobs → History (fail-loud, no external alerting infra required).

Sign-up on an email in the retention window is blocked. `POST /api/auth/signup` pre-checks via the `email_pending_deletion` RPC and redirects with `?error=account_pending_deletion` + a link to sign in and restore.

### Monitoring

- **Supabase Studio → Database → Cron Jobs → History**:
  - Green rows for `hard_delete_expired_accounts` (03:00 UTC daily) — normal.
  - Red row for `retention_watchdog` (04:00 UTC daily) = orphans past cutoff. Investigate:
    ```sql
    select * from public.profiles
    where scheduled_hard_delete_at is not null
      and scheduled_hard_delete_at < now() - interval '1 day';
    ```
    Then check `cron.job_run_details` for `hard_delete_expired_accounts` failures the previous day.
- **Ad-hoc query** (manual double-check outside Studio):
  ```sql
  select count(*) from public.profiles
  where scheduled_hard_delete_at is not null
    and scheduled_hard_delete_at < now() - interval '1 day';
  -- 0 = healthy; >0 = investigate as above.
  ```

`retention_watchdog` is fail-loud (RAISE EXCEPTION), so a red job in Studio is the signal, not just an elevated counter.

## Deployment

This project deploys to [Cloudflare Workers](https://workers.cloudflare.com/).

1. Build the project:

```bash
npm run build
```

2. Deploy with Wrangler:

```bash
npx wrangler deploy
```

Set `SUPABASE_URL` and `SUPABASE_KEY` as secrets in your Cloudflare dashboard or via `npx wrangler secret put`.

## CI

GitHub Actions runs lint + build on every push and PR to `master`. Configure `SUPABASE_URL` and `SUPABASE_KEY` as repository secrets in GitHub for the build step.

## License

MIT
