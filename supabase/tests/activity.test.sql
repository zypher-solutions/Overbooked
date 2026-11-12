-- Activity log (migration 034): what is logged, in plain words; one save is one entry; only the owner reads it; nobody changes it.
-- Run: npm run test:reset && npx supabase test db   (uses the seeded demo shops and test fixtures; everything is rolled back)
-- The whole file is one transaction, and entries merge per record within a transaction, so each check uses its own record.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(40);

\set zypher '''aaaaaaaa-0000-0000-0000-000000000001'''
\set bridal_owner '''aaaaaaaa-0000-0000-0000-000000000011'''
\set bridal_manager '''aaaaaaaa-0000-0000-0000-000000000012'''
\set bridal_support '''aaaaaaaa-0000-0000-0000-000000000014'''
\set groom_owner '''aaaaaaaa-0000-0000-0000-000000000021'''
\set kalyani '''5a000000-0000-0000-0000-000000000001'''

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
CREATE FUNCTION pg_temp.ist(p_days integer, p_time text) RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$
  SELECT ((CURRENT_DATE + p_days) + p_time::time) AT TIME ZONE 'Asia/Kolkata';
$$;
GRANT EXECUTE ON FUNCTION pg_temp.act_as(uuid, text), pg_temp.as_postgres(), pg_temp.ist(integer, text) TO authenticated;

-- the log starts from what the test fixtures did as each shop's owner
SELECT pg_temp.as_postgres();
CREATE TEMP TABLE t_base AS SELECT max(id) AS id FROM activity_log;
GRANT SELECT ON t_base TO authenticated;
CREATE TEMP VIEW v_new AS SELECT * FROM activity_log WHERE id > COALESCE((SELECT id FROM t_base), 0);
GRANT SELECT ON v_new TO authenticated;

-- ===== wording helpers =====
SELECT is(public._act_inr(123456.5), '₹1,23,456.50', 'money is written the Indian way');
SELECT is(public._act_inr(500), '₹500', 'whole rupees have no paise');

-- ===== a new booking: one entry with its final total, plus its customer and its payment =====
SELECT pg_temp.act_as(:bridal_owner);
SELECT lives_ok($$ SELECT public.create_rental(jsonb_build_object('branch_id', 'b0000000-0000-0000-0000-000000000001',
    'start_at', pg_temp.ist(60, '10:00'), 'end_at', pg_temp.ist(61, '10:00'),
    'lines', '[{"variation_id": "e0000000-0000-0000-0000-000000000012", "qty": 1}]'::jsonb,
    'customer', '{"full_name": "QA Activity", "phone": "9000000401"}'::jsonb)) $$, 'the owner makes a booking');
SELECT is((SELECT count(*) FROM v_new WHERE action = 'booking_created'), 1::bigint, 'one entry for the new booking');
SELECT matches((SELECT summary FROM v_new WHERE action = 'booking_created'), '^New booking KAL-\d{4}-\d{4} for QA Activity, .* total ₹',
  'it names the booking, the customer and the total');
SELECT is((SELECT actor_name || ' / ' || actor_role || ' / ' || area FROM v_new WHERE action = 'booking_created'),
  'Bridal Owner / owner / bookings', 'it says who did it and where');
SELECT is((SELECT count(*) FROM v_new WHERE action = 'customer_added' AND summary LIKE 'Added customer QA Activity%'), 1::bigint,
  'the new customer is logged');
SELECT is((SELECT count(*) FROM v_new WHERE action LIKE 'booking_changed'), 0::bigint,
  'the booking''s lines and totals do not add "changed" entries');

-- ===== a cancellation (fixture booking KAL-2026-0001), with its reason =====
SELECT lives_ok($$ SELECT public.cancel_rental((SELECT id FROM rentals WHERE token = 'KAL-2026-0001'), 0, 'cash', 'Wedding postponed') $$,
  'the owner cancels a booking');
SELECT is((SELECT important::text || ' / ' || reason FROM v_new WHERE action = 'booking_cancelled'), 'true / Wedding postponed',
  'a cancellation is important and keeps its reason');
SELECT is((SELECT count(*) FROM v_new WHERE action = 'payment_refund'), 1::bigint, 'the refund it gave is its own entry');

