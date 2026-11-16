-- Zypher support recovery of a lost master password (migration 051).
-- Run: npx supabase db reset && npx supabase test db   (uses the seeded demo shops; everything is rolled back)
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(13);

\set zypher '''aaaaaaaa-0000-0000-0000-000000000001'''
\set bridal_owner '''aaaaaaaa-0000-0000-0000-000000000011'''
\set bridal_manager '''aaaaaaaa-0000-0000-0000-000000000012'''

-- p_amr: 'otp' = the session came from an emailed code just now
CREATE FUNCTION pg_temp.act_as(p_user uuid, p_amr text DEFAULT 'password', p_aal text DEFAULT 'aal1') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal,
    'amr', json_build_array(json_build_object('method', p_amr, 'timestamp', extract(epoch FROM now())::bigint)))::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.act_as(uuid, text, text) TO authenticated;

SELECT pg_temp.act_as(:bridal_owner);
SELECT set_master_password('oldmaster1');
SELECT throws_ok($$ SELECT master_reset_request() $$, NULL, 'Type the code we emailed you first', 'a password session cannot ask');
SELECT pg_temp.act_as(:bridal_manager, 'otp');
SELECT throws_ok($$ SELECT master_reset_request() $$, NULL, 'Only the shop owner can do this', 'a manager cannot ask');

SELECT pg_temp.act_as(:bridal_owner, 'otp');
SELECT lives_ok($$ SELECT master_reset_request() $$, 'the owner asks after the emailed code');
SELECT throws_ok($$ SELECT master_reset_request() $$, NULL, 'A request is already open', 'one open request at a time');
SELECT throws_ok($$ SELECT master_reset_complete('newmaster1') $$, NULL, 'The reset is not unlocked yet', 'nothing before Zypher confirms');
SELECT throws_ok($$ SELECT zypher_master_requests() $$, NULL, 'Only Zypher can do this', 'the owner cannot see Zypher''s list');

SELECT pg_temp.act_as(:zypher, 'password', 'aal2');
SELECT is(jsonb_array_length(zypher_master_requests()), 1, 'Zypher sees the request');
SELECT is(zypher_master_confirm((zypher_master_requests() -> 0 ->> 'id')::uuid) ->> 'shop', 'Kalyani Bridal', 'Zypher confirms by phone');

SELECT pg_temp.act_as(:bridal_owner);
SELECT throws_ok($$ SELECT master_reset_complete('newmaster1') $$, NULL, 'The reset is not unlocked yet', 'still locked during the 24 hours');
SELECT ok(NOT (master_reset_status() ->> 'ready')::boolean, 'the status says it is waiting');

-- the 24 hours pass
RESET role;
UPDATE master_reset_requests SET ready_at = now() - interval '1 minute';
SELECT pg_temp.act_as(:bridal_owner);
SELECT is(jsonb_array_length(master_reset_complete('newmaster1') -> 'codes'), 8, 'after the wait: new password and 8 new codes');
SELECT is(set_device_active(gen_random_uuid(), true, 'newmaster1'), 'ok', 'the new master password works');
SELECT ok(master_reset_status() IS NULL, 'the request is closed');

SELECT * FROM finish();
ROLLBACK;
