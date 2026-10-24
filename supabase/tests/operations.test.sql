-- Editing bookings, sets availability, reminders, Zypher receipts and the automatic pause.
-- Run: npx supabase db reset && npx supabase test db   (uses the seeded demo shops; everything is rolled back)
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(25);

\set zypher '''aaaaaaaa-0000-0000-0000-000000000001'''
\set bridal_owner '''aaaaaaaa-0000-0000-0000-000000000011'''
\set bridal_staff '''aaaaaaaa-0000-0000-0000-000000000013'''
\set resort_staff '''aaaaaaaa-0000-0000-0000-000000000032'''
\set car_staff '''aaaaaaaa-0000-0000-0000-000000000042'''

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
CREATE FUNCTION pg_temp.ist(p_days integer, p_time text) RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$
  SELECT ((CURRENT_DATE + p_days) + p_time::time) AT TIME ZONE 'Asia/Kolkata';
$$;
GRANT EXECUTE ON FUNCTION pg_temp.act_as(uuid), pg_temp.as_postgres(), pg_temp.ist(integer, text) TO authenticated;

-- ===========================================================================
-- Editing a booking before pickup (seeded resort booking: room 101, days 7 to 9, advance 4,500)
-- ===========================================================================
SELECT pg_temp.act_as(:resort_staff);
CREATE TEMP VIEW v_gvr AS SELECT * FROM rentals WHERE token LIKE 'GVR-%-0001';
GRANT SELECT ON v_gvr TO authenticated;
SELECT is((public.update_rental((SELECT id FROM v_gvr), jsonb_build_object(
    'start_at', pg_temp.ist(7, '14:00'), 'end_at', pg_temp.ist(10, '11:00'), 'adults', 2,
    'lines', '[{"variation_id": "e0000000-0000-0000-0000-000000000031", "qty": 1}]'::jsonb)) ->> 'total')::numeric,
  13500.00, 'resort: one more night, one guest less = 3 nights x 4,500');
SELECT is((SELECT u.code FROM unit_reservations ur JOIN units u ON u.id = ur.unit_id WHERE ur.rental_id = (SELECT id FROM v_gvr)),
          '101', 'the booking keeps the room it had');
SELECT is((SELECT upper(period) FROM unit_reservations WHERE rental_id = (SELECT id FROM v_gvr)),
          pg_temp.ist(10, '11:00') + interval '3 hours', 'the room is held to the new check-out + housekeeping');
SELECT lives_ok($$ SELECT public.update_rental((SELECT id FROM v_gvr), jsonb_build_object(
    'start_at', pg_temp.ist(7, '14:00'), 'end_at', pg_temp.ist(8, '11:00'), 'adults', 2,
    'lines', '[{"variation_id": "e0000000-0000-0000-0000-000000000031", "qty": 2}]'::jsonb)) $$,
  'two rooms for one night');
SELECT is((SELECT count(*) FROM unit_reservations WHERE rental_id = (SELECT id FROM v_gvr)), 2::bigint, 'two rooms held');
SELECT throws_like($$ SELECT public.update_rental((SELECT id FROM v_gvr), jsonb_build_object(
    'start_at', pg_temp.ist(7, '14:00'), 'end_at', pg_temp.ist(8, '11:00'), 'adults', 2,
    'lines', '[{"variation_id": "e0000000-0000-0000-0000-000000000031", "qty": 1}]'::jsonb, 'discount', 500)) $$,
  'The new total would be less than what was already paid%', 'cannot cut the total below what was paid');
SELECT is((SELECT count(*) FROM unit_reservations WHERE rental_id = (SELECT id FROM v_gvr)), 2::bigint,
          'a refused change leaves the booking as it was');
SELECT throws_like($$ SELECT public.update_rental((SELECT id FROM v_gvr), jsonb_build_object(
    'start_at', pg_temp.ist(7, '14:00'), 'end_at', pg_temp.ist(8, '11:00'),
    'lines', '[{"variation_id": "e0000000-0000-0000-0000-000000000031", "qty": 9}]'::jsonb)) $$,
  'Only % of 9 available%', 'cannot take more rooms than are free');
SELECT pg_temp.as_postgres();
SELECT is((SELECT reason FROM audit_log WHERE table_name = 'rental_lines' AND action = 'delete' ORDER BY id DESC LIMIT 1),
          'Booking changed before pickup', 'replaced lines are logged with the reason');

SELECT pg_temp.act_as(:car_staff);
SELECT lives_ok($$ SELECT public.start_rental((SELECT id FROM rentals WHERE token LIKE 'KDC-%-0001'), jsonb_build_object('id_verified', true,
    'checks', jsonb_build_array(jsonb_build_object('unit_id', (SELECT unit_id FROM unit_reservations WHERE rental_id = (SELECT id FROM rentals WHERE token LIKE 'KDC-%-0001')),
                                                    'odometer', 18250, 'fuel_level', 8)))) $$, 'car picked up early');
