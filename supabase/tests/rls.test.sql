-- pgTAP suite: RLS isolation + commit_review RPC for cards + review_history.
--
-- Verifies (a) each RLS policy pair on cards, (b) SELECT+INSERT policies on
-- review_history plus grant-denied UPDATE/DELETE for authenticated (append-
-- only), (c) commit_review mutates state for the owner, (d) commit_review
-- raises 42501 when called against a foreign card, (e) anon lockout on both
-- tables. Extends the F-01 suite to cover the S-02 schema (FSRS state on
-- cards + rewritten review_history + commit_review). Ran by
-- `supabase test db`.

begin;

select plan(38);

-- Setup: two auth.users, one card + one review_history row each. All
-- privileged inserts happen before role restriction.

insert into auth.users (id, email, aud, role)
values
  ('11111111-1111-1111-1111-111111111111', 'user-a@test.local', 'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222222', 'user-b@test.local', 'authenticated', 'authenticated');

insert into public.cards (id, user_id, question, answer)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Q-A', 'A-A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Q-B', 'A-B');

insert into public.review_history (
  card_id, user_id, rating, state, due, stability, difficulty,
  elapsed_days, last_elapsed_days, scheduled_days, learning_steps, review
) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 3, 2, now() + interval '1 day', 3.5, 5.0, 0, 0, 1, 0, now()),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 3, 2, now() + interval '1 day', 3.5, 5.0, 0, 0, 1, 0, now());


-- =========================================================================
-- As user A — SELECT + INSERT + append-only DML on cards & review_history.
-- =========================================================================

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  (select count(*)::int from public.cards),
  1,
  'cards: user A sees exactly 1 row (their own)'
);

