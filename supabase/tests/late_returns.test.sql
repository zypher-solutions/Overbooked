-- Late returns (migration 037): shop rules for late fees on clothes, the copy kept on each booking, a product's own late
-- fee, holding a hand over, and the list of late pieces needed by their next booking.
-- Run: npx supabase db reset && npx supabase test db   (uses the seeded demo shops; everything is rolled back)
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(36);

\set bridal_owner '''aaaaaaaa-0000-0000-0000-000000000011'''
\set bridal_staff '''aaaaaaaa-0000-0000-0000-000000000013'''
\set gold_saree '''e0000000-0000-0000-0000-000000000012'''

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
-- a 3-day booking of one gold saree starting p_day days from now, 10:00 to 10:00
CREATE FUNCTION pg_temp.book(p_day integer, p_note text) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.create_rental(jsonb_build_object(
    'branch_id', 'b0000000-0000-0000-0000-000000000001', 'start_at', pg_temp.ist(p_day, '10:00'), 'end_at', pg_temp.ist(p_day + 3, '10:00'),
    'notes', p_note, 'lines', '[{"variation_id": "e0000000-0000-0000-0000-000000000012", "qty": 1}]'::jsonb,
    'customer', '{"full_name": "QA Late Fee", "phone": "9000000077"}'::jsonb));
  RETURN (SELECT id FROM public.rentals WHERE notes = p_note);
END $$;
-- the suggested late fee (without the flat late penalty), returned p_late after the end
CREATE FUNCTION pg_temp.fee(p_rental uuid, p_late interval) RETURNS numeric LANGUAGE sql AS $$
  SELECT COALESCE(sum((c ->> 'amount')::numeric), 0)
  FROM jsonb_array_elements(public.return_suggestions(p_rental, (SELECT end_at FROM public.rentals WHERE id = p_rental) + p_late) -> 'charges') c
  WHERE c ->> 'type' = 'late' AND c ->> 'note' <> 'Late return penalty';
$$;
CREATE FUNCTION pg_temp.note(p_rental uuid, p_late interval) RETURNS text LANGUAGE sql AS $$
  SELECT c ->> 'note'
  FROM jsonb_array_elements(public.return_suggestions(p_rental, (SELECT end_at FROM public.rentals WHERE id = p_rental) + p_late) -> 'charges') c
  WHERE c ->> 'type' = 'late' AND c ->> 'note' <> 'Late return penalty' LIMIT 1;
$$;
CREATE FUNCTION pg_temp.rate(p_rental uuid) RETURNS numeric LANGUAGE sql AS $$
  SELECT rate FROM public.rental_lines WHERE rental_id = p_rental LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.act_as(uuid), pg_temp.as_postgres(), pg_temp.ist(integer, text), pg_temp.book(integer, text),
  pg_temp.fee(uuid, interval), pg_temp.note(uuid, interval), pg_temp.rate(uuid) TO authenticated;
CREATE TEMP TABLE t_ids (name text PRIMARY KEY, id uuid);
GRANT ALL ON t_ids TO authenticated;

-- ===== 1. defaults are the rule from before =====
SELECT pg_temp.act_as(:bridal_staff);
INSERT INTO t_ids VALUES ('old', pg_temp.book(30, 'QA late old'));
INSERT INTO t_ids VALUES ('new', pg_temp.book(40, 'QA late new'));
SELECT pg_temp.as_postgres();
UPDATE rentals SET late_terms = NULL WHERE id = (SELECT id FROM t_ids WHERE name = 'old');   -- a booking made before 037
SELECT pg_temp.act_as(:bridal_staff);

SELECT is((SELECT late_terms ->> 'mode' FROM rentals WHERE id = (SELECT id FROM t_ids WHERE name = 'new')), 'percent',
  'a new booking keeps a copy of the late rules');
SELECT is((SELECT (late_terms ->> 'percent')::numeric FROM rentals WHERE id = (SELECT id FROM t_ids WHERE name = 'new')), 100::numeric,
  'with the default of 100% of the day rate');
SELECT is(pg_temp.fee((SELECT id FROM t_ids WHERE name = 'old'), interval '2 days'), 2 * pg_temp.rate((SELECT id FROM t_ids WHERE name = 'old')),
  'a booking without late rules keeps the old formula (rate x days late)');
