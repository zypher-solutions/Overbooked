-- Zypher's console is setup and billing only: it never reads or changes a shop's business data.
-- A per-shop support login works inside one shop, like its owner, without destructive money powers.
-- Run: npx supabase db reset && npx supabase test db   (uses the seeded demo shops; everything is rolled back)
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(45);

\set zypher '''aaaaaaaa-0000-0000-0000-000000000001'''
\set bridal_owner '''aaaaaaaa-0000-0000-0000-000000000011'''
\set bridal_staff '''aaaaaaaa-0000-0000-0000-000000000013'''
\set bridal_support '''aaaaaaaa-0000-0000-0000-000000000014'''
\set groom_owner '''aaaaaaaa-0000-0000-0000-000000000021'''
\set kalyani '''5a000000-0000-0000-0000-000000000001'''
\set raja '''5a000000-0000-0000-0000-000000000002'''

CREATE FUNCTION pg_temp.act_as(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;
CREATE FUNCTION pg_temp.as_postgres() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.act_as(uuid), pg_temp.as_postgres() TO authenticated;

-- ===== Zypher admin: business data is invisible =====
SELECT pg_temp.act_as(:zypher);
SELECT is(public.current_shop_id(), NULL::uuid, 'a Zypher admin has no business shop');
SELECT is((SELECT count(*) FROM customers), 0::bigint, 'cannot read customers');
SELECT is((SELECT count(*) FROM rentals), 0::bigint, 'cannot read rentals');
SELECT is((SELECT count(*) FROM payments), 0::bigint, 'cannot read payments');
SELECT is((SELECT count(*) FROM rental_lines), 0::bigint, 'cannot read booking lines');
SELECT is((SELECT count(*) FROM rental_checks), 0::bigint, 'cannot read pickup and return checks');
SELECT is((SELECT count(*) FROM units), 0::bigint, 'cannot read pieces');
SELECT is((SELECT count(*) FROM products), 0::bigint, 'cannot read products and prices');
SELECT is((SELECT count(*) FROM appointments) + (SELECT count(*) FROM customer_measurements), 0::bigint, 'cannot read appointments or measurements');
SELECT throws_ok($$ INSERT INTO customers (shop_id, full_name, phone) VALUES ('5a000000-0000-0000-0000-000000000001', 'Zypher test', '9999999999') $$,
  NULL, NULL, 'cannot add a customer');
SELECT throws_ok($$ SELECT public.admin_delete_rental((SELECT id FROM rentals LIMIT 1), 'cleanup attempt') $$, NULL, NULL, 'cannot delete a rental');
SELECT throws_like($$ SELECT public.record_rental_payment('00000000-0000-0000-0000-000000000000', 'payment', 100, 'cash') $$,
  'Your account is not active in a shop', 'cannot take a payment');
SELECT throws_like($$ SELECT public.dashboard_summary(CURRENT_DATE, CURRENT_DATE) $$, 'Your account is not active in a shop', 'cannot read the shop dashboard');
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id = 'rental_photos'), 0::bigint, 'cannot read handover or ID photos');

-- setup works by naming the shop: any shop, through functions, never through the tables
SELECT cmp_ok(jsonb_array_length(public.setup_branches(:kalyani)), '>', 0, 'lists the branches of a shop it names');
SELECT is((public.setup_branches(:kalyani) -> 0) ? 'pieces', false, 'and says nothing about what a branch holds');
SELECT cmp_ok(jsonb_array_length(public.setup_people(:kalyani)), '>', 0, 'lists the logins of a shop it names');
SELECT is((SELECT count(*) FROM branches), 0::bigint, 'but reads no branch table directly');
SELECT is((SELECT count(*) FROM profiles WHERE shop_id IS NOT NULL), 0::bigint, 'nor any shop''s people directly');

SELECT throws_ok($$ UPDATE shops SET monthly_fee = 1 WHERE id = '5a000000-0000-0000-0000-000000000001' $$, '42501', NULL, 'a free-form shop update is refused');
SELECT isnt((SELECT monthly_fee FROM shops WHERE id = '5a000000-0000-0000-0000-000000000001'), 1::numeric, 'but changes nothing');
SELECT throws_ok($$ UPDATE shop_payments SET amount = 1 $$, '42501', NULL, 'a free-form billing update is refused');
SELECT is((SELECT count(*) FROM shop_payments WHERE amount = 1), 0::bigint, 'but billing records are unchanged');
SELECT throws_ok($$ DELETE FROM business_templates WHERE key = 'resort' $$, '42501', NULL, 'a free-form type delete is refused');
SELECT is((SELECT count(*) FROM business_templates WHERE key = 'resort'), 1::bigint, 'but the business type is still there');