-- ===== a blocked customer (a fixture customer) =====
SELECT lives_ok($$ UPDATE customers SET is_blocked = true, blocked_reason = 'Did not pay' WHERE full_name = 'Anjali Menon' $$, 'a customer is blocked');
SELECT is((SELECT summary || ' / ' || reason FROM v_new WHERE action = 'customer_blocked'), 'Blocked customer Anjali Menon / Did not pay',
  'blocking a customer is logged with the reason');

-- ===== nothing changed, nothing logged; added and removed in one save, nothing logged =====
SELECT lives_ok($$ UPDATE customers SET full_name = full_name WHERE full_name = 'QA Activity' $$, 'a save that changes nothing');
SELECT is((SELECT count(*) FROM v_new WHERE record_label = 'QA Activity' AND action = 'customer_changed'), 0::bigint, 'is not logged');
INSERT INTO categories (shop_id, name, template_key, sku_prefix) VALUES (:kalyani, 'QA Gone', 'clothing', 'QAG');
DELETE FROM categories WHERE name = 'QA Gone';
SELECT is((SELECT count(*) FROM v_new WHERE record_label = 'QA Gone'), 0::bigint, 'a category added and removed in one save leaves no entry');

-- ===== a product deleted keeps the whole record =====
INSERT INTO categories (shop_id, name, template_key, sku_prefix) VALUES (:kalyani, 'QA Category', 'clothing', 'QAC');
SELECT pg_temp.as_postgres();   -- set up by the database itself: not a person's action, so not logged
INSERT INTO products (shop_id, category_id, name, sku) SELECT :kalyani, id, 'QA Product', 'QA-001' FROM categories WHERE name = 'QA Category';
SELECT is((SELECT count(*) FROM v_new WHERE record_label = 'QA Product'), 0::bigint, 'work done by the database itself is not logged');
SELECT pg_temp.act_as(:bridal_owner);
SELECT lives_ok($$ SELECT public.delete_or_deactivate_product((SELECT id FROM products WHERE sku = 'QA-001')) $$, 'the owner deletes a product');
SELECT ok((SELECT important AND snapshot ->> 'name' = 'QA Product' FROM v_new WHERE action = 'product_deleted'),
  'a deletion is important and keeps the deleted record');

-- ===== sign-ins: one entry even when two screens report it; only known kinds =====
SELECT public.log_account_event('signed_in');
SELECT public.log_account_event('signed_in');
SELECT is((SELECT count(*) FROM v_new WHERE action = 'signed_in'), 1::bigint, 'a sign-in is logged once');
SELECT throws_like($$ SELECT public.log_account_event('deleted_everything') $$, 'Unknown account event', 'only sign-in and password events');

-- ===== carts (migration 035): kept in the browser, reported by the app, worded by the database =====
SELECT public.log_cart_event('customer_set', 2, 'Rehen Manoy');
SELECT is((SELECT summary || ' / ' || area FROM v_new WHERE action = 'cart_customer_set'), 'Started cart 2 for Rehen Manoy / carts',
  'naming a cart''s customer is logged');
SELECT public.log_cart_event('item_added', 2, 'Rehen Manoy', NULL, 'e0000000-0000-0000-0000-000000000012',
  (SELECT id FROM units WHERE variation_id = 'e0000000-0000-0000-0000-000000000012' LIMIT 1));
SELECT matches((SELECT summary FROM v_new WHERE action = 'cart_item_added'), '^Added Kanjivaram silk saree.* \(piece .+\) to the cart for Rehen Manoy$',
  'adding a piece names the item and the piece');
SELECT public.log_cart_event('item_added', 2, NULL, NULL, gen_random_uuid());
SELECT is((SELECT count(*) FROM v_new WHERE action = 'cart_item_added'), 1::bigint, 'an item that is not this shop''s is not logged');
SELECT public.log_cart_event('cart_discarded', 2, 'Rehen Manoy', NULL, NULL, NULL, 1, 3);
SELECT is((SELECT summary FROM v_new WHERE action = 'cart_discarded'), 'Discarded the cart for Rehen Manoy (3 items)', 'discarding a cart is logged');
SELECT throws_like($$ SELECT public.log_cart_event('book_everything', 1) $$, 'Unknown cart event', 'only the four cart actions');

