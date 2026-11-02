-- Cleaning days per booking (bridal and groom shops): the unit is held that long after the return.
-- Run: npx supabase db reset && npx supabase test db   (uses the seeded demo shops; everything is rolled back)
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(19);

\set bridal_staff '''aaaaaaaa-0000-0000-0000-000000000013'''
\set mg_road '''b0000000-0000-0000-0000-000000000001'''
\set gold_saree '''e0000000-0000-0000-0000-000000000012'''

CREATE FUNCTION pg_temp.act_as(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;
CREATE FUNCTION pg_temp.ist(p_days integer, p_time text) RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$
  SELECT ((CURRENT_DATE + p_days) + p_time::time) AT TIME ZONE 'Asia/Kolkata';
$$;
GRANT EXECUTE ON FUNCTION pg_temp.act_as(uuid), pg_temp.ist(integer, text) TO authenticated;

-- a booking of the two gold sarees at MG Road, days 50 to 51 (held until day 52 with the product's 1 day)
SELECT pg_temp.act_as(:bridal_staff);
SELECT lives_ok($$ SELECT public.create_rental(jsonb_build_object(
    'branch_id', 'b0000000-0000-0000-0000-000000000001', 'start_at', pg_temp.ist(50, '10:00'), 'end_at', pg_temp.ist(51, '10:00'),
    'lines', '[{"variation_id": "e0000000-0000-0000-0000-000000000012", "qty": 2}]'::jsonb,
    'customer', '{"full_name": "QA Cleaning", "phone": "9000000099"}'::jsonb)) $$,
  'a later booking holds both sarees');

-- free pieces for days 40 to 42 depend on how many cleaning days the new booking takes
SELECT is((SELECT count(*) FROM public.find_available_units(:mg_road, :gold_saree, pg_temp.ist(40, '10:00'), pg_temp.ist(42, '10:00'), 3)),
  2::bigint, '3 cleaning days still end before the later booking');
SELECT is((SELECT count(*) FROM public.find_available_units(:mg_road, :gold_saree, pg_temp.ist(40, '10:00'), pg_temp.ist(42, '10:00'), 9)),
  0::bigint, '9 cleaning days run into the later booking');
SELECT is((SELECT count(*) FROM public.find_available_units(:mg_road, :gold_saree, pg_temp.ist(40, '10:00'), pg_temp.ist(42, '10:00'))),
  2::bigint, 'without cleaning days the product''s own 1 day applies, as before');
SELECT is((SELECT free FROM public.branch_availability(:mg_road, pg_temp.ist(40, '10:00'), pg_temp.ist(42, '10:00'), 9)
           WHERE variation_id = :gold_saree), 0, 'the counts for the booking form use the cleaning days too');
SELECT is((SELECT free FROM public.branch_availability(:mg_road, pg_temp.ist(40, '10:00'), pg_temp.ist(42, '10:00'))
           WHERE variation_id = :gold_saree), 2, 'and the older call is unchanged');

SELECT throws_like($$ SELECT public.create_rental(jsonb_build_object(
    'branch_id', 'b0000000-0000-0000-0000-000000000001', 'start_at', pg_temp.ist(40, '10:00'), 'end_at', pg_temp.ist(42, '10:00'),
    'cleaning_days', 9, 'lines', '[{"variation_id": "e0000000-0000-0000-0000-000000000012", "qty": 1}]'::jsonb,
    'customer', '{"full_name": "QA Cleaning", "phone": "9000000099"}'::jsonb)) $$,
  'Only % available%', 'a booking whose cleaning days clash with the next booking is refused');
SELECT throws_like($$ SELECT public.create_rental(jsonb_build_object(
    'branch_id', 'b0000000-0000-0000-0000-000000000001', 'start_at', pg_temp.ist(40, '10:00'), 'end_at', pg_temp.ist(42, '10:00'),
    'cleaning_days', -1, 'lines', '[{"variation_id": "e0000000-0000-0000-0000-000000000012", "qty": 1}]'::jsonb,
    'customer', '{"full_name": "QA Cleaning", "phone": "9000000099"}'::jsonb)) $$,
  'Cleaning days cannot be negative', 'cleaning days cannot be negative');

SELECT lives_ok($$ SELECT public.create_rental(jsonb_build_object(
    'branch_id', 'b0000000-0000-0000-0000-000000000001', 'start_at', pg_temp.ist(40, '10:00'), 'end_at', pg_temp.ist(42, '10:00'),
    'cleaning_days', 3, 'lines', '[{"variation_id": "e0000000-0000-0000-0000-000000000012", "qty": 1}]'::jsonb,
    'customer', '{"full_name": "QA Cleaning", "phone": "9000000099"}'::jsonb)) $$, 'a booking with 3 cleaning days');
CREATE TEMP VIEW v_three AS SELECT * FROM rentals WHERE cleaning_days = 3;
GRANT SELECT ON v_three TO authenticated;
SELECT is((SELECT upper(period) FROM unit_reservations WHERE rental_id = (SELECT id FROM v_three)),
  pg_temp.ist(42, '10:00') + interval '3 days', 'the piece is held 3 days after the return date');

SELECT public.update_rental((SELECT id FROM v_three), jsonb_build_object(
    'start_at', pg_temp.ist(40, '10:00'), 'end_at', pg_temp.ist(42, '10:00'), 'cleaning_days', 0,
    'lines', '[{"variation_id": "e0000000-0000-0000-0000-000000000012", "qty": 1}]'::jsonb));
SELECT is((SELECT upper(period) FROM unit_reservations WHERE rental_id = (SELECT id FROM rentals WHERE start_at = pg_temp.ist(40, '10:00'))),
  pg_temp.ist(42, '10:00'), 'changing the booking to 0 cleaning days frees the piece at the return date');

SELECT lives_ok($$ SELECT public.create_rental(jsonb_build_object(
    'branch_id', 'b0000000-0000-0000-0000-000000000001', 'start_at', pg_temp.ist(30, '10:00'), 'end_at', pg_temp.ist(31, '10:00'),
    'lines', '[{"variation_id": "e0000000-0000-0000-0000-000000000012", "qty": 1}]'::jsonb,
    'customer', '{"full_name": "QA Cleaning", "phone": "9000000099"}'::jsonb)) $$, 'a booking without cleaning days');
SELECT is((SELECT upper(period) FROM unit_reservations ur JOIN rentals r ON r.id = ur.rental_id WHERE r.start_at = pg_temp.ist(30, '10:00')),
  pg_temp.ist(31, '10:00') + interval '1 day', 'it keeps the product''s turnaround (1 day)');

-- extending and returning use the booking's cleaning days, not the product's
SELECT lives_ok($$ SELECT public.create_rental(jsonb_build_object(
    'branch_id', 'b0000000-0000-0000-0000-000000000001', 'start_at', pg_temp.ist(20, '10:00'), 'end_at', pg_temp.ist(21, '10:00'),
    'cleaning_days', 4, 'lines', '[{"variation_id": "e0000000-0000-0000-0000-000000000012", "qty": 1}]'::jsonb,
    'customer', '{"full_name": "QA Cleaning", "phone": "9000000099"}'::jsonb)) $$, 'a booking with 4 cleaning days');
CREATE TEMP VIEW v_four AS SELECT * FROM rentals WHERE cleaning_days = 4;
GRANT SELECT ON v_four TO authenticated;
SELECT lives_ok($$ SELECT public.extend_rental((SELECT id FROM v_four), pg_temp.ist(22, '10:00')) $$, 'extended by a day');
SELECT is((SELECT upper(period) FROM unit_reservations WHERE rental_id = (SELECT id FROM v_four)),
  pg_temp.ist(22, '10:00') + interval '4 days', 'after extending, the piece is still held 4 days after the new return date');
SELECT lives_ok($$ SELECT public.start_rental((SELECT id FROM v_four), '{}') $$, 'picked up early');
SELECT lives_ok($$ SELECT public.complete_rental((SELECT id FROM v_four), jsonb_build_object('checks', jsonb_build_array(
    jsonb_build_object('unit_id', (SELECT unit_id FROM unit_reservations WHERE rental_id = (SELECT id FROM v_four)), 'condition', 'good')))) $$,
  'returned');
SELECT is((SELECT upper(period) FROM unit_reservations WHERE rental_id = (SELECT id FROM v_four)),
  now() + interval '1 minute' + interval '4 days', 'after the return the piece is held 4 days (the booking''s cleaning days; the engine keeps at least 1 minute of use)');

SELECT * FROM finish();
ROLLBACK;
