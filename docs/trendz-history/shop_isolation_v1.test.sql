-- Shop isolation, plan limits, per-shop numbering and money rules.
-- Run: npx supabase test db   (uses the two seeded shops; everything is rolled back)
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(31);

-- seeded ids
\set demo '''5a000000-0000-0000-0000-000000000001'''
\set second '''5a000000-0000-0000-0000-000000000002'''
\set zypher '''aaaaaaaa-0000-0000-0000-000000000001'''
\set demo_owner '''aaaaaaaa-0000-0000-0000-000000000002'''
\set demo_staff '''aaaaaaaa-0000-0000-0000-000000000004'''
\set second_owner '''aaaaaaaa-0000-0000-0000-000000000005'''
\set second_staff '''aaaaaaaa-0000-0000-0000-000000000006'''

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

-- ---------------------------------------------------------------------------
-- 1. A demo booking, picked up and returned (gives every table demo rows)
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as(:demo_staff);
INSERT INTO customers (full_name, phone) VALUES ('Test Customer', '9999999999');
SELECT lives_ok($$
  SELECT create_booking_atomic(NULL, (SELECT id FROM customers WHERE phone = '9999999999'),
    '11111111-1111-1111-1111-111111111111', CURRENT_DATE, 'test', NULL, 1998, 500, 1000,
    jsonb_build_array(jsonb_build_object(
      'product_id', 'd0000000-0000-0000-0000-000000000001', 'variation_id', 'e0000000-0000-0000-0000-000000000001',
      'product_name', 'Bridal Suit', 'sku', 'SU-001-RED-M', 'qty', 1, 'daily_rate', 999,
      'pickup_date', CURRENT_DATE, 'return_date', CURRENT_DATE + 2, 'buffer_days', 0, 'subtotal', 1998,
      'inventory_item_ids', (SELECT jsonb_build_array(id) FROM inventory_items WHERE item_sku = 'SU-001-RED-M-001'))), 0)
$$, 'demo staff can create a booking');
SELECT is((SELECT token FROM bookings LIMIT 1), 'BK-0001', 'demo booking token starts at BK-0001');
SELECT lives_ok($$ SELECT pickup_booking_atomic((SELECT id FROM bookings LIMIT 1), CURRENT_DATE + 2, 1498, NULL, 'cash') $$,
  'demo staff can pick up the booking');
SELECT matches((SELECT token FROM rentals LIMIT 1), '^DEM-[0-9]{4}-0001$', 'rental token uses the shop prefix');
SELECT lives_ok($$
  SELECT mark_returned_atomic((SELECT id FROM rentals LIMIT 1), now(), 'good', '', 0, NULL,
    (SELECT jsonb_agg(jsonb_build_object('rental_item_id', rental_item_id, 'inventory_item_id', inventory_item_id, 'condition', 'good'))
     FROM rental_item_inventory), 0, 'cash', 0, NULL)
$$, 'demo staff can return the rental');

-- money rules on the finished rental
SELECT pg_temp.act_as(:demo_owner);
SELECT is((SELECT total - advance FROM rentals LIMIT 1), 0.00::numeric, 'balance due = total - payments = 0');
SELECT is((SELECT total FROM rentals LIMIT 1),
          (SELECT sum(subtotal) FROM rental_items) - (SELECT discount FROM rentals LIMIT 1),
          'total = items - discount');
SELECT is((SELECT deposit_refunded + deposit_deducted FROM rentals LIMIT 1),
          (SELECT security_deposit FROM rentals LIMIT 1), 'deposit refunded + deducted = deposit held');
SELECT is((SELECT sum(amount) FROM ledger_entries WHERE kind IN ('advance_in', 'payment_in')),
          (SELECT advance FROM rentals LIMIT 1), 'ledger cash in = amount paid on the rental');
SELECT ok((SELECT bool_and(status = 'available') FROM inventory_items WHERE item_sku = 'SU-001-RED-M-001'),
          'returned unit is available again');

-- ---------------------------------------------------------------------------
-- 2. The second shop sees none of it
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as(:second_owner);
SELECT is((SELECT count(*) FROM products), 1::bigint, 'second shop sees only its own product');
SELECT is((SELECT count(*) FROM rentals), 0::bigint, 'second shop sees no demo rentals');
SELECT is((SELECT count(*) FROM bookings), 0::bigint, 'second shop sees no demo bookings');
SELECT is((SELECT count(*) FROM customers), 0::bigint, 'second shop sees no demo customers');
SELECT is((SELECT count(*) FROM ledger_entries), 0::bigint, 'second shop sees no demo ledger');
SELECT is((SELECT count(*) FROM inventory_items WHERE shop_id = :demo), 0::bigint, 'second shop sees no demo units');
SELECT is((SELECT count(*) FROM profiles WHERE shop_id = :demo), 0::bigint, 'second shop sees no demo staff');
SELECT is((SELECT count(*) FROM get_all_inventory_stats() s JOIN product_variations v ON v.id = s.variation_id), 1::bigint,
  'stock stats only cover the second shop');