SELECT like(pg_temp.note((SELECT id FROM t_ids WHERE name = 'old'), interval '2 days'), '2 day(s) late - %', 'and its old wording');
SELECT is(pg_temp.fee((SELECT id FROM t_ids WHERE name = 'new'), interval '2 days'), 2 * pg_temp.rate((SELECT id FROM t_ids WHERE name = 'new')),
  'the default rules charge exactly what the old formula charged');
SELECT like(pg_temp.note((SELECT id FROM t_ids WHERE name = 'new'), interval '2 days'), '2 days late x ₹%', 'and show the working');
SELECT is(pg_temp.fee((SELECT id FROM t_ids WHERE name = 'new'), interval '5 hours'), 0::numeric, 'back the same day: no late fee');
SELECT is(pg_temp.fee((SELECT id FROM t_ids WHERE name = 'new'), interval '-1 hour'), 0::numeric, 'back early: no late fee');
SELECT is(pg_temp.fee((SELECT id FROM t_ids WHERE name = 'new'), interval '2 days'),
          pg_temp.fee((SELECT id FROM t_ids WHERE name = 'new'), interval '2 days'), 'the same return suggested twice gives the same amount');

-- ===== 2. the owner's rules =====
SELECT throws_like($$ SELECT public.update_my_shop('{"settings": {"late_fee_percent": 200}}') $$, '%', 'staff cannot change the late rules');
SELECT pg_temp.act_as(:bridal_owner);
SELECT throws_like($$ SELECT public.update_my_shop('{"settings": {"late_fee_percent": 400}}') $$, '%0 to 300%', 'a percentage above 300 is refused');
SELECT throws_like($$ SELECT public.update_my_shop('{"settings": {"late_fee_mode": "hourly"}}') $$, '%percentage of the daily price or a fixed%', 'an unknown mode is refused');
SELECT throws_like($$ SELECT public.update_my_shop('{"settings": {"late_cutoff_time": "25:00"}}') $$, '%time like 20:00%', 'a wrong time is refused');
SELECT throws_like($$ SELECT public.update_my_shop('{"settings": {"late_fee_fixed": -5}}') $$, '%fixed late fee%', 'a negative fixed fee is refused');
SELECT throws_like($$ SELECT public.update_my_shop('{"settings": {"late_fee_on": "yes"}}') $$, '%on or off%', 'on/off must be true or false');
SELECT lives_ok($$ SELECT public.update_my_shop('{"settings": {"late_fee_percent": 200, "late_fee_basis": "agreed"}}') $$, 'double fare on the agreed price is saved');
SELECT pg_temp.as_postgres();
SELECT is((SELECT count(*) FROM activity_log WHERE area = 'settings' AND changes::text ILIKE '%late fee percent%'), 1::bigint,
  'the change is in the activity log');

SELECT pg_temp.act_as(:bridal_staff);
SELECT is(pg_temp.fee((SELECT id FROM t_ids WHERE name = 'new'), interval '2 days'), 2 * pg_temp.rate((SELECT id FROM t_ids WHERE name = 'new')),
  'a booking made before the change is not repriced');
INSERT INTO t_ids VALUES ('double', pg_temp.book(50, 'QA late double'));
SELECT pg_temp.as_postgres();
UPDATE rental_lines SET amount = 900, is_override = true WHERE rental_id = (SELECT id FROM t_ids WHERE name = 'double');   -- a negotiated 300 a day
SELECT pg_temp.act_as(:bridal_staff);
SELECT is(pg_temp.fee((SELECT id FROM t_ids WHERE name = 'double'), interval '2 days'), 1200::numeric,
  '200% of the agreed 300 a day, 2 days late = 1,200');

SELECT pg_temp.act_as(:bridal_owner);
SELECT lives_ok($$ SELECT public.update_my_shop('{"settings": {"late_fee_mode": "fixed", "late_fee_fixed": 250, "late_cap": "rent_percent", "late_cap_percent": 50}}') $$,
  'a fixed fee with a cap is saved');