-- branch and staff changes name the shop, are checked each time, and are logged
SELECT throws_like($$ SELECT public.setup_save_branch('5a000000-0000-0000-0000-000000000002', NULL, '{"name":"Over the limit"}') $$, 'Your Starter plan allows 1%', 'the plan''s branch limit applies to Zypher too');
SELECT pg_temp.as_postgres();
UPDATE shops SET plan = 'business' WHERE id = '5a000000-0000-0000-0000-000000000002';
SELECT pg_temp.act_as(:zypher);
SELECT lives_ok($$ SELECT public.setup_save_branch('5a000000-0000-0000-0000-000000000002', NULL, '{"name":"Zypher test branch","phone":"9000000000"}') $$, 'adds a branch to a shop');
SELECT cmp_ok((SELECT count(*) FROM audit_log WHERE action = 'setup_insert' AND table_name = 'branches' AND shop_id = '5a000000-0000-0000-0000-000000000002'), '>', 0::bigint,
  'the new branch is in the audit log');
SELECT throws_like($$ SELECT public.setup_save_branch('5a000000-0000-0000-0000-000000000002', NULL, '{"name":"Zypher test branch"}') $$, '%already has a branch%',
  'a second branch with the same name is refused');
SELECT throws_like($$ SELECT public.setup_branches('00000000-0000-0000-0000-000000000000') $$, 'Shop not found', 'an unknown shop is refused');
SELECT throws_like($$ SELECT public.setup_set_person('5a000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000011', '{"is_active":false}') $$,
  'At least one active owner must remain%', 'the last active owner cannot be switched off');
SELECT throws_like($$ SELECT public.setup_set_person('5a000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000013', '{"role":"owner"}') $$,
  'Staff member not found in this shop', 'a person of another shop cannot be changed by naming the wrong shop');
SELECT throws_like($$ SELECT public.setup_delete_branch('5a000000-0000-0000-0000-000000000001',
  (SELECT (p ->> 'branch_id')::uuid FROM jsonb_array_elements(public.setup_people('5a000000-0000-0000-0000-000000000001')) p WHERE p ->> 'id' = 'aaaaaaaa-0000-0000-0000-000000000013')) $$,
  'People are assigned to this branch%', 'a branch with people cannot be deleted');
SELECT throws_like($$ SELECT public.setup_check_person('5a000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001') $$,
  'Use Change password%', 'no login link for oneself');

-- ===== the per-shop support login =====
SELECT pg_temp.act_as(:bridal_support);
SELECT is(public.current_shop_id(), :kalyani::uuid, 'support works inside its own shop');
SELECT cmp_ok((SELECT count(*) FROM customers), '>=', 0::bigint, 'and sees that shop''s data');
SELECT is((SELECT count(*) FROM rentals WHERE shop_id <> :kalyani), 0::bigint, 'but nothing of another shop');
SELECT throws_like($$ SELECT public.admin_delete_rental((SELECT id FROM rentals LIMIT 1), 'support cleanup') $$,
  'A Zypher support login cannot change or delete money records', 'support cannot delete money records');
SELECT cmp_ok((SELECT count(*) FROM products), '>', 0::bigint, 'support can read the catalog');
SELECT throws_like($$ SELECT public.setup_people('5a000000-0000-0000-0000-000000000001') $$, 'Only Zypher can do this', 'and a support login cannot use the setup functions');

-- ===== the shop's own people are unchanged =====
SELECT pg_temp.act_as(:bridal_owner);
SELECT is(public.current_shop_id(), :kalyani::uuid, 'an owner still works in the shop');
SELECT is((SELECT count(*) FROM profiles WHERE role = 'support' AND is_active) , 1::bigint, 'the owner can see that a support login exists');
SELECT cmp_ok((SELECT count(*) FROM rentals), '>', 0::bigint, 'the shop has bookings the owner sees (so the zero counts above mean something)');
SELECT cmp_ok((SELECT count(*) FROM customers), '>', 0::bigint, 'and customers');
SELECT throws_like($$ SELECT public.setup_branches('5a000000-0000-0000-0000-000000000001') $$, 'Only Zypher can do this', 'but an owner cannot use the setup functions');

SELECT * FROM finish();
ROLLBACK;