-- functions refuse another shop's ids
SELECT pg_temp.as_postgres();
CREATE TEMP TABLE demo_ids AS SELECT (SELECT id FROM rentals LIMIT 1) AS rental_id, (SELECT id FROM bookings LIMIT 1) AS booking_id;
GRANT SELECT ON demo_ids TO authenticated;
SELECT pg_temp.act_as(:second_owner);
SELECT throws_ok($$ SELECT record_rental_payment((SELECT rental_id FROM demo_ids), 10, 'cash') $$,
  'Rental not found', 'cannot pay into another shop''s rental');
SELECT throws_ok($$ SELECT extend_rental_atomic((SELECT rental_id FROM demo_ids), CURRENT_DATE + 9, 0, 'cash', NULL) $$,
  'Rental not found', 'cannot extend another shop''s rental');
SELECT throws_ok($$ SELECT cancel_booking_atomic((SELECT booking_id FROM demo_ids), 0, 'cash', NULL) $$,
  'Booking not found', 'cannot cancel another shop''s booking');

-- writes that point at another shop are refused
SELECT throws_ok($$ INSERT INTO inventory_items (product_id, variation_id, branch_id, item_sku)
  VALUES ('d0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'X-1') $$,
  '23503', NULL, 'cannot add units to another shop''s product');
SELECT throws_ok($$ INSERT INTO categories (shop_id, name) VALUES ('5a000000-0000-0000-0000-000000000001', 'Sneaky') $$,
  '42501', NULL, 'cannot insert a row tagged with another shop');

-- second shop numbering is its own
SELECT pg_temp.act_as(:second_staff);
INSERT INTO customers (full_name, phone) VALUES ('Second Customer', '8888888888');
SELECT create_booking_atomic(NULL, (SELECT id FROM customers LIMIT 1),
  '33333333-3333-3333-3333-333333333333', CURRENT_DATE, NULL, NULL, 1299, 0, 0,
  jsonb_build_array(jsonb_build_object('product_id', 'd0000000-0000-0000-0000-000000000003', 'variation_id', 'e0000000-0000-0000-0000-000000000004',
    'product_name', 'Groom Sherwani', 'sku', 'SU-001-CREAM-L', 'qty', 1, 'daily_rate', 1299,
    'pickup_date', CURRENT_DATE, 'return_date', CURRENT_DATE + 1, 'buffer_days', 0, 'subtotal', 1299,
    'inventory_item_ids', (SELECT jsonb_build_array(id) FROM inventory_items LIMIT 1))), 0);
SELECT is((SELECT token FROM bookings LIMIT 1), 'BK-0001', 'second shop booking tokens also start at BK-0001');

-- ---------------------------------------------------------------------------
-- 3. Plan limits and staff rules
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as(:second_owner);
SELECT throws_like($$ INSERT INTO branches (name, slug) VALUES ('Second branch', 'second-branch') $$,
  '%Starter plan allows 1 active branch%', 'Starter plan: one branch');
SELECT throws_ok($$ SELECT admin_set_staff_status('aaaaaaaa-0000-0000-0000-000000000006', true, 'super_admin') $$,
  'Invalid role or status', 'an owner cannot grant super_admin');
SELECT throws_ok($$ SELECT admin_set_staff_status('aaaaaaaa-0000-0000-0000-000000000004', false, 'staff') $$,
  'Staff member not found in this shop', 'an owner cannot change another shop''s staff');
SELECT pg_temp.act_as(:second_staff);
SELECT throws_like($$ SELECT * FROM get_staff_emails() $$, '%only the shop owner%', 'staff cannot list staff emails');

-- ---------------------------------------------------------------------------
-- 4. Suspended shop and Zypher
-- ---------------------------------------------------------------------------
SELECT pg_temp.as_postgres();
UPDATE shops SET status = 'suspended' WHERE id = :second;
SELECT pg_temp.act_as(:second_owner);
SELECT is((SELECT count(*) FROM products), 0::bigint, 'a suspended shop sees nothing');

SELECT pg_temp.act_as(:zypher);
SELECT lives_ok($$ SELECT switch_shop('5a000000-0000-0000-0000-000000000002') $$, 'Zypher can switch into a shop');
SELECT is((SELECT count(*) FROM products), 1::bigint, 'Zypher sees the switched-into shop, even when suspended');

SELECT pg_temp.as_postgres();
SELECT * FROM finish();
ROLLBACK;
