-- Migration: initial schema for 10xCards
--
-- Creates the two domain tables (cards, review_history) that back the MVP:
-- AI-driven flashcard creation (S-01), manual CRUD (S-03), and spaced-
-- repetition review sessions (S-02). RLS is enabled on both tables with
-- per-user ownership enforced through granular per-operation policies.
-- pgTAP is bootstrapped so `supabase test db` can run the isolation
-- suite added in supabase/tests/rls.test.sql.

-- Extensions --------------------------------------------------------------

create extension if not exists pgtap with schema extensions;

-- Enums -------------------------------------------------------------------

create type public.card_source as enum ('ai', 'manual');

-- Tables ------------------------------------------------------------------

create table public.cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  question text not null,
  answer text not null,
  source public.card_source not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.review_history (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  reviewed_at timestamptz not null default now(),
  rating smallint not null,
  next_review_at timestamptz not null
);

-- Indexes -----------------------------------------------------------------

create index cards_user_created_idx on public.cards (user_id, created_at desc);
create index review_history_user_due_idx on public.review_history (user_id, next_review_at);
create index review_history_card_idx on public.review_history (card_id);

-- Triggers ----------------------------------------------------------------

create or replace function public.trigger_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger cards_set_updated_at
before update on public.cards
for each row
execute function public.trigger_set_updated_at();

-- Row Level Security ------------------------------------------------------

alter table public.cards enable row level security;
alter table public.review_history enable row level security;

-- Policies: cards ---------------------------------------------------------
-- Per-operation, per-role (authenticated). Anon is denied by default via
-- RLS since no policy grants access.

create policy cards_select_own
on public.cards
for select
to authenticated
using (auth.uid() = user_id);

create policy cards_insert_own
on public.cards
for insert
to authenticated
with check (auth.uid() = user_id);

create policy cards_update_own
on public.cards
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy cards_delete_own
on public.cards
for delete
to authenticated
using (auth.uid() = user_id);

-- Policies: review_history ------------------------------------------------

create policy review_history_select_own
on public.review_history
for select
to authenticated
using (auth.uid() = user_id);

create policy review_history_insert_own
on public.review_history
for insert
to authenticated
with check (auth.uid() = user_id);

create policy review_history_update_own
on public.review_history
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy review_history_delete_own
on public.review_history
for delete
to authenticated
using (auth.uid() = user_id);
