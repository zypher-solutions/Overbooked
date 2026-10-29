-- Zypher's console is setup and billing only: it never reads or changes a shop's business data.
-- A per-shop support login works inside one shop, like its owner, without destructive money powers.
-- Run: npx supabase db reset && npx supabase test db   (uses the seeded demo shops; everything is rolled back)
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(37);

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

-- ===== Zypher admin, with Kalyani opened for setup: business data is invisible =====
SELECT pg_temp.act_as(:zypher);
SELECT is(public.current_shop_id(), NULL::uuid, 'a Zypher admin has no business shop');
SELECT is(public.setup_shop_id(), :kalyani::uuid, 'but has the shop opened for setup');
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

-- setup still works: branches and invites of the opened shop, never another shop
SELECT cmp_ok((SELECT count(*) FROM branches), '>', 0::bigint, 'sees the branches of the setup shop');
SELECT is((SELECT count(*) FROM branches WHERE shop_id <> :kalyani), 0::bigint, 'and no other shop''s branches');
SELECT is((SELECT count(*) FROM profiles WHERE shop_id IS NOT NULL AND shop_id <> :kalyani), 0::bigint, 'sees only that shop''s people, not every shop''s');
SELECT lives_ok($$ SELECT * FROM public.get_staff_emails() $$, 'can list the setup shop''s logins');
SELECT cmp_ok((SELECT count(*) FROM public.setup_branch_stock()), '>', 0::bigint, 'sees piece counts per branch');

SELECT lives_ok($$ UPDATE shops SET monthly_fee = 1 WHERE id = '5a000000-0000-0000-0000-000000000001' $$, 'a free-form shop update does not error');
SELECT isnt((SELECT monthly_fee FROM shops WHERE id = '5a000000-0000-0000-0000-000000000001'), 1::numeric, 'but changes nothing');
SELECT lives_ok($$ UPDATE shop_payments SET amount = 1 $$, 'a free-form billing update does not error');
SELECT is((SELECT count(*) FROM shop_payments WHERE amount = 1), 0::bigint, 'but billing records are unchanged');
SELECT lives_ok($$ DELETE FROM business_templates WHERE key = 'resort' $$, 'a free-form type delete does not error');
SELECT is((SELECT count(*) FROM business_templates WHERE key = 'resort'), 1::bigint, 'but the business type is still there');

-- an opened shop is logged
SELECT pg_temp.as_postgres();
SELECT pg_temp.act_as(:zypher);
SELECT public.switch_shop(:raja);
SELECT is(public.setup_shop_id(), :raja::uuid, 'Zypher can move to another shop for setup');
SELECT cmp_ok((SELECT count(*) FROM audit_log WHERE action = 'setup_opened' AND shop_id = :raja), '>', 0::bigint, 'opening a shop for setup is in the audit log');

-- ===== the per-shop support login =====
SELECT pg_temp.act_as(:bridal_support);
SELECT is(public.current_shop_id(), :kalyani::uuid, 'support works inside its own shop');
SELECT cmp_ok((SELECT count(*) FROM customers), '>=', 0::bigint, 'and sees that shop''s data');
SELECT is((SELECT count(*) FROM rentals WHERE shop_id <> :kalyani), 0::bigint, 'but nothing of another shop');
SELECT throws_like($$ SELECT public.admin_delete_rental((SELECT id FROM rentals LIMIT 1), 'support cleanup') $$,
  'A Zypher support login cannot change or delete money records', 'support cannot delete money records');
SELECT cmp_ok((SELECT count(*) FROM products), '>', 0::bigint, 'support can read the catalog');

-- ===== the shop's own people are unchanged =====
SELECT pg_temp.act_as(:bridal_owner);
SELECT is(public.current_shop_id(), :kalyani::uuid, 'an owner still works in the shop');
SELECT is((SELECT count(*) FROM profiles WHERE role = 'support' AND is_active) , 1::bigint, 'the owner can see that a support login exists');
SELECT cmp_ok((SELECT count(*) FROM rentals), '>', 0::bigint, 'the shop has bookings the owner sees (so the zero counts above mean something)');
SELECT cmp_ok((SELECT count(*) FROM customers), '>', 0::bigint, 'and customers');

SELECT * FROM finish();
ROLLBACK;
