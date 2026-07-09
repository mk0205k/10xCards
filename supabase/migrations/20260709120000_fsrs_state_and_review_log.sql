-- Migration: FSRS state on cards + rewritten review_history + commit_review RPC.
--
-- S-02 (context/changes/first-review-session/) adopts ts-fsrs (FSRS-6). This
-- migration:
--   1. Adds FSRS state columns to public.cards. Live rows from S-01 exist,
--      so every new column is NOT NULL with a DEFAULT matching the semantics
--      of ts-fsrs createEmptyCard() (due=now(), reps=0, state=0, ...).
--   2. Drops public.review_history (a placeholder from F-01 pre-algorithm
--      decision; never written to by any endpoint) and recreates it in the
--      shape of ts-fsrs ReviewLog. 12 required fields, all NOT NULL.
--   3. Adds cards(user_id, due) index for the "next-due card" query.
--   4. Adds public.commit_review(...) — SECURITY INVOKER function that
--      atomically UPDATEs cards + INSERTs review_history in one transaction.
--      Callers (POST /api/review/[card_id]/rate) pass the already-computed
--      FSRS output as jsonb; the function does no scheduling. RLS still
--      applies because SECURITY INVOKER inherits the caller's auth.uid().
--   5. Reinstates RLS + per-op-per-role policies on the recreated table.
--      review_history is append-only: no UPDATE/DELETE grant to authenticated
--      (cascade from cards handles cleanup).


-- Cards: FSRS state columns ------------------------------------------------
-- DEFAULT-s mirror ts-fsrs createEmptyCard(). Existing S-01 rows backfill to
-- "due now, brand-new state" — acceptable for MVP (no legacy schedule to
-- preserve; users can rate them and reset the schedule).

alter table public.cards
  add column due timestamptz not null default now(),
  add column stability double precision not null default 0,
  add column difficulty double precision not null default 0,
  add column elapsed_days integer not null default 0,
  add column scheduled_days integer not null default 0,
  add column learning_steps integer not null default 0,
  add column reps integer not null default 0,
  add column lapses integer not null default 0,
  add column state smallint not null default 0
    check (state between 0 and 3),
  add column last_review timestamptz null;

create index cards_user_due_idx on public.cards (user_id, due);


-- review_history: DROP + CREATE --------------------------------------------
-- Old schema had (rating, next_review_at, reviewed_at) — placeholder from
-- F-01 pre-algorithm decision. New schema mirrors ts-fsrs ReviewLog. Post-
-- review "next due" now lives on cards.due, so next_review_at is removed.

drop table if exists public.review_history;

create table public.review_history (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  rating smallint not null check (rating between 1 and 4),
  state smallint not null check (state between 0 and 3),
  due timestamptz not null,
  stability double precision not null,
  difficulty double precision not null,
  elapsed_days integer not null,
  last_elapsed_days integer not null,
  scheduled_days integer not null,
  learning_steps integer not null,
  review timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index review_history_user_review_idx on public.review_history (user_id, review desc);
create index review_history_card_idx on public.review_history (card_id);


-- Grants + RLS: review_history ---------------------------------------------
-- Append-only: SELECT + INSERT for authenticated (own rows via RLS). No
-- UPDATE/DELETE grant — a rating, once written, is a fact. Cascade from
-- cards handles deletion when a card is removed. service_role gets the
-- same restricted grants (any admin cleanup must go through explicit tools).

grant select, insert on table public.review_history to authenticated;
grant select, insert on table public.review_history to service_role;

alter table public.review_history enable row level security;

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


-- commit_review: atomic UPDATE cards + INSERT review_history ---------------
-- Callers compute new FSRS state client-side via ts-fsrs scheduler.next()
-- and hand it here as jsonb. The function does no math. SECURITY INVOKER
-- so auth.uid() is the caller's, and cards RLS filters the UPDATE — if the
-- card is not owned by the caller, the UPDATE affects 0 rows and we raise
-- 42501 (insufficient_privilege) explicitly.
--
-- Non-obvious: the jsonb->>'field'::type casts fail loudly if a field is
-- wrong-typed. That's intentional — it catches endpoint bugs at write time
-- instead of silently writing NULL where NOT NULL is required.

create or replace function public.commit_review(
  p_card_id uuid,
  p_rating smallint,
  p_now timestamptz,
  p_updated_card jsonb,
  p_log jsonb
)
returns public.cards
language plpgsql
security invoker
as $$
declare
  v_card public.cards;
begin
  update public.cards set
    due            = (p_updated_card->>'due')::timestamptz,
    stability      = (p_updated_card->>'stability')::double precision,
    difficulty     = (p_updated_card->>'difficulty')::double precision,
    elapsed_days   = (p_updated_card->>'elapsed_days')::integer,
    scheduled_days = (p_updated_card->>'scheduled_days')::integer,
    learning_steps = (p_updated_card->>'learning_steps')::integer,
    reps           = (p_updated_card->>'reps')::integer,
    lapses         = (p_updated_card->>'lapses')::integer,
    state          = (p_updated_card->>'state')::smallint,
    last_review    = (p_updated_card->>'last_review')::timestamptz,
    updated_at     = now()
  where id = p_card_id
  returning * into v_card;

  if v_card.id is null then
    raise exception 'commit_review: card % not found or not owned by caller', p_card_id
      using errcode = '42501';
  end if;

  insert into public.review_history (
    card_id, user_id, rating, state, due, stability, difficulty,
    elapsed_days, last_elapsed_days, scheduled_days, learning_steps, review
  ) values (
    p_card_id,
    v_card.user_id,
    p_rating,
    (p_log->>'state')::smallint,
    (p_log->>'due')::timestamptz,
    (p_log->>'stability')::double precision,
    (p_log->>'difficulty')::double precision,
    (p_log->>'elapsed_days')::integer,
    (p_log->>'last_elapsed_days')::integer,
    (p_log->>'scheduled_days')::integer,
    (p_log->>'learning_steps')::integer,
    coalesce((p_log->>'review')::timestamptz, p_now)
  );

  return v_card;
end;
$$;

revoke execute on function public.commit_review(uuid, smallint, timestamptz, jsonb, jsonb) from public;
grant  execute on function public.commit_review(uuid, smallint, timestamptz, jsonb, jsonb) to authenticated;
