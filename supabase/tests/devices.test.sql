-- Login devices and the master password (migrations 046, 050: recovery codes and the 5-tries lock).
-- Run: npx supabase db reset && npx supabase test db   (uses the seeded demo shops; everything is rolled back)
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(28);

\set bridal_owner '''aaaaaaaa-0000-0000-0000-000000000011'''
\set bridal_staff '''aaaaaaaa-0000-0000-0000-000000000013'''

CREATE FUNCTION pg_temp.act_as(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.act_as(uuid) TO authenticated;
CREATE TEMP TABLE codes (c text);
GRANT ALL ON codes TO authenticated;

-- ===== devices =====
SELECT pg_temp.act_as(:bridal_staff);
SELECT is(public.register_device('staff-phone-1', 'Android Chrome, phone'), true, 'a new device is allowed');
SELECT is(public.register_device('staff-phone-1', 'Android Chrome, phone'), true, 'the same device again stays one device');
SELECT is((SELECT count(*) FROM login_devices), 0::bigint, 'staff cannot read the device list');
SELECT throws_ok($$ SELECT public.set_device_active(gen_random_uuid(), false, 'x') $$, NULL, 'Only the shop owner can allow or block devices',
  'staff cannot block a device');

-- ===== master password =====
SELECT throws_ok($$ SELECT public.set_master_password('secret12') $$, NULL, 'Only the shop owner can do this',
  'staff cannot set the master password');
SELECT pg_temp.act_as(:bridal_owner);
SELECT is((SELECT count(*) FROM login_devices WHERE device_key = 'staff-phone-1'), 1::bigint, 'the owner sees the staff device once');
SELECT throws_ok($$ SELECT public.set_device_active((SELECT id FROM login_devices WHERE device_key = 'staff-phone-1'), false, 'x') $$,
  NULL, 'Set a master password first, in Settings', 'blocking needs a master password to exist');
SELECT throws_ok($$ SELECT public.set_master_password('short12') $$, NULL, 'The master password is 8 to 72 characters', 'too short is refused');
INSERT INTO codes SELECT jsonb_array_elements_text(public.set_master_password('secret12') -> 'codes');
SELECT is((SELECT count(*) FROM codes), 8::bigint, 'setting it the first time gives 8 recovery codes');
SELECT is(public.master_codes_left(), 8, '...all unused');
SELECT is(public.set_master_password('secret34', 'wrong!!!') ->> 'result', 'wrong', 'changing it needs the current one');
SELECT throws_ok($$ SELECT * FROM shop_master_passwords $$, '42501', NULL, 'nobody signed in can read the hash');
SELECT throws_ok($$ SELECT * FROM shop_master_recovery_codes $$, '42501', NULL, '...nor the recovery codes');
SELECT is(public.set_device_active((SELECT id FROM login_devices WHERE device_key = 'staff-phone-1'), false, 'nope1234'), 'wrong',
  'a wrong master password does not block');
SELECT is(public.set_device_active((SELECT id FROM login_devices WHERE device_key = 'staff-phone-1'), false, 'secret12'), 'ok',
  'the right one blocks');

SELECT pg_temp.act_as(:bridal_staff);
SELECT is(public.register_device('staff-phone-1', 'Android Chrome, phone'), false, 'a blocked device is refused');

SELECT pg_temp.act_as(:bridal_owner);
SELECT ok(EXISTS (SELECT 1 FROM activity_log WHERE action = 'device_blocked' AND important), 'blocking is in the activity log, marked important');

-- ===== recovery codes =====
SELECT throws_ok($$ SELECT public.new_master_recovery_codes('secret12') $$, NULL, 'Recovery codes are given only once',
  'no second set of codes (migration 052)');
SELECT is(public.check_master_recovery_code('AAAA-AAAA'), 'wrong', 'checking a made-up code says wrong');
SELECT is(public.check_master_recovery_code(lower((SELECT c FROM codes LIMIT 1))), 'ok', 'checking a real code says ok');
SELECT is(public.master_codes_left(), 8, '...without using it up');
SELECT is(public.reset_master_password_with_code('AAAA-AAAA', 'secret56') ->> 'result', 'wrong', 'a made-up code does not reset');
SELECT is(public.reset_master_password_with_code(lower((SELECT c FROM codes LIMIT 1)), 'secret56') ->> 'left', '7',
  'a real code resets it (any case), 7 codes left');
SELECT is(public.reset_master_password_with_code((SELECT c FROM codes LIMIT 1), 'secret78') ->> 'result', 'wrong',
  'a used code does not work again');
SELECT is(public.set_device_active((SELECT id FROM login_devices WHERE device_key = 'staff-phone-1'), true, 'secret56'), 'ok',
  'the new master password works');

-- ===== the 5-tries lock =====
SELECT public.set_device_active((SELECT id FROM login_devices WHERE device_key = 'staff-phone-1'), true, 'bad' || g) FROM generate_series(1, 4) g;
SELECT is(public.set_device_active((SELECT id FROM login_devices WHERE device_key = 'staff-phone-1'), true, 'bad5'), 'locked',
  'the 5th wrong try locks it');
SELECT is(public.set_device_active((SELECT id FROM login_devices WHERE device_key = 'staff-phone-1'), true, 'secret56'), 'locked',
  'while locked, even the right password waits');
SELECT ok(EXISTS (SELECT 1 FROM activity_log WHERE action = 'master_password_locked' AND important), 'the lock is in the log, marked important');

SELECT * FROM finish();
ROLLBACK;
