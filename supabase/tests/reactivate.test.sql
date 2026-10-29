-- Reactivating a product that was switched off.
-- Run: npx supabase db reset && npx supabase test db   (uses the seeded demo shops; everything is rolled back)
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(6);

\set bridal_owner '''aaaaaaaa-0000-0000-0000-000000000011'''
\set bridal_staff '''aaaaaaaa-0000-0000-0000-000000000013'''
\set groom_owner '''aaaaaaaa-0000-0000-0000-000000000021'''
\set lehenga '''d0000000-0000-0000-0000-000000000011'''

CREATE FUNCTION pg_temp.act_as(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.act_as(uuid) TO authenticated;

SELECT pg_temp.act_as(:bridal_owner);
SELECT public.delete_or_deactivate_product(:lehenga);
SELECT is((SELECT is_active FROM products WHERE id = :lehenga), false, 'a product with history is switched off');

SELECT pg_temp.act_as(:bridal_staff);
SELECT throws_ok($$ SELECT public.reactivate_product('d0000000-0000-0000-0000-000000000011') $$, NULL, NULL, 'staff cannot reactivate');

SELECT pg_temp.act_as(:groom_owner);
SELECT throws_ok($$ SELECT public.reactivate_product('d0000000-0000-0000-0000-000000000011') $$, NULL, NULL, 'another shop cannot reactivate it');

SELECT pg_temp.act_as(:bridal_owner);
SELECT lives_ok($$ SELECT public.reactivate_product('d0000000-0000-0000-0000-000000000011') $$, 'the owner reactivates it');
SELECT is((SELECT is_active FROM products WHERE id = :lehenga), true, 'the product is active again');
SELECT is((SELECT count(*) FROM product_variations WHERE product_id = :lehenga AND NOT is_enabled), 0::bigint, 'and its variations can be booked again');

SELECT * FROM finish();
ROLLBACK;
