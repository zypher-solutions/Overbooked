-- The shop's owner runs its people and branches (migration 033); Zypher only sets a shop up until its owner takes over.
-- Run: npx supabase db reset && npx supabase test db   (uses the seeded demo shops; everything is rolled back)
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(22);

\set zypher '''aaaaaaaa-0000-0000-0000-000000000001'''
\set bridal_owner '''aaaaaaaa-0000-0000-0000-000000000011'''
\set bridal_manager '''aaaaaaaa-0000-0000-0000-000000000012'''
\set bridal_staff '''aaaaaaaa-0000-0000-0000-000000000013'''
\set bridal_support '''aaaaaaaa-0000-0000-0000-000000000014'''
\set groom_owner '''aaaaaaaa-0000-0000-0000-000000000021'''
\set kalyani '''5a000000-0000-0000-0000-000000000001'''
\set raja '''5a000000-0000-0000-0000-000000000002'''

CREATE FUNCTION pg_temp.act_as(p_user uuid, p_aal text DEFAULT 'aal1') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.act_as(uuid, text) TO authenticated;

-- ===== the owner, in their own shop =====
SELECT pg_temp.act_as(:bridal_owner);
SELECT lives_ok($$ SELECT public.setup_check_invite('5a000000-0000-0000-0000-000000000001', 'staff', 'b0000000-0000-0000-0000-000000000001') $$,
  'the owner may invite staff to their branch');
SELECT throws_like($$ SELECT public.setup_check_invite('5a000000-0000-0000-0000-000000000001', 'support', NULL) $$,
  'Only Zypher creates a Zypher support login', 'but not create a Zypher support login');
SELECT throws_like($$ SELECT public.setup_check_invite('5a000000-0000-0000-0000-000000000002', 'staff', NULL) $$,
  'Only Zypher or the shop owner can do this', 'nor invite into another shop');
SELECT lives_ok($$ SELECT public.setup_set_person('5a000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000013', '{"role":"manager"}') $$,
  'the owner changes a role');
SELECT is((SELECT role FROM profiles WHERE id = :bridal_staff), 'manager', '...and it is saved');
SELECT throws_like($$ SELECT public.setup_set_person('5a000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000011', '{"role":"staff"}') $$,
  'You cannot change your own role%', 'the owner cannot change their own role');
SELECT throws_like($$ SELECT public.setup_set_person('5a000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000014', '{"role":"staff"}') $$,
  'A Zypher support login can only%', 'the owner cannot turn the support login into staff');
SELECT lives_ok($$ SELECT public.setup_set_person('5a000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000014', '{"is_active":false}') $$,
  'but can switch the support login off');
SELECT is(public.setup_check_person('5a000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000012'), 'link',
  'the owner gets a login link to share with their manager');
SELECT throws_like($$ SELECT public.setup_check_person('5a000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000014') $$,
  'Zypher manages its support login', 'but no login link for the support login');
SELECT lives_ok($$ SELECT public.setup_save_branch('5a000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '{"phone":"9000000001"}') $$,
  'the owner edits a branch');
SELECT lives_ok($$ SELECT public.log_setup_event('5a000000-0000-0000-0000-000000000001', 'invite_created', '{}') $$,
  'and their changes are logged');
SELECT throws_like($$ SELECT public.log_setup_event('5a000000-0000-0000-0000-000000000002', 'invite_created', '{}') $$,
  'Only Zypher or the shop owner can do this', 'but never into another shop''s log');

-- ===== nobody else in the shop =====
SELECT pg_temp.act_as(:bridal_manager);
SELECT throws_like($$ SELECT public.setup_people('5a000000-0000-0000-0000-000000000001') $$,
  'Only Zypher or the shop owner can do this', 'a manager cannot manage staff');
SELECT pg_temp.act_as(:groom_owner);
SELECT throws_like($$ SELECT public.setup_people('5a000000-0000-0000-0000-000000000001') $$,
  'Only Zypher or the shop owner can do this', 'another shop''s owner cannot either');

-- ===== Zypher, after the owner has signed in =====
SELECT set_config('role', 'postgres', true);
UPDATE auth.users SET last_sign_in_at = now() WHERE id = :bridal_owner;
SELECT pg_temp.act_as(:zypher, 'aal2');
SELECT throws_like($$ SELECT public.setup_check_invite('5a000000-0000-0000-0000-000000000001', 'staff', 'b0000000-0000-0000-0000-000000000001') $$,
  'This shop''s owner adds its staff now', 'Zypher no longer invites staff once the owner took over');
SELECT throws_like($$ SELECT public.setup_check_invite('5a000000-0000-0000-0000-000000000001', 'owner', NULL) $$,
  'This shop''s owner adds its staff now', 'nor a second owner');
SELECT lives_ok($$ SELECT public.setup_check_invite('5a000000-0000-0000-0000-000000000001', 'support', NULL) $$,
  'but still creates its own support login');
SELECT throws_like($$ SELECT public.setup_set_person('5a000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000013', '{"is_active":false}') $$,
  'This shop''s owner manages its staff now', 'and cannot switch the shop''s people off');
SELECT is(public.setup_check_person('5a000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000011'), 'email',
  'an owner''s password link from Zypher goes by email only');
SELECT throws_like($$ SELECT public.setup_check_person('5a000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000012') $$,
  'This shop''s owner manages its staff now', 'and Zypher gets no link for the manager');
-- Zypher still sets up a shop whose owner never signed in
SELECT is(public.setup_check_person('5a000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000021'), 'link',
  'before the owner signs in, Zypher shares the invite link itself');

SELECT * FROM finish();
ROLLBACK;