SELECT pg_temp.act_as(:bridal_staff);
INSERT INTO t_ids VALUES ('fixed', pg_temp.book(60, 'QA late fixed'));
SELECT pg_temp.as_postgres();
UPDATE rental_lines SET amount = 1000, is_override = true WHERE rental_id = (SELECT id FROM t_ids WHERE name = 'fixed');
SELECT pg_temp.act_as(:bridal_staff);
SELECT is(pg_temp.fee((SELECT id FROM t_ids WHERE name = 'fixed'), interval '1 day'), 250::numeric, 'fixed 250 per piece per day');
SELECT is(pg_temp.fee((SELECT id FROM t_ids WHERE name = 'fixed'), interval '4 days'), 500::numeric, 'never more than the cap (50% of 1,000)');

SELECT pg_temp.act_as(:bridal_owner);
SELECT lives_ok($$ SELECT public.update_my_shop('{"settings": {"late_cap": "none", "late_cutoff_time": "20:00"}}') $$, 'a latest return time is saved');
SELECT pg_temp.act_as(:bridal_staff);
INSERT INTO t_ids VALUES ('cutoff', pg_temp.book(70, 'QA late cutoff'));
SELECT is(pg_temp.fee((SELECT id FROM t_ids WHERE name = 'cutoff'), interval '11 hours'), 250::numeric,
  'back at 21:00 on the return day counts that day');
SELECT is(pg_temp.fee((SELECT id FROM t_ids WHERE name = 'cutoff'), interval '9 hours'), 0::numeric, 'back at 19:00 is free');

SELECT pg_temp.act_as(:bridal_owner);
SELECT lives_ok($$ SELECT public.update_my_shop('{"settings": {"late_cutoff_time": "", "late_day_count": "blocks"}}') $$, '24-hour blocks are saved');
SELECT pg_temp.act_as(:bridal_staff);
INSERT INTO t_ids VALUES ('blocks', pg_temp.book(80, 'QA late blocks'));
SELECT is(pg_temp.fee((SELECT id FROM t_ids WHERE name = 'blocks'), interval '25 hours'), 500::numeric, '25 hours late = 2 started blocks');

SELECT pg_temp.act_as(:bridal_owner);
SELECT lives_ok($$ SELECT public.update_my_shop('{"settings": {"late_fee_on": false}}') $$, 'late fees can be switched off');
SELECT pg_temp.act_as(:bridal_staff);
INSERT INTO t_ids VALUES ('off', pg_temp.book(90, 'QA late off'));
SELECT is(pg_temp.fee((SELECT id FROM t_ids WHERE name = 'off'), interval '3 days'), 0::numeric, 'then no late fee is suggested');

-- ===== 3. a product's own late fee =====
SELECT throws_like(format($f$ SELECT public.set_product_late_fee(%L, 75) $f$, (SELECT product_id FROM product_variations WHERE id = :gold_saree)),
  '%', 'staff cannot set a product''s late fee');
SELECT pg_temp.act_as(:bridal_owner);
SELECT lives_ok(format($f$ SELECT public.set_product_late_fee(%L, 75) $f$, (SELECT product_id FROM product_variations WHERE id = :gold_saree)),
  'the owner sets it');
SELECT is(pg_temp.fee((SELECT id FROM t_ids WHERE name = 'blocks'), interval '25 hours'), 150::numeric, 'and it replaces the shop''s rule');

-- ===== 4. holding a hand over, and pieces kept late =====
SELECT pg_temp.act_as(:bridal_staff);
SELECT lives_ok(format($f$ SELECT public.set_handover_hold(%L, 'Saree still with the last customer') $f$, (SELECT id FROM t_ids WHERE name = 'new')),
  'staff hold a hand over with a note');
SELECT throws_like(format($f$ SELECT public.start_rental(%L, '{}') $f$, (SELECT id FROM t_ids WHERE name = 'new')),
  '%on hold%', 'a held booking cannot be handed over');
-- (the log entry itself cannot be checked here: this whole file is one transaction, and the activity log folds a hold into
-- the "new booking" entry made in the same transaction; checked on the cloud project in separate saves instead)
SELECT is((SELECT handover_hold_note FROM rentals WHERE id = (SELECT id FROM t_ids WHERE name = 'new')), 'Saree still with the last customer',
  'the note is kept on the booking');
SELECT lives_ok(format($f$ SELECT public.set_handover_hold(%L, '') $f$, (SELECT id FROM t_ids WHERE name = 'new')), 'the hold is removed');

SELECT * FROM finish();
ROLLBACK;
