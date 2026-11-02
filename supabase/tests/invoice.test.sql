-- Tax invoices: only for a shop with a GSTIN, only after the return, one fixed number per rental, counted per shop and year.
-- Run: npx supabase db reset && npx supabase test db   (uses the seeded demo shops; everything is rolled back)
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(8);

\set bridal_staff '''aaaaaaaa-0000-0000-0000-000000000013'''
\set groom_staff '''aaaaaaaa-0000-0000-0000-000000000022'''

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
CREATE TEMP TABLE t_ids (name text PRIMARY KEY, id uuid);
GRANT ALL ON t_ids TO authenticated;

-- two rentals, handed over and returned
SELECT pg_temp.act_as(:bridal_staff);
SELECT public.create_rental(jsonb_build_object(
    'branch_id', 'b0000000-0000-0000-0000-000000000001', 'start_at', pg_temp.ist(0, '10:00'), 'end_at', pg_temp.ist(1, '10:00'), 'notes', 'QA inv 1',
    'lines', '[{"variation_id": "e0000000-0000-0000-0000-000000000012", "qty": 1}]'::jsonb,
    'customer', '{"full_name": "QA Invoice", "phone": "9000000066"}'::jsonb));
INSERT INTO t_ids SELECT 'one', id FROM rentals WHERE notes = 'QA inv 1';
INSERT INTO t_ids SELECT 'one_unit', unit_id FROM unit_reservations WHERE rental_id = (SELECT id FROM t_ids WHERE name = 'one');
-- the second rental takes the other gold saree, so the two never share a piece
SELECT public.create_rental(jsonb_build_object(
    'branch_id', 'b0000000-0000-0000-0000-000000000001', 'start_at', pg_temp.ist(10, '10:00'), 'end_at', pg_temp.ist(11, '10:00'), 'notes', 'QA inv 2',
    'lines', jsonb_build_array(jsonb_build_object('variation_id', 'e0000000-0000-0000-0000-000000000012', 'qty', 1, 'unit_ids', jsonb_build_array(
      (SELECT unit_id FROM public.find_available_units('b0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000012',
                                                        pg_temp.ist(10, '10:00'), pg_temp.ist(11, '10:00'))
       WHERE unit_id <> (SELECT id FROM t_ids WHERE name = 'one_unit') LIMIT 1)))),
    'customer', '{"full_name": "QA Invoice", "phone": "9000000066"}'::jsonb));
INSERT INTO t_ids SELECT 'two', id FROM rentals WHERE notes = 'QA inv 2';
INSERT INTO t_ids SELECT 'two_unit', unit_id FROM unit_reservations WHERE rental_id = (SELECT id FROM t_ids WHERE name = 'two');

-- the shop has no GSTIN yet: a receipt, no invoice
SELECT throws_like(format($f$ SELECT public.issue_invoice(%L) $f$, (SELECT id FROM t_ids WHERE name = 'one')),
  'This shop prints receipts%', 'a shop without a GSTIN issues no tax invoice');

SELECT pg_temp.as_postgres();
UPDATE shops SET gstin = '32ABCDE1234F1Z5', settings = settings || '{"gst_percent": 5}' WHERE id = '5a000000-0000-0000-0000-000000000001';
SELECT pg_temp.act_as(:bridal_staff);
SELECT throws_like(format($f$ SELECT public.issue_invoice(%L) $f$, (SELECT id FROM t_ids WHERE name = 'one')),
  'A tax invoice is issued after the rental is returned%', 'not before the return: the amounts are not final');

SELECT public.start_rental((SELECT id FROM t_ids WHERE name = 'one'), '{}');
SELECT public.complete_rental((SELECT id FROM t_ids WHERE name = 'one'),
  jsonb_build_object('checks', jsonb_build_array(jsonb_build_object('unit_id', (SELECT id FROM t_ids WHERE name = 'one_unit'), 'condition', 'good'))));
SELECT public.start_rental((SELECT id FROM t_ids WHERE name = 'two'), '{}');
SELECT public.complete_rental((SELECT id FROM t_ids WHERE name = 'two'),
  jsonb_build_object('checks', jsonb_build_array(jsonb_build_object('unit_id', (SELECT id FROM t_ids WHERE name = 'two_unit'), 'condition', 'good'))));

SELECT matches((public.issue_invoice((SELECT id FROM t_ids WHERE name = 'one')) ->> 'invoice_no'), '^KAL/[0-9]{4}/0001$', 'the first invoice is numbered 0001');
SELECT cmp_ok(length(public.issue_invoice((SELECT id FROM t_ids WHERE name = 'one')) ->> 'invoice_no'), '<=', 16, 'at most 16 characters');
SELECT is((public.issue_invoice((SELECT id FROM t_ids WHERE name = 'one')) ->> 'invoice_no'),
          (SELECT invoice_no FROM rentals WHERE id = (SELECT id FROM t_ids WHERE name = 'one')), 'asking again gives the same number');
SELECT is((public.issue_invoice((SELECT id FROM t_ids WHERE name = 'one')) ->> 'invoice_date')::date, (now() AT TIME ZONE 'Asia/Kolkata')::date, 'with the date of issue');
SELECT matches((public.issue_invoice((SELECT id FROM t_ids WHERE name = 'two')) ->> 'invoice_no'), '^KAL/[0-9]{4}/0002$', 'the next rental gets 0002');

-- another shop is not affected and cannot issue for this one
SELECT pg_temp.act_as(:groom_staff);
SELECT throws_like(format($f$ SELECT public.issue_invoice(%L) $f$, (SELECT id FROM t_ids WHERE name = 'one')),
  'Rental not found', 'another shop cannot reach it');

SELECT * FROM finish();
ROLLBACK;
