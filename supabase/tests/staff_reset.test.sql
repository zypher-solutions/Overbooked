-- Password resets by the owner or a manager, and usernames (migration 049).
-- Run: npx supabase db reset && npx supabase test db   (uses the seeded demo shops; everything is rolled back)
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(16);

\set bridal_owner '''aaaaaaaa-0000-0000-0000-000000000011'''
\set bridal_manager '''aaaaaaaa-0000-0000-0000-000000000012'''
\set bridal_staff '''aaaaaaaa-0000-0000-0000-000000000013'''
\set bridal_support '''aaaaaaaa-0000-0000-0000-000000000014'''
\set groom_owner '''aaaaaaaa-0000-0000-0000-000000000021'''

CREATE FUNCTION pg_temp.act_as(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.act_as(uuid) TO authenticated;

-- usernames
SELECT throws_ok($$ UPDATE profiles SET username = 'Ravi@zeez' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000013' $$,
  '23514', NULL, 'a username is lower case, name@shop');
SELECT lives_ok($$ UPDATE profiles SET username = 'ravi.k@bridal-shop' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000013' $$,
  'a good username is saved');
SELECT throws_ok($$ UPDATE profiles SET username = 'ravi.k@bridal-shop' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000012' $$,
  '23505', NULL, 'two people cannot share a username');

-- the owner
SELECT pg_temp.act_as(:bridal_owner);
SELECT lives_ok($$ SELECT staff_reset_check('aaaaaaaa-0000-0000-0000-000000000012') $$, 'the owner may reset a manager');
SELECT lives_ok($$ SELECT staff_reset_done('aaaaaaaa-0000-0000-0000-000000000013') $$, 'the owner resets staff');
SELECT throws_like($$ SELECT staff_reset_check('aaaaaaaa-0000-0000-0000-000000000011') $$, 'Use Change password%', 'but not themselves');
SELECT throws_like($$ SELECT staff_reset_check('aaaaaaaa-0000-0000-0000-000000000014') $$, 'An owner resets%', 'nor the Zypher support login');
SELECT throws_like($$ SELECT staff_reset_check('aaaaaaaa-0000-0000-0000-000000000021') $$, 'Staff member not found%', 'nor someone of another shop');
SELECT ok((SELECT jsonb_array_length(staff_reset_people()) = 2), 'the owner sees the manager and the staff member');
SELECT pg_temp.act_as(:bridal_staff);
SELECT throws_like($$ SELECT staff_reset_people() $$, 'Only the shop owner or a manager%', 'staff cannot list people to reset');
SELECT throws_like($$ SELECT staff_reset_done('aaaaaaaa-0000-0000-0000-000000000012') $$, 'Only the shop owner or a manager%', 'nor reset anyone');

-- what a reset did
RESET role;
SELECT ok((SELECT must_change_password FROM profiles WHERE id = :bridal_staff), 'the reset person must choose a new password');
SELECT ok(EXISTS (SELECT 1 FROM activity_log WHERE actor_id = :bridal_owner AND action = 'password_reset' AND important),
  'the reset is in the owner''s log, marked important');

-- the manager
SELECT pg_temp.act_as(:bridal_manager);
SELECT lives_ok($$ SELECT staff_reset_check('aaaaaaaa-0000-0000-0000-000000000013') $$, 'a manager resets staff of their branch');
SELECT throws_like($$ SELECT staff_reset_check('aaaaaaaa-0000-0000-0000-000000000011') $$, 'An owner resets%', 'but not the owner');

-- the person sets their own password
SELECT pg_temp.act_as(:bridal_staff);
SELECT log_account_event('password_changed');
RESET role;
SELECT ok(NOT (SELECT must_change_password FROM profiles WHERE id = :bridal_staff), 'choosing a password clears the flag');

SELECT * FROM finish();
ROLLBACK;
