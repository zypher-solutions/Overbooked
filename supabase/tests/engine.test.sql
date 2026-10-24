-- Rental engine, per business type: quotes, double booking, lifecycle, deposits, cancellation, extension.
-- Run: npx supabase db reset && npx supabase test db   (uses the seeded demo shops; everything is rolled back)
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(45);

\set bridal_owner '''aaaaaaaa-0000-0000-0000-000000000011'''
\set bridal_staff '''aaaaaaaa-0000-0000-0000-000000000013'''
\set groom_staff '''aaaaaaaa-0000-0000-0000-000000000022'''
\set resort_staff '''aaaaaaaa-0000-0000-0000-000000000032'''
\set car_staff '''aaaaaaaa-0000-0000-0000-000000000042'''
\set bike_staff '''aaaaaaaa-0000-0000-0000-000000000052'''

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
-- a shop-local (IST) date and time, N days from today
CREATE FUNCTION pg_temp.ist(p_days integer, p_time text) RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$
  SELECT ((CURRENT_DATE + p_days) + p_time::time) AT TIME ZONE 'Asia/Kolkata';
$$;
-- quote of one line
CREATE FUNCTION pg_temp.q(p_branch text, p_variation text, p_start timestamptz, p_end timestamptz, p_extra jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.quote_rental(jsonb_build_object('branch_id', p_branch, 'start_at', p_start, 'end_at', p_end,
    'lines', jsonb_build_array(jsonb_build_object('variation_id', p_variation, 'qty', 1))) || p_extra);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.act_as(uuid), pg_temp.as_postgres(), pg_temp.ist(integer, text),
  pg_temp.q(text, text, timestamptz, timestamptz, jsonb) TO authenticated;

-- ===========================================================================
-- Quotes
-- ===========================================================================
SELECT pg_temp.act_as(:bridal_staff);
SELECT is((pg_temp.q('b0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000011',
                     pg_temp.ist(30, '10:00'), pg_temp.ist(32, '11:00')) ->> 'items_total')::numeric,
          5000.00, 'bridal: 2 days x day rate');

SELECT pg_temp.act_as(:car_staff);
SELECT is((pg_temp.q('b0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000041',
                     pg_temp.ist(30, '09:00'), pg_temp.ist(32, '13:00')) ->> 'items_total')::numeric,
          4400.00, 'car: 2 days + 4 hours (hours capped at a day)');
SELECT is((pg_temp.q('b0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000041',
                     pg_temp.ist(30, '09:00'), pg_temp.ist(30, '14:00')) ->> 'items_total')::numeric,
          1000.00, 'car: 5 hours x hour rate');
SELECT is((pg_temp.q('b0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000041',
                     pg_temp.ist(30, '09:00'), pg_temp.ist(30, '20:00')) ->> 'items_total')::numeric,
          1800.00, 'car: 11 hours costs no more than a day');
SELECT is((pg_temp.q('b0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000041',
                     pg_temp.ist(30, '09:00'), pg_temp.ist(32, '13:00'), '{"with_driver": true}') ->> 'items_total')::numeric,
          6800.00, 'car with driver: driver per started day added');

SELECT pg_temp.act_as(:bike_staff);
SELECT throws_like($$ SELECT pg_temp.q('b0000000-0000-0000-0000-000000000006', 'e0000000-0000-0000-0000-000000000051',
                     pg_temp.ist(30, '09:00'), pg_temp.ist(31, '09:00'), '{"with_driver": true}') $$,
  '%driver are not switched on%', 'bike: no driver option');

SELECT pg_temp.act_as(:resort_staff);
SELECT is((pg_temp.q('b0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000000031',
            pg_temp.ist(30, '14:00'), pg_temp.ist(32, '11:00'), '{"adults": 3, "children": 1}') ->> 'items_total')::numeric,
          12200.00, 'resort: 2 nights + 2 extra guests x 2 nights');
SELECT is((pg_temp.q('b0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000000031',
            pg_temp.ist(30, '14:00'), pg_temp.ist(32, '11:00'),
            jsonb_build_object('adults', 3, 'children', 1,
              'add_ons', jsonb_build_array(jsonb_build_object('add_on_id', (SELECT id FROM add_ons WHERE name = 'Breakfast')))))
          ->> 'add_ons_total')::numeric,
          2400.00, 'resort: breakfast per person per night');
SELECT throws_like($$ SELECT pg_temp.q('b0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000000031',
            pg_temp.ist(30, '14:00'), pg_temp.ist(31, '11:00'), '{"adults": 5}') $$,
  '5 guests is more than these rooms allow%', 'resort: occupancy limit');
SELECT is((public.quote_rental(jsonb_build_object('branch_id', 'b0000000-0000-0000-0000-000000000004',
            'start_at', pg_temp.ist(30, '14:00'), 'end_at', pg_temp.ist(32, '11:00'),
            'whole_property', true, 'adults', 2)) ->> 'items_total')::numeric,
          45000.00, 'resort: whole property = every room for 2 nights');

SELECT pg_temp.act_as(:groom_staff);
SELECT throws_like($$ SELECT public.quote_rental(jsonb_build_object('branch_id', 'b0000000-0000-0000-0000-000000000003',
            'start_at', pg_temp.ist(30, '10:00'), 'end_at', pg_temp.ist(31, '10:00'), 'whole_property', true)) $$,
  '%Whole-property booking is not switched on%', 'groom: no whole-property booking');
SELECT throws_like($$ SELECT pg_temp.q('b0000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000021',
            pg_temp.ist(31, '10:00'), pg_temp.ist(30, '10:00')) $$,
  '%end must be after the start%', 'the end must be after the start');

-- ===========================================================================
-- Double booking (the seeded bridal booking holds BR-LEH-001-M-1 from day 7 10:00 to day 9 11:00 + 1 cleaning day)
-- ===========================================================================
SELECT pg_temp.act_as(:bridal_staff);
SELECT throws_like($$ SELECT public.create_rental(jsonb_build_object('branch_id', 'b0000000-0000-0000-0000-000000000001',
    'customer', jsonb_build_object('full_name', 'Test Bride', 'phone', '9000011111'),
    'start_at', pg_temp.ist(8, '10:00'), 'end_at', pg_temp.ist(8, '18:00'),
    'lines', '[{"variation_id": "e0000000-0000-0000-0000-000000000011", "qty": 1}]'::jsonb)) $$,
  'Only 0 of 1 available%', 'bridal: same piece on overlapping dates is refused');
SELECT throws_like($$ SELECT public.create_rental(jsonb_build_object('branch_id', 'b0000000-0000-0000-0000-000000000001',
    'customer', jsonb_build_object('full_name', 'Test Bride', 'phone', '9000011111'),
    'start_at', pg_temp.ist(10, '10:00'), 'end_at', pg_temp.ist(11, '10:00'),
    'lines', '[{"variation_id": "e0000000-0000-0000-0000-000000000011", "qty": 1}]'::jsonb)) $$,
  'Only 0 of 1 available%', 'bridal: refused during the cleaning day after the return');
SELECT lives_ok($$ SELECT public.create_rental(jsonb_build_object('branch_id', 'b0000000-0000-0000-0000-000000000001',
    'customer', jsonb_build_object('full_name', 'Test Bride', 'phone', '9000011111'),
    'start_at', pg_temp.ist(10, '12:00'), 'end_at', pg_temp.ist(11, '12:00'),
    'lines', '[{"variation_id": "e0000000-0000-0000-0000-000000000011", "qty": 1}]'::jsonb)) $$,
  'bridal: bookable again once cleaning is over');
SELECT throws_like($$ SELECT public.create_rental(jsonb_build_object('branch_id', 'b0000000-0000-0000-0000-000000000002',
    'customer', jsonb_build_object('full_name', 'Test Bride', 'phone', '9000011111'),
    'start_at', pg_temp.ist(20, '10:00'), 'end_at', pg_temp.ist(21, '10:00'),
    'lines', '[{"variation_id": "e0000000-0000-0000-0000-000000000011", "qty": 1}]'::jsonb)) $$,
  '%only work with your own branch%', 'staff cannot book in another branch');
SELECT pg_temp.as_postgres();
SELECT throws_ok($$ INSERT INTO unit_reservations (shop_id, rental_id, line_id, unit_id, period, state)
    SELECT shop_id, rental_id, line_id, unit_id, tstzrange(lower(period) + interval '1 hour', upper(period)), 'held'
    FROM unit_reservations WHERE unit_id = (SELECT id FROM units WHERE code = 'BR-LEH-001-M-1') LIMIT 1 $$,
  '23P01', NULL, 'the database itself refuses an overlapping reservation');

-- ===========================================================================
-- Car lifecycle: book -> pickup checks -> return suggestions -> return with charges -> settled
-- ===========================================================================
SELECT pg_temp.act_as(:car_staff);
CREATE TEMP TABLE t_car AS SELECT public.create_rental(jsonb_build_object('branch_id', 'b0000000-0000-0000-0000-000000000005',
    'customer', jsonb_build_object('id', (SELECT id FROM customers WHERE full_name = 'Rahul Varma')),
    'start_at', now() + interval '1 minute', 'end_at', now() + interval '1 day 1 minute',
    'lines', '[{"variation_id": "e0000000-0000-0000-0000-000000000041", "qty": 1}]'::jsonb,
    'deposit_agreed', 5000, 'advance', '{"amount": 500, "method": "upi"}'::jsonb)) AS r;
GRANT SELECT ON t_car TO authenticated;
CREATE TEMP VIEW v_car AS SELECT * FROM rentals WHERE id = (SELECT (r ->> 'rental_id')::uuid FROM t_car);
GRANT SELECT ON v_car TO authenticated;

SELECT is((SELECT total FROM v_car), 1800.00, 'car: 24 hours = 1 day');
SELECT matches((SELECT token FROM v_car), '^KDC-[0-9]{4}-0002$', 'token uses the shop prefix and counts per shop');
SELECT throws_like($$ SELECT public.start_rental((SELECT id FROM v_car), '{}') $$,
  'Confirm that the licence and ID were checked%', 'pickup needs the licence/ID confirmation');
SELECT throws_like($$ SELECT public.start_rental((SELECT id FROM v_car), '{"id_verified": true}') $$,
  'Record the odometer and fuel level%', 'pickup needs odometer and fuel');
SELECT lives_ok($$ SELECT public.start_rental((SELECT id FROM v_car), jsonb_build_object('id_verified', true,
    'checks', jsonb_build_array(jsonb_build_object('unit_id', (SELECT unit_id FROM unit_reservations WHERE rental_id = (SELECT id FROM v_car)),
                                                    'odometer', 20000, 'fuel_level', 8, 'condition', 'good')),
    'deposit', '{"amount": 5000, "method": "cash"}'::jsonb)) $$, 'car picked up with checks and deposit');
SELECT is((SELECT status FROM v_car), 'active', 'car rental is active');

SELECT is((SELECT sum((c ->> 'amount')::numeric) FROM jsonb_array_elements(public.return_suggestions((SELECT id FROM v_car),
            (SELECT end_at FROM v_car) + interval '3 hours',
            jsonb_build_array(jsonb_build_object('unit_id', (SELECT unit_id FROM unit_reservations WHERE rental_id = (SELECT id FROM v_car)),
                                                 'odometer', 20700))) -> 'charges') c),
          2950.00, 'return suggestions: 3 late hours (450) + penalty (500) + 200 extra km (2000)');
SELECT throws_like($$ SELECT public.complete_rental((SELECT id FROM v_car), jsonb_build_object(
    'checks', jsonb_build_array(jsonb_build_object('unit_id', (SELECT unit_id FROM unit_reservations WHERE rental_id = (SELECT id FROM v_car)),
                                                    'odometer', 19990, 'fuel_level', 8, 'condition', 'good')))) $$,
  '%lower than at pickup%', 'return odometer cannot go backwards');
SELECT lives_ok($$ SELECT public.complete_rental((SELECT id FROM v_car), jsonb_build_object(
    'checks', jsonb_build_array(jsonb_build_object('unit_id', (SELECT unit_id FROM unit_reservations WHERE rental_id = (SELECT id FROM v_car)),
                                                    'odometer', 20700, 'fuel_level', 6, 'condition', 'good')),
    'charges', '[{"type": "extra_km", "amount": 2000}, {"type": "fuel", "amount": 450}]'::jsonb,
    'deposit_applied', 1000, 'payment', '{"amount": 2750, "method": "cash"}'::jsonb,
    'deposit_refund', '{"amount": 4000, "method": "cash"}'::jsonb)) $$, 'car returned with charges, deposit kept and refunded');
SELECT is((SELECT array[total, paid, total - paid, deposit_received - deposit_refunded - deposit_applied] FROM v_car),
          array[4250.00, 4250.00, 0.00, 0.00]::numeric[], 'car: total 4250 settled, nothing due, no deposit left');
SELECT is((SELECT odometer FROM units WHERE id = (SELECT unit_id FROM unit_reservations WHERE rental_id = (SELECT id FROM v_car))),
          20700, 'unit odometer updated at return');
SELECT throws_like($$ SELECT public.record_rental_payment((SELECT id FROM v_car), 'payment', 1, 'cash') $$,
  'That is more than the balance due', 'no payment above the balance');
SELECT throws_like($$ SELECT public.record_rental_payment((SELECT id FROM v_car), 'deposit_refund', 1, 'cash') $$,
  'That is more than the deposit held', 'no refund above the deposit held');
SELECT throws_like($$ SELECT public.add_rental_charge((SELECT id FROM v_car), 'challan', 1000, 'Speeding') $$,
  'Your role (staff) cannot do this', 'staff cannot add a charge after the return');
SELECT pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000041');
SELECT is((public.add_rental_charge((SELECT id FROM v_car), 'challan', 1000, 'Speeding') ->> 'balance')::numeric,
          1000.00, 'owner adds a challan after the return; it becomes the balance due');

-- ===========================================================================
-- Groom: early pickup, damaged on return -> unit goes to maintenance
-- ===========================================================================
SELECT pg_temp.act_as(:groom_staff);
CREATE TEMP VIEW v_groom AS SELECT * FROM rentals WHERE token LIKE 'RAJ-%';
GRANT SELECT ON v_groom TO authenticated;
SELECT lives_ok($$ SELECT public.start_rental((SELECT id FROM v_groom), '{"payment": {"amount": 1000, "method": "upi"}}') $$,
  'groom: picked up a week early');
SELECT is((SELECT lower(period) FROM unit_reservations WHERE rental_id = (SELECT id FROM v_groom)), now(),
          'early pickup holds the unit from now');
SELECT lives_ok($$ SELECT public.complete_rental((SELECT id FROM v_groom), jsonb_build_object('checks', jsonb_build_array(
    jsonb_build_object('unit_id', (SELECT unit_id FROM unit_reservations WHERE rental_id = (SELECT id FROM v_groom)), 'condition', 'damaged')),
    'charges', '[{"type": "damage", "amount": 800, "note": "Torn sleeve"}]'::jsonb)) $$, 'groom: returned damaged');
SELECT is((SELECT status FROM units WHERE id = (SELECT unit_id FROM unit_reservations WHERE rental_id = (SELECT id FROM v_groom))),
          'maintenance', 'damaged unit goes to maintenance');
SELECT is((SELECT total - paid FROM v_groom), 800.00, 'groom: damage charge is due');

-- ===========================================================================
-- Bike: extension re-prices and moves the reservation
-- ===========================================================================
SELECT pg_temp.act_as(:bike_staff);
CREATE TEMP VIEW v_bike AS SELECT * FROM rentals WHERE token LIKE 'MBR-%';
GRANT SELECT ON v_bike TO authenticated;
SELECT is((public.extend_rental((SELECT id FROM v_bike), (SELECT end_at FROM v_bike) + interval '1 day') ->> 'total')::numeric,
          2400.00, 'bike: extended by a day, re-priced to 2 days');
SELECT is((SELECT upper(period) FROM unit_reservations WHERE rental_id = (SELECT id FROM v_bike)),
          (SELECT end_at + interval '30 minutes' FROM v_bike), 'reservation moves to the new end + service time');

-- ===========================================================================
-- Bridal: cancellation keeps the fee, refunds the rest, frees the piece
-- ===========================================================================
SELECT pg_temp.act_as(:bridal_staff);
CREATE TEMP VIEW v_bridal AS SELECT * FROM rentals WHERE token LIKE 'KAL-%-0001';
GRANT SELECT ON v_bridal TO authenticated;
SELECT throws_like($$ SELECT public.cancel_rental((SELECT id FROM v_bridal), 3000, 'upi') $$,
  'The cancellation fee (3000.00) cannot be more than what was paid%', 'fee cannot exceed what was paid');
SELECT is(public.cancel_rental((SELECT id FROM v_bridal), 500, 'upi', 'Wedding postponed') ->> 'refunded', '1500.00',
          'cancelled: 500 kept, 1500 refunded');
SELECT is((SELECT array[total, paid] FROM v_bridal), array[500.00, 500.00]::numeric[], 'cancelled rental: total = fee = paid');
SELECT lives_ok($$ SELECT public.create_rental(jsonb_build_object('branch_id', 'b0000000-0000-0000-0000-000000000001',
    'customer', jsonb_build_object('full_name', 'Another Bride', 'phone', '9000022222'),
    'start_at', pg_temp.ist(7, '10:00'), 'end_at', pg_temp.ist(9, '11:00'),
    'lines', '[{"variation_id": "e0000000-0000-0000-0000-000000000011", "qty": 1}]'::jsonb)) $$,
  'the cancelled dates can be booked again');

-- ===========================================================================
-- Invariants over every rental in the database
-- ===========================================================================
SELECT pg_temp.as_postgres();
SELECT is((SELECT count(*) FROM rentals r WHERE r.status NOT IN ('cancelled', 'no_show') AND
             r.total <> r.items_total + r.add_ons_total + r.charges_total - r.discount), 0::bigint,
          'total = lines + add-ons + charges - discount');
SELECT is((SELECT count(*) FROM rentals r WHERE r.paid <> COALESCE((SELECT sum(CASE kind WHEN 'payment' THEN amount
             WHEN 'deposit_applied' THEN amount WHEN 'refund' THEN -amount ELSE 0 END) FROM payments p WHERE p.rental_id = r.id), 0)
             OR r.paid > r.total OR r.paid < 0
             OR r.deposit_refunded + r.deposit_applied > r.deposit_received), 0::bigint,
          'paid = payments, never above the total; deposit given back <= received');

SELECT * FROM finish();
ROLLBACK;
