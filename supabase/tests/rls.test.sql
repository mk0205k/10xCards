-- pgTAP suite: RLS isolation for `cards` and `review_history`.
--
-- Executes the Risk mitigation from F-01 in context/foundation/roadmap.md:
-- "user A does not see user B's rows." Verifies each policy pair
-- (SELECT / INSERT / UPDATE / DELETE) on both tables, plus the anon
-- lockout implied by grant-authenticated-only. Ran by `supabase test db`.

begin;

select plan(14);

-- Setup: two auth.users rows, one card + review_history each. All
-- privileged inserts happen before we switch to a restricted role.

insert into auth.users (id, email, aud, role)
values
  ('11111111-1111-1111-1111-111111111111', 'user-a@test.local', 'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222222', 'user-b@test.local', 'authenticated', 'authenticated');

insert into public.cards (id, user_id, question, answer)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Q-A', 'A-A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Q-B', 'A-B');

insert into public.review_history (card_id, user_id, rating, next_review_at)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 3, now() + interval '1 day'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 3, now() + interval '1 day');


-- =========================================================================
-- As user A — SELECT + INSERT policies on cards
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


-- =========================================================================
-- As user A — SELECT + INSERT policies on review_history
-- =========================================================================

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
  $$insert into public.review_history (card_id, user_id, rating, next_review_at)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 5, now())$$,
  '42501',
  null,
  'review_history: user A INSERT with user B user_id violates RLS with check'
);


-- =========================================================================
-- As user A — attempt UPDATE / DELETE on user B rows (silent RLS filter).
-- The DMLs return 0 rows without error; we verify below (with admin role)
-- that user B's data is untouched.
-- =========================================================================

update public.cards set question = 'hacked' where user_id = '22222222-2222-2222-2222-222222222222';
delete from public.cards where user_id = '22222222-2222-2222-2222-222222222222';

update public.review_history set rating = 99 where user_id = '22222222-2222-2222-2222-222222222222';
delete from public.review_history where user_id = '22222222-2222-2222-2222-222222222222';


-- =========================================================================
-- Verify (as admin — RLS bypassed) that user B rows survived intact.
-- =========================================================================

reset request.jwt.claims;
reset role;

select is(
  (select question from public.cards where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  'Q-B',
  'cards: user B row question unchanged after user A UPDATE attempt'
);

select is(
  (select count(*)::int from public.cards where user_id = '22222222-2222-2222-2222-222222222222'),
  1,
  'cards: user B row still present after user A DELETE attempt'
);

select is(
  (select rating from public.review_history where user_id = '22222222-2222-2222-2222-222222222222'),
  3::smallint,
  'review_history: user B row rating unchanged after user A UPDATE attempt'
);

select is(
  (select count(*)::int from public.review_history where user_id = '22222222-2222-2222-2222-222222222222'),
  1,
  'review_history: user B row still present after user A DELETE attempt'
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
  $$insert into public.review_history (card_id, user_id, rating, next_review_at)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 3, now())$$,
  '42501',
  null,
  'review_history: anon INSERT rejected'
);


select * from finish();
rollback;
