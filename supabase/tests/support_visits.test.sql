-- A Zypher admin entering a shop as support (migration 036): only with the owner's consent and two-step sign-in,
-- inside that one shop only, with every support limit, and cut off the moment the owner switches support off.
-- Run: npx supabase db reset && npx supabase test db   (uses the seeded demo shops; everything is rolled back)
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(29);

\set zypher '''aaaaaaaa-0000-0000-0000-000000000001'''
\set bridal_owner '''aaaaaaaa-0000-0000-0000-000000000011'''
\set bridal_staff '''aaaaaaaa-0000-0000-0000-000000000013'''
\set bridal_support '''aaaaaaaa-0000-0000-0000-000000000014'''
\set kalyani '''5a000000-0000-0000-0000-000000000001'''
\set raja '''5a000000-0000-0000-0000-000000000002'''

CREATE FUNCTION pg_temp.act_as(p_user uuid, p_aal text DEFAULT 'aal1') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;
CREATE FUNCTION pg_temp.as_postgres() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.act_as(uuid, text), pg_temp.as_postgres() TO authenticated;

-- two-step sign-in is on, as in production (the seed switches it off for local logins)
SELECT pg_temp.as_postgres();
UPDATE platform_settings SET require_mfa = true;
DELETE FROM support_access;

-- ===== without the owner's consent: nothing =====
SELECT pg_temp.act_as(:zypher, 'aal2');
SELECT is(public.current_shop_id(), NULL::uuid, 'a Zypher admin who is not visiting has no shop');
SELECT throws_like($$ SELECT public.enter_support('5a000000-0000-0000-0000-000000000001') $$,
  'The shop owner has not allowed Zypher support', 'entering a shop whose owner has not allowed support is refused');
SELECT throws_like($$ SELECT public.enter_support('00000000-0000-0000-0000-000000000000') $$, 'Shop not found', 'an unknown shop is refused');
SELECT throws_like($$ INSERT INTO support_visits (admin_id, shop_id) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001') $$,
  'permission denied%', 'a visit cannot be written by hand');

-- ===== the owner allows support =====
SELECT pg_temp.act_as(:bridal_owner);
SELECT public.set_support_access(true);

SELECT pg_temp.act_as(:zypher, 'aal1');
SELECT throws_like($$ SELECT public.enter_support('5a000000-0000-0000-0000-000000000001') $$,
  'Only Zypher can do this', 'entering without the second sign-in step is refused');
SELECT pg_temp.act_as(:bridal_staff);
SELECT throws_like($$ SELECT public.enter_support('5a000000-0000-0000-0000-000000000001') $$,
  'Only Zypher can do this', 'a shop''s own staff cannot use it');

SELECT pg_temp.act_as(:zypher, 'aal2');
SELECT lives_ok($$ SELECT public.enter_support('5a000000-0000-0000-0000-000000000001') $$, 'a Zypher admin with two steps enters the shop');
SELECT is(public.current_shop_id(), :kalyani::uuid, 'and works inside that shop');
SELECT is(public.get_my_role(), 'owner', 'as owner');
SELECT ok(public.is_support(), 'with the support limits');
SELECT ok(public.is_platform_admin(), 'and is still a Zypher admin for the console');
SELECT cmp_ok((SELECT count(*) FROM rentals), '>', 0::bigint, 'sees the shop''s bookings');
SELECT cmp_ok((SELECT count(*) FROM customers), '>', 0::bigint, 'and customers');
SELECT is((SELECT count(*) FROM rentals WHERE shop_id <> :kalyani), 0::bigint, 'but nothing of another shop');
SELECT throws_like($$ SELECT public.admin_delete_rental((SELECT id FROM rentals LIMIT 1), 'support cleanup') $$,
  'A Zypher support login cannot change or delete money records', 'cannot change or delete money records');
SELECT throws_like($$ SELECT public.set_support_access(false) $$,
  'Only the shop owner can change Zypher support access', 'cannot switch support access');
SELECT is((SELECT count(*) FROM activity_log), 0::bigint, 'cannot read the owner''s activity log');
SELECT throws_like($$ SELECT public.enter_support('5a000000-0000-0000-0000-000000000002') $$,
  'The shop owner has not allowed Zypher support', 'cannot move to a shop whose owner has not allowed support');
SELECT is(public.current_shop_id(), :kalyani::uuid, 'and stays in the first shop');

-- the same login without the second step sees nothing, even with the visit open
SELECT pg_temp.act_as(:zypher, 'aal1');
SELECT is(public.current_shop_id(), NULL::uuid, 'the visit needs the second sign-in step on every request');

-- ===== the owner switches support off: cut off at once =====
SELECT pg_temp.act_as(:bridal_owner);
SELECT public.set_support_access(false);
SELECT pg_temp.act_as(:zypher, 'aal2');
SELECT is(public.current_shop_id(), NULL::uuid, 'switching support off ends the visit at once');
SELECT is((SELECT count(*) FROM rentals), 0::bigint, 'the bookings are hidden again');
SELECT is(public.get_my_role(), 'super_admin', 'and the admin is back to a console-only role');
SELECT ok(NOT public.is_support(), 'with no support role');

-- ===== leaving =====
SELECT pg_temp.act_as(:bridal_owner);
SELECT public.set_support_access(true);
SELECT pg_temp.act_as(:zypher, 'aal2');
SELECT lives_ok($$ SELECT public.leave_support() $$, 'the admin leaves');
SELECT is(public.current_shop_id(), NULL::uuid, 'and has no shop afterwards, even with support still allowed');

-- ===== the shop's own people and the per-shop support login are unchanged =====
SELECT pg_temp.act_as(:bridal_owner);
SELECT ok(public.current_shop_id() = :kalyani::uuid AND NOT public.is_support(), 'the owner still works in the shop, not as support');
SELECT pg_temp.act_as(:bridal_support, 'aal2');
SELECT is(public.current_shop_id(), :kalyani::uuid, 'a per-shop support login still works');
SELECT ok(public.is_support(), 'with the support limits');

SELECT * FROM finish();
ROLLBACK;