SELECT throws_like($$ SELECT public.update_rental((SELECT id FROM rentals WHERE token LIKE 'KDC-%-0001'), jsonb_build_object(
    'start_at', pg_temp.ist(7, '09:00'), 'end_at', pg_temp.ist(9, '09:00'),
    'lines', '[{"variation_id": "e0000000-0000-0000-0000-000000000041", "qty": 1}]'::jsonb)) $$,
  'Only a booking that has not been picked up can be changed%', 'a rental that is out cannot be re-planned');

-- ===========================================================================
-- Sets
-- ===========================================================================
SELECT pg_temp.as_postgres();
INSERT INTO products (id, shop_id, category_id, name, sku) VALUES
  ('d0000000-0000-0000-0000-0000000000ff', '5a000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Bridal set', 'BR-SET-1');
INSERT INTO product_variations (id, shop_id, product_id, name, sku) VALUES
  ('e0000000-0000-0000-0000-0000000000ff', '5a000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000000ff', 'Standard', 'BR-SET-1-STD');
SELECT pg_temp.act_as(:bridal_owner);
SELECT throws_like($$ SELECT public.save_set_items('d0000000-0000-0000-0000-0000000000ff', '[{"variation_id": "e0000000-0000-0000-0000-000000000011"}]') $$,
  'Sets are not switched on%', 'sets need the feature');
SELECT pg_temp.act_as(:zypher);
SELECT lives_ok($$ SELECT public.update_shop('5a000000-0000-0000-0000-000000000001', '{"settings": {"features": {"sets": true}}}') $$, 'Zypher switches sets on');
SELECT pg_temp.act_as(:bridal_owner);
SELECT lives_ok($$ SELECT public.save_set_items('d0000000-0000-0000-0000-0000000000ff',
    '[{"variation_id": "e0000000-0000-0000-0000-000000000011"}, {"variation_id": "e0000000-0000-0000-0000-000000000012"}]') $$, 'a set of lehenga + saree');
SELECT throws_like($$ SELECT public.save_set_items('d0000000-0000-0000-0000-0000000000ff', '[{"variation_id": "e0000000-0000-0000-0000-0000000000ff"}]') $$,
  'A set cannot contain itself%', 'a set cannot contain itself');
SELECT is((SELECT array[free, total] FROM branch_availability('b0000000-0000-0000-0000-000000000001', pg_temp.ist(20, '10:00'), pg_temp.ist(21, '10:00'))
           WHERE variation_id = 'e0000000-0000-0000-0000-0000000000ff'), array[1, 1], 'one whole set free (1 lehenga, 2 sarees at MG Road)');
SELECT is((SELECT free FROM branch_availability('b0000000-0000-0000-0000-000000000001', pg_temp.ist(7, '12:00'), pg_temp.ist(8, '10:00'))
           WHERE variation_id = 'e0000000-0000-0000-0000-0000000000ff'), 0, 'no set while the lehenga is booked');

-- ===========================================================================
-- Reminders
-- ===========================================================================
SELECT pg_temp.act_as(:bridal_staff);
SELECT lives_ok($$ SELECT public.mark_reminder_sent((SELECT id FROM rentals WHERE token LIKE 'KAL-%-0001'), 'pickup_reminder') $$, 'staff mark a reminder as sent');
SELECT is((SELECT count(*) FROM rental_reminders), 1::bigint, 'the reminder is recorded');

-- ===========================================================================
-- Zypher receipts and the automatic pause
-- ===========================================================================
SELECT pg_temp.act_as(:zypher);
SELECT public.record_shop_payment('5a000000-0000-0000-0000-000000000002', 599, CURRENT_DATE, CURRENT_DATE + 30);
SELECT matches((SELECT receipt_no FROM shop_payments WHERE shop_id = '5a000000-0000-0000-0000-000000000002'),
  '^ZYP-[0-9]{4}-[0-9]{2}-0001$', 'receipts are numbered per financial year');
SELECT is(public.pause_overdue_shops(), 0, 'nothing is paused while the rule is off');
UPDATE platform_settings SET auto_pause_after_days = 2;
SELECT is(public.pause_overdue_shops(), 1, 'Munnar (3 days overdue) is paused with a 2-day rule');

-- ===========================================================================
-- Appointments and measurements (direct writes, guarded by the rules)
-- ===========================================================================
SELECT pg_temp.act_as(:bridal_staff);
SELECT lives_ok($$ INSERT INTO appointments (shop_id, branch_id, customer_id, type, scheduled_at)
    VALUES ('5a000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001',
            (SELECT id FROM customers WHERE full_name = 'Anjali Menon'), 'fitting', now() + interval '2 days') $$,
  'staff book a fitting in their branch');
SELECT throws_ok($$ INSERT INTO appointments (shop_id, branch_id, customer_id, type, scheduled_at)
    VALUES ('5a000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002',
            (SELECT id FROM customers WHERE full_name = 'Anjali Menon'), 'fitting', now() + interval '2 days') $$,
  '42501', NULL, 'staff cannot book appointments in another branch');
SELECT lives_ok($$ INSERT INTO customer_measurements (shop_id, customer_id, measurements)
    VALUES ('5a000000-0000-0000-0000-000000000001', (SELECT id FROM customers WHERE full_name = 'Anjali Menon'), '{"Bust": "34"}') $$,
  'staff save measurements');

SELECT * FROM finish();
ROLLBACK;
