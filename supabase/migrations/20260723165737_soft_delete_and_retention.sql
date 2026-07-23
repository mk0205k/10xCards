-- Migration: soft-delete + 30-day retention for account deletion (S-05).
--
-- Introduces public.profiles (1:1 with auth.users) with two nullable
-- retention timestamps (`deleted_at`, `scheduled_hard_delete_at`). RLS on
-- cards + review_history is rewritten to include an EXISTS gate against
-- profiles — a soft-deleted user with a valid JWT sees nothing and can
-- mutate nothing. Two pg_cron jobs run daily: `hard_delete_expired_accounts`
-- @ 03:00 UTC deletes from auth.users (CASCADE picks up cards,
-- review_history, profiles); `retention_watchdog` @ 04:00 UTC raises
-- EXCEPTION if any profile is >1 day past its cutoff — that turns the
-- Supabase Studio cron history entry red, giving a fail-loud signal
-- without external alerting infrastructure.
--
-- Order is load-bearing:
--   1. Create profiles + trigger + handle_new_user (SECURITY DEFINER so the
--      auth flow can insert into public.profiles without any grant
--      dependency).
--   2. Backfill every existing auth.users row into profiles BEFORE swapping
--      the cards/review_history policies to the EXISTS-gated variants.
--      Skip this and every pre-migration user is instantly locked out of
--      their own data.
--   3. DROP + CREATE 6 policies (4 on cards, 2 on review_history) with the
--      gate.
--   4. Create retention RPCs (enqueue/restore/execute/watchdog +
--      email_pending_deletion).
--   5. Schedule the two crons.


-- Extensions --------------------------------------------------------------

create extension if not exists pg_cron with schema extensions;


-- Table: profiles ---------------------------------------------------------

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  deleted_at timestamptz null,
  scheduled_hard_delete_at timestamptz null,
  created_at timestamptz not null default now()
);

-- Partial index makes the RLS EXISTS gate an index-only scan while
-- deleted_at IS NULL (the common case).
create index profiles_user_alive_idx
  on public.profiles (user_id)
  where deleted_at is null;

-- INSERT is only performed by the SECURITY DEFINER trigger, so no INSERT
-- grant to authenticated. UPDATE is needed for restore_account
-- (SECURITY INVOKER); SELECT is needed for the middleware soft-delete gate.
grant select, update on table public.profiles to authenticated;
grant select, update on table public.profiles to service_role;

alter table public.profiles enable row level security;

create policy profiles_select_own
on public.profiles
for select
to authenticated
using (auth.uid() = user_id);

create policy profiles_update_own
on public.profiles
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);


-- Trigger: autoinsert profile on new user --------------------------------
-- SECURITY DEFINER because the trigger fires inside GoTrue's auth flow
-- where auth.uid() is not yet set and we need to write to public. The
-- function is owned by postgres (BYPASSRLS), so RLS on profiles doesn't
-- gate the insert. Explicit `set search_path` per Supabase security
-- guidance for SECURITY DEFINER functions.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();


-- Backfill existing users -------------------------------------------------
-- Runs BEFORE the EXISTS-gated policy swap. Without this, every pre-
-- migration user is instantly locked out.

insert into public.profiles (user_id)
select id from auth.users
on conflict (user_id) do nothing;


-- RLS policies: cards (DROP + CREATE with EXISTS gate) -------------------

drop policy if exists cards_select_own on public.cards;
drop policy if exists cards_insert_own on public.cards;
drop policy if exists cards_update_own on public.cards;
drop policy if exists cards_delete_own on public.cards;

create policy cards_select_own
on public.cards
for select
to authenticated
using (
  auth.uid() = user_id
  and exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.deleted_at is null
  )
);

create policy cards_insert_own
on public.cards
for insert
to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.deleted_at is null
  )
);

create policy cards_update_own
on public.cards
for update
to authenticated
using (
  auth.uid() = user_id
  and exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.deleted_at is null
  )
)
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.deleted_at is null
  )
);

create policy cards_delete_own
on public.cards
for delete
to authenticated
using (
  auth.uid() = user_id
  and exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.deleted_at is null
  )
);


-- RLS policies: review_history (DROP + CREATE with EXISTS gate) ----------
-- review_history is append-only: only SELECT and INSERT policies exist
-- (see 20260709120000_fsrs_state_and_review_log.sql). No UPDATE/DELETE
-- policy needs re-issuing.

drop policy if exists review_history_select_own on public.review_history;
drop policy if exists review_history_insert_own on public.review_history;

create policy review_history_select_own
on public.review_history
for select
to authenticated
using (
  auth.uid() = user_id
  and exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.deleted_at is null
  )
);

