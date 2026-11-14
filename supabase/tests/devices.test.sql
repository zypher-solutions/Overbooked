-- Login devices and the master password (migration 046).
-- Run: npx supabase db reset && npx supabase test db   (uses the seeded demo shops; everything is rolled back)
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(17);

\set bridal_owner '''aaaaaaaa-0000-0000-0000-000000000011'''
\set bridal_staff '''aaaaaaaa-0000-0000-0000-000000000013'''

CREATE FUNCTION pg_temp.act_as(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.act_as(uuid) TO authenticated;

-- ===== devices =====
SELECT pg_temp.act_as(:bridal_staff);
SELECT is(public.register_device('staff-phone-1', 'Android Chrome, phone'), true, 'a new device is allowed');
SELECT is(public.register_device('staff-phone-1', 'Android Chrome, phone'), true, 'the same device again stays one device');
SELECT is((SELECT count(*) FROM login_devices), 0::bigint, 'staff cannot read the device list');
SELECT throws_ok($$ SELECT public.set_device_active(gen_random_uuid(), false, 'x') $$, NULL, 'Only the shop owner can allow or block devices',
  'staff cannot block a device');

-- ===== master password =====
SELECT throws_ok($$ SELECT public.set_master_password('secret1') $$, NULL, 'Only the shop owner can set the master password',
  'staff cannot set the master password');
SELECT pg_temp.act_as(:bridal_owner);
SELECT is((SELECT count(*) FROM login_devices WHERE device_key = 'staff-phone-1'), 1::bigint, 'the owner sees the staff device once');
SELECT throws_ok($$ SELECT public.set_device_active((SELECT id FROM login_devices WHERE device_key = 'staff-phone-1'), false, 'x') $$,
  NULL, 'Set a master password first, in Settings', 'blocking needs a master password to exist');
SELECT throws_ok($$ SELECT public.set_master_password('short') $$, NULL, 'The master password is 6 to 72 characters', 'too short is refused');
SELECT lives_ok($$ SELECT public.set_master_password('secret1') $$, 'the owner sets the master password');
SELECT throws_ok($$ SELECT public.set_master_password('secret2', 'wrong!') $$, NULL, 'Wrong master password',
  'changing it needs the current one');
SELECT throws_ok($$ SELECT * FROM shop_master_passwords $$, '42501', NULL, 'nobody signed in can read the hash');
SELECT throws_ok($$ SELECT public.set_device_active((SELECT id FROM login_devices WHERE device_key = 'staff-phone-1'), false, 'nope12') $$,
  NULL, 'Wrong master password', 'a wrong master password does not block');
SELECT public.set_device_active((SELECT id FROM login_devices WHERE device_key = 'staff-phone-1'), false, 'secret1');

SELECT pg_temp.act_as(:bridal_staff);
SELECT is(public.register_device('staff-phone-1', 'Android Chrome, phone'), false, 'a blocked device is refused');

SELECT pg_temp.act_as(:bridal_owner);
SELECT ok(EXISTS (SELECT 1 FROM activity_log WHERE action = 'device_blocked' AND important), 'blocking is in the activity log, marked important');

-- ===== reset (migration 047) =====
SELECT is(public.reset_master_password('not-my-login', 'secret3'), 'wrong', 'a wrong sign-in password does not reset');
SELECT lives_ok($$ SELECT public.set_device_active((SELECT id FROM login_devices WHERE device_key = 'staff-phone-1'), true, 'secret1') $$,
  'after a wrong try the old master password still works');
SELECT pg_temp.act_as(:bridal_staff);
SELECT throws_ok($$ SELECT public.reset_master_password('x', 'secret3') $$, NULL, 'Only the shop owner can reset the master password',
  'staff cannot reset the master password');

SELECT * FROM finish();
ROLLBACK;