-- ===== the condition at pickup or return joins that booking's entry; a check without a condition (a car) still works =====
SELECT pg_temp.as_postgres();
SELECT set_config('request.jwt.claims', json_build_object('sub', :bridal_owner, 'role', 'authenticated')::text, true);
INSERT INTO rental_checks (shop_id, rental_id, unit_id, phase, condition, notes, checked_by)
  SELECT shop_id, rental_id, unit_id, 'return', 'damaged', 'Torn hem', :bridal_owner FROM unit_reservations
  WHERE rental_id = (SELECT id FROM rentals WHERE token = 'KAL-2026-0001') LIMIT 1;
SELECT matches((SELECT changes::text FROM v_new WHERE record_label = 'KAL-2026-0001' AND action = 'booking_cancelled'),
  'Condition at return.*Damaged, Torn hem', 'the condition joins the booking''s entry');
SELECT lives_ok($$ INSERT INTO rental_checks (shop_id, rental_id, unit_id, phase, odometer, checked_by)
  SELECT shop_id, rental_id, unit_id, 'pickup', 1200, 'aaaaaaaa-0000-0000-0000-000000000011' FROM unit_reservations
  WHERE rental_id = (SELECT id FROM rentals WHERE token = 'KAL-2026-0001') LIMIT 1 $$, 'a check with no condition never blocks the work');
SELECT pg_temp.act_as(:bridal_owner);

-- ===== a branch's own GSTIN and bank (migration 042) are logged under the branch =====
SELECT lives_ok($$ SELECT public.setup_save_branch(:kalyani, 'b0000000-0000-0000-0000-000000000001', '{"gstin": "32abcde1234f1z5"}') $$,
  'the owner gives a branch its own GSTIN');
SELECT lives_ok($$ SELECT public.update_branch_settings('b0000000-0000-0000-0000-000000000001', '{"bank_name": "QA Bank", "bank_ifsc": "QABK0001234"}') $$,
  'and its own bank');
SELECT ok((SELECT changes ? 'GSTIN' AND changes ? 'Bank name' FROM v_new WHERE record_id = 'b0000000-0000-0000-0000-000000000001' AND area = 'branches'
           ORDER BY id DESC LIMIT 1), 'the branch''s GSTIN and bank changes are logged');
SELECT throws_like($$ SELECT public.setup_save_branch(:kalyani, 'b0000000-0000-0000-0000-000000000001', '{"gstin": "BAD"}') $$,
  'A GST number has 15 characters%', 'a wrong GSTIN is refused');

-- ===== who reads it =====
SELECT ok((SELECT count(*) FROM activity_log) > 0, 'the owner reads their shop''s log');
SELECT pg_temp.act_as(:bridal_manager);
SELECT is((SELECT count(*) FROM activity_log), 0::bigint, 'a manager does not');
SELECT pg_temp.act_as(:groom_owner);
SELECT is((SELECT count(*) FROM activity_log WHERE shop_id = :kalyani), 0::bigint, 'another shop''s owner does not');
SELECT pg_temp.act_as(:bridal_owner);
SELECT public.set_support_access(true);
SELECT pg_temp.act_as(:bridal_support, 'aal2');
SELECT is((SELECT count(*) FROM activity_log), 0::bigint, 'a Zypher support login does not, even with access switched on');

-- a Zypher admin entering and leaving the shop as support (migration 036) is in the owner's log under their own name
SELECT pg_temp.act_as(:zypher, 'aal2');
SELECT public.enter_support(:kalyani);
SELECT public.leave_support();
SELECT pg_temp.act_as(:bridal_owner);
SELECT ok((SELECT important AND actor_id = :zypher::uuid AND summary = 'Entered the shop as Zypher support'
           FROM activity_log WHERE shop_id = :kalyani AND action = 'support_entered' ORDER BY occurred_at DESC LIMIT 1),
  'a Zypher admin entering as support is logged, marked important, under their own name');
SELECT is((SELECT count(*) FROM activity_log WHERE shop_id = :kalyani AND action = 'support_left' AND actor_id = :zypher::uuid), 1::bigint,
  'and leaving is logged too');

-- ===== nobody changes it =====
SELECT pg_temp.act_as(:bridal_owner);
SELECT throws_like($$ DELETE FROM activity_log $$, 'permission denied%', 'the owner cannot delete entries');
SELECT throws_like($$ SELECT public._act_log('5a000000-0000-0000-0000-000000000001', NULL, 'money', 'fake', 2, NULL, NULL, NULL, 'Forged') $$,
  'permission denied%', 'nobody can write an entry by hand');

SELECT * FROM finish();
ROLLBACK;