create policy review_history_insert_own
on public.review_history
for insert
to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.deleted_at is null
  )
);


-- Function: enqueue_hard_delete ------------------------------------------
-- User-initiated soft-delete. SECURITY DEFINER so the update still lands
-- after the caller becomes "soft-deleted" mid-transaction (RLS
-- profiles_update_own would still allow, but the EXISTS gate on other
-- tables cares about this row's state). Explicit auth.uid() check inside.
-- Idempotent: no-op when already deleted_at IS NOT NULL.

create or replace function public.enqueue_hard_delete(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'enqueue_hard_delete: caller % is not %', auth.uid(), p_user_id
      using errcode = '42501';
  end if;

  update public.profiles
     set deleted_at = now(),
         scheduled_hard_delete_at = now() + interval '30 days'
   where user_id = p_user_id
     and deleted_at is null;
end;
$$;

revoke execute on function public.enqueue_hard_delete(uuid) from public;
grant  execute on function public.enqueue_hard_delete(uuid) to authenticated;


-- Function: restore_account ----------------------------------------------
-- SECURITY INVOKER — auth.uid() is the caller's; profiles_update_own
-- permits the write.

create or replace function public.restore_account()
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.profiles
     set deleted_at = null,
         scheduled_hard_delete_at = null
   where user_id = auth.uid()
     and deleted_at is not null;
end;
$$;

revoke execute on function public.restore_account() from public;
grant  execute on function public.restore_account() to authenticated;


-- Function: execute_hard_delete ------------------------------------------
-- Cron-invoked. SECURITY DEFINER so it can DELETE from auth.users.
-- Returns the number of users deleted (visible in cron.job_run_details).
-- Emits WARNING when post-delete orphans >1d exist — that surfaces in
-- return_message alongside the return value.

create or replace function public.execute_hard_delete()
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_deleted integer;
  v_overdue integer;
begin
  delete from auth.users
   where id in (
     select user_id
       from public.profiles
      where scheduled_hard_delete_at is not null
        and scheduled_hard_delete_at <= now()
   );
  get diagnostics v_deleted = row_count;

  select count(*)::integer into v_overdue
    from public.profiles
   where scheduled_hard_delete_at is not null
     and scheduled_hard_delete_at < now() - interval '1 day';

  if v_overdue > 0 then
    raise warning 'retention_overdue: % profiles past cutoff by >1 day', v_overdue;
  end if;

  return v_deleted;
end;
$$;

revoke execute on function public.execute_hard_delete() from public;
grant  execute on function public.execute_hard_delete() to service_role;


-- Function: retention_watchdog -------------------------------------------
-- Fail-loud sibling of execute_hard_delete. Cron-invoked one hour later.
-- If any profile is >1 day past its cutoff, RAISE EXCEPTION so
-- cron.job_run_details.status = 'failed' (red row in Studio → Cron Jobs →
-- History).

create or replace function public.retention_watchdog()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_overdue integer;
begin
  select count(*)::integer into v_overdue
    from public.profiles
   where scheduled_hard_delete_at is not null
     and scheduled_hard_delete_at < now() - interval '1 day';

  if v_overdue > 0 then
    raise exception 'retention_watchdog: % profiles past cutoff by >1 day', v_overdue;
  end if;
end;
$$;

revoke execute on function public.retention_watchdog() from public;
grant  execute on function public.retention_watchdog() to service_role;


-- Function: email_pending_deletion ---------------------------------------
-- Pre-signup guard. SECURITY DEFINER so an anon caller (signup runs
-- before session) can read auth.users. Supabase normalizes emails to
-- lowercase — mirror that on the parameter side.

create or replace function public.email_pending_deletion(p_email text)
returns boolean
language plpgsql
security definer
set search_path = public, auth
stable
as $$
begin
  return exists (
    select 1
      from auth.users u
      join public.profiles p on p.user_id = u.id
     where u.email = lower(p_email)
       and p.deleted_at is not null
  );
end;
$$;

revoke execute on function public.email_pending_deletion(text) from public;
grant  execute on function public.email_pending_deletion(text) to anon, authenticated;


-- Cron schedules ----------------------------------------------------------
-- Two jobs. Duplicate `jobname` gets replaced by cron.schedule, so re-
-- running the migration is safe.

select cron.schedule(
  'hard_delete_expired_accounts',
  '0 3 * * *',
  $$select public.execute_hard_delete();$$
);

select cron.schedule(
  'retention_watchdog',
  '0 4 * * *',
  $$select public.retention_watchdog();$$
);