select is(
  (select count(*)::int from public.cards where user_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'cards: user A cannot see user B rows'
);

select throws_ok(
  $$insert into public.cards (user_id, question, answer)
    values ('22222222-2222-2222-2222-222222222222', 'x', 'y')$$,
  '42501',
  null,
  'cards: user A INSERT with user B user_id violates RLS with check'
);

select is(
  (select count(*)::int from public.review_history),
  1,
  'review_history: user A sees exactly 1 row (their own)'
);

select is(
  (select count(*)::int from public.review_history where user_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'review_history: user A cannot see user B rows'
);

select throws_ok(
  $$insert into public.review_history (
      card_id, user_id, rating, state, due, stability, difficulty,
      elapsed_days, last_elapsed_days, scheduled_days, learning_steps, review
    ) values (
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222',
      3, 2, now(), 1.0, 1.0, 0, 0, 1, 0, now()
    )$$,
  '42501',
  null,
  'review_history: user A INSERT with user B user_id violates RLS with check'
);

-- Append-only: no UPDATE or DELETE grant for authenticated on review_history.

select throws_ok(
  $$update public.review_history set rating = 4 where card_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  '42501',
  null,
  'review_history: authenticated has no UPDATE grant (append-only log)'
);

select throws_ok(
  $$delete from public.review_history where card_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  '42501',
  null,
  'review_history: authenticated has no DELETE grant (append-only log)'
);


-- =========================================================================
-- As user A — attempted UPDATE/DELETE on user B's cards (silent RLS filter,
-- since cards still has UPDATE/DELETE grants). Verified below (as admin)
-- that user B's data survived intact.
-- =========================================================================

update public.cards set question = 'hacked' where user_id = '22222222-2222-2222-2222-222222222222';
delete from public.cards where user_id = '22222222-2222-2222-2222-222222222222';


-- =========================================================================
-- As user A — commit_review on OWN card succeeds and mutates state.
-- Function returns the updated card row; we check .id equals the input.
-- =========================================================================

select is(
  (select (public.commit_review(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    3::smallint,
    '2026-07-09T12:00:00Z'::timestamptz,
    '{"due":"2026-07-13T12:00:00Z","stability":4.5,"difficulty":5.0,"elapsed_days":0,"scheduled_days":4,"learning_steps":0,"reps":1,"lapses":0,"state":2,"last_review":"2026-07-09T12:00:00Z"}'::jsonb,
    '{"state":0,"due":"2026-07-13T12:00:00Z","stability":4.5,"difficulty":5.0,"elapsed_days":0,"last_elapsed_days":0,"scheduled_days":4,"learning_steps":0,"review":"2026-07-09T12:00:00Z"}'::jsonb
  )).id),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'commit_review: returns the updated card row with matching id for owner'
);

select is(
  (select reps from public.cards where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1,
  'commit_review: cards.reps advanced to 1 for user A card'
);

select is(
  (select count(*)::int from public.review_history where card_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  2,
  'commit_review: review_history row inserted (setup 1 + rated 1 = 2)'
);


-- =========================================================================
-- As user A — commit_review on user B's card MUST raise 42501.
-- The UPDATE inside the function affects 0 rows (RLS filters), then the
-- explicit RAISE inside commit_review fires.
-- =========================================================================

select throws_ok(
  $$select public.commit_review(
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      3::smallint,
      '2026-07-09T12:00:00Z'::timestamptz,
      '{"due":"2026-07-13T12:00:00Z","stability":4.5,"difficulty":5.0,"elapsed_days":0,"scheduled_days":4,"learning_steps":0,"reps":1,"lapses":0,"state":2,"last_review":"2026-07-09T12:00:00Z"}'::jsonb,
      '{"state":0,"due":"2026-07-13T12:00:00Z","stability":4.5,"difficulty":5.0,"elapsed_days":0,"last_elapsed_days":0,"scheduled_days":4,"learning_steps":0,"review":"2026-07-09T12:00:00Z"}'::jsonb
    )$$,
  '42501',
  null,
  'commit_review: cross-user call raises 42501 (RLS filters UPDATE to 0 rows)'
);


-- =========================================================================
-- Verify (as admin — RLS bypassed) that user B rows survived intact.
-- =========================================================================

reset request.jwt.claims;
reset role;

select is(
  (select question from public.cards where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  'Q-B',
  'cards: user B row question unchanged after user A UPDATE/commit_review attempts'
);

select is(
  (select count(*)::int from public.cards where user_id = '22222222-2222-2222-2222-222222222222'),
  1,
  'cards: user B row still present after user A DELETE attempt'
);

select is(
  (select rating from public.review_history where user_id = '22222222-2222-2222-2222-222222222222' order by review limit 1),
  3::smallint,
  'review_history: user B row rating unchanged (UPDATE was grant-denied)'
);

select is(
  (select count(*)::int from public.review_history where user_id = '22222222-2222-2222-2222-222222222222'),
  1,
  'review_history: user B row still present (DELETE was grant-denied)'
);


-- =========================================================================
-- S-05: soft-delete gate + retention functions + auto-insert trigger.
-- Runs as admin/authenticated with role switches; ends by resetting to
-- admin so the subsequent anon section can `set local role anon`.
-- =========================================================================

-- Trigger auto-inserted profiles for users A + B from the setup above.
select is(
  (select count(*)::int from public.profiles),
  2,
  'profiles: on_auth_user_created trigger auto-inserted rows for users A + B'
);

-- Fresh auth.users insert fires the trigger for user C.
insert into auth.users (id, email, aud, role)
values ('33333333-3333-3333-3333-333333333333', 'user-c@test.local', 'authenticated', 'authenticated');

select is(
  (select count(*)::int from public.profiles),
  3,
  'profiles: trigger auto-inserts profile for user C on auth.users INSERT'
);

insert into public.cards (id, user_id, question, answer)
values ('cccccccc-cccc-cccc-cccc-cccccccccccc', '33333333-3333-3333-3333-333333333333', 'Q-C', 'A-C');

-- Switch to user A (authenticated). Soft-delete self.
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select lives_ok(
  $$select public.enqueue_hard_delete('11111111-1111-1111-1111-111111111111')$$,
  'enqueue_hard_delete: user A soft-deletes own account'
);

select is(
  (select count(*)::int from public.cards),
  0,
  'soft-delete gate: user A sees 0 cards after enqueue (EXISTS gate filters out own rows)'
);

select throws_ok(
  $$insert into public.cards (user_id, question, answer)
    values ('11111111-1111-1111-1111-111111111111', 'x', 'y')$$,
  '42501',
  null,
  'soft-delete gate: user A INSERT card blocked by EXISTS gate'
);

-- Cross-user enqueue authorization: A cannot delete B.
select throws_ok(
  $$select public.enqueue_hard_delete('22222222-2222-2222-2222-222222222222')$$,
  '42501',
  null,
  'enqueue_hard_delete: user A cannot soft-delete user B (raises 42501)'
);

-- User B (alive) unaffected by A's soft-delete.
set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select is(
  (select count(*)::int from public.cards),
  1,
  'soft-delete gate: user B (alive) still sees own cards after A soft-delete'
);

-- User A restores.
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select lives_ok(
  $$select public.restore_account()$$,
  'restore_account: user A un-marks own soft-delete'
);

select is(
  (select count(*)::int from public.cards),
  1,
  'restore_account: user A regains SELECT visibility on own cards'
);

-- execute_hard_delete: backdate A + C past cutoff, B future cutoff.
reset request.jwt.claims;
reset role;

update public.profiles
   set deleted_at = now() - interval '31 days',
       scheduled_hard_delete_at = now() - interval '1 day'
 where user_id in ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333');

update public.profiles
   set deleted_at = now() - interval '15 days',
       scheduled_hard_delete_at = now() + interval '15 days'
 where user_id = '22222222-2222-2222-2222-222222222222';

select is(
  public.execute_hard_delete(),
  2,
  'execute_hard_delete: returns 2 (users A + C past cutoff)'
);

select is(
  (select count(*)::int from auth.users where id in ('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333')),
  0,
  'execute_hard_delete: users A + C removed from auth.users'
);

select is(
  (select count(*)::int from public.cards where user_id in ('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333')),
  0,
  'execute_hard_delete: FK CASCADE removed cards for A + C'
);

select is(
  (select count(*)::int from auth.users where id = '22222222-2222-2222-2222-222222222222'),
  1,
  'execute_hard_delete: user B (future cutoff) survives'
);

select is(
  public.execute_hard_delete(),
  0,
  'execute_hard_delete: idempotent — second call returns 0'
);

-- email_pending_deletion — user B still soft-deleted in window; callable as anon.
set local role anon;

select is(
  public.email_pending_deletion('user-b@test.local'),
  true,
  'email_pending_deletion: true for soft-deleted email in retention window'
);

select is(
  public.email_pending_deletion('nonexistent@test.local'),
  false,
  'email_pending_deletion: false for unknown email'
);

reset role;

-- retention_watchdog fail-loud when orphans past cutoff by >1 day.
update public.profiles
   set scheduled_hard_delete_at = now() - interval '2 days'
 where user_id = '22222222-2222-2222-2222-222222222222';

select throws_ok(
  $$select public.retention_watchdog()$$,
  'P0001',
  null,
  'retention_watchdog: raises P0001 when profiles >1d past cutoff'
);

-- Clean run — 0 orphans.
update public.profiles
   set deleted_at = null, scheduled_hard_delete_at = null
 where user_id = '22222222-2222-2222-2222-222222222222';

select lives_ok(
  $$select public.retention_watchdog()$$,
  'retention_watchdog: clean run when 0 orphans past cutoff'
);


-- =========================================================================
-- As anon — no table-level GRANT means every touch raises 42501.
-- =========================================================================

set local role anon;

select throws_ok(
  'select count(*) from public.cards',
  '42501',
  null,
  'cards: anon SELECT rejected by table-level permission'
);

select throws_ok(
  'select count(*) from public.review_history',
  '42501',
  null,
  'review_history: anon SELECT rejected by table-level permission'
);

select throws_ok(
  $$insert into public.cards (user_id, question, answer)
    values ('11111111-1111-1111-1111-111111111111', 'anon', 'try')$$,
  '42501',
  null,
  'cards: anon INSERT rejected'
);

select throws_ok(
  $$insert into public.review_history (
      card_id, user_id, rating, state, due, stability, difficulty,
      elapsed_days, last_elapsed_days, scheduled_days, learning_steps, review
    ) values (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
      3, 2, now(), 1.0, 1.0, 0, 0, 1, 0, now()
    )$$,
  '42501',
  null,
  'review_history: anon INSERT rejected'
);


select * from finish();
rollback;
