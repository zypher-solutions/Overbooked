-- Cleaning & repairs (migration 041): one open job per piece, a time-boxed hold on new bookings, jobs made by a return,
-- finishing with a cost (expense) or as cannot be repaired (retired), and the hand over refused while a piece is away.
-- Run: npx supabase db reset && npx supabase test db   (uses the seeded demo shops; everything is rolled back)
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(17);

\set bridal_owner '''aaaaaaaa-0000-0000-0000-000000000011'''
\set bridal_manager '''aaaaaaaa-0000-0000-0000-000000000012'''
\set bridal_staff '''aaaaaaaa-0000-0000-0000-000000000013'''
\set mg_road '''b0000000-0000-0000-0000-000000000001'''
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
CREATE FUNCTION pg_temp.day(p_days integer) RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$
  SELECT ((CURRENT_DATE + p_days) + time '10:00') AT TIME ZONE 'Asia/Kolkata';
$$;
GRANT EXECUTE ON FUNCTION pg_temp.act_as(uuid), pg_temp.as_postgres(), pg_temp.day(integer) TO authenticated;
CREATE TEMP TABLE t_ids (name text PRIMARY KEY, id uuid);
GRANT ALL ON t_ids TO authenticated;

-- ===== a repair job holds the piece until its due date =====
SELECT pg_temp.act_as(:bridal_staff);
INSERT INTO t_ids SELECT 'piece', unit_id FROM public.find_available_units(:mg_road, :gold_saree, pg_temp.day(1), pg_temp.day(2), 0) LIMIT 1;
SELECT lives_ok(format($f$ SELECT public.create_service_job(%L, 'repair', 'Torn hem', CURRENT_DATE + 5) $f$, (SELECT id FROM t_ids WHERE name = 'piece')),
  'staff add a repair job');
INSERT INTO t_ids SELECT 'job', id FROM service_jobs WHERE unit_id = (SELECT id FROM t_ids WHERE name = 'piece') AND status = 'todo';
SELECT throws_like(format($f$ SELECT public.create_service_job(%L, 'cleaning', 'x', CURRENT_DATE + 1) $f$, (SELECT id FROM t_ids WHERE name = 'piece')),
  '%already has an open job%', 'one open job per piece');
SELECT ok((SELECT id FROM t_ids WHERE name = 'piece') NOT IN (SELECT unit_id FROM public.find_available_units(:mg_road, :gold_saree, pg_temp.day(2), pg_temp.day(3), 0)),
  'the piece is not offered for dates before its due date');
SELECT ok((SELECT id FROM t_ids WHERE name = 'piece') IN (SELECT unit_id FROM public.find_available_units(:mg_road, :gold_saree, pg_temp.day(20), pg_temp.day(21), 0)),
  'but it is offered after (not blocked for every future date)');
SELECT throws_like(format($f$ SELECT public.create_rental(jsonb_build_object('branch_id', %L, 'start_at', pg_temp.day(2), 'end_at', pg_temp.day(3),
    'lines', jsonb_build_array(jsonb_build_object('variation_id', %L, 'qty', 1, 'unit_ids', jsonb_build_array(%L))),
    'customer', '{"full_name": "QA Service", "phone": "9000000041"}'::jsonb)) $f$, :mg_road, :gold_saree, (SELECT id FROM t_ids WHERE name = 'piece')),
  '%away for cleaning or repair%', 'choosing it by hand for those dates is refused');

-- ===== moving the job =====
SELECT lives_ok(format($f$ SELECT public.update_service_job(%L, 'send', '{"vendor": "Sharma Tailors"}') $f$, (SELECT id FROM t_ids WHERE name = 'job')), 'sent out');
SELECT lives_ok(format($f$ SELECT public.update_service_job(%L, 'back') $f$, (SELECT id FROM t_ids WHERE name = 'job')), 'marked back');
SELECT throws_like(format($f$ SELECT public.update_service_job(%L, 'done', '{"cost": 250}') $f$, (SELECT id FROM t_ids WHERE name = 'job')),
  '%needs a manager or the owner%', 'staff cannot enter a cost');
SELECT pg_temp.act_as(:bridal_manager);
SELECT lives_ok(format($f$ SELECT public.update_service_job(%L, 'done', '{"cost": 250}') $f$, (SELECT id FROM t_ids WHERE name = 'job')), 'a manager finishes it with the cost');
SELECT pg_temp.as_postgres();
SELECT is((SELECT category || ' ' || amount FROM expenses WHERE id = (SELECT expense_id FROM service_jobs WHERE id = (SELECT id FROM t_ids WHERE name = 'job'))),
  'Repairs 250.00', 'the cost is an expense');
SELECT ok((SELECT id FROM t_ids WHERE name = 'piece') IN (SELECT unit_id FROM public.available_units(:mg_road, :gold_saree, pg_temp.day(2), pg_temp.day(3), 0)),
  'a finished job holds nothing');
SELECT is((SELECT count(*) FROM activity_log WHERE area = 'service' AND record_id = (SELECT id FROM t_ids WHERE name = 'job')), 1::bigint,
  'the job is one entry in the activity log (made, sent, back and done in one transaction here)');

-- ===== cannot be repaired =====
SELECT pg_temp.act_as(:bridal_owner);
SELECT lives_ok(format($f$ SELECT public.create_service_job(%L, 'repair', 'Burnt', CURRENT_DATE + 2) $f$, (SELECT id FROM t_ids WHERE name = 'piece')), 'a second repair');
SELECT lives_ok(format($f$ SELECT public.update_service_job((SELECT id FROM service_jobs WHERE unit_id = %L AND status = 'todo'), 'done', '{"outcome": "unrepairable"}') $f$,
  (SELECT id FROM t_ids WHERE name = 'piece')), 'cannot be repaired');
SELECT is((SELECT status FROM units WHERE id = (SELECT id FROM t_ids WHERE name = 'piece')), 'retired', 'the piece is retired');

-- ===== jobs made by a return, and the hand over =====
SELECT pg_temp.act_as(:bridal_staff);
SELECT public.create_rental(jsonb_build_object('branch_id', :mg_road, 'start_at', now() - interval '1 hour', 'end_at', now() + interval '1 day',
  'notes', 'QA service ret', 'lines', jsonb_build_array(jsonb_build_object('variation_id', :gold_saree, 'qty', 1)),
  'customer', '{"full_name": "QA Service", "phone": "9000000041"}'::jsonb));
INSERT INTO t_ids SELECT 'ret', id FROM rentals WHERE notes = 'QA service ret';
INSERT INTO t_ids SELECT 'ret_unit', unit_id FROM unit_reservations WHERE rental_id = (SELECT id FROM t_ids WHERE name = 'ret');
SELECT public.create_service_job((SELECT id FROM t_ids WHERE name = 'ret_unit'), 'alteration', 'Take in waist', CURRENT_DATE + 1, NULL, (SELECT id FROM t_ids WHERE name = 'ret'));
SELECT throws_like(format($f$ SELECT public.start_rental(%L, '{}') $f$, (SELECT id FROM t_ids WHERE name = 'ret')),
  '%away for cleaning or repair%', 'a piece away for alteration cannot be handed over');
SELECT pg_temp.as_postgres();
UPDATE service_jobs SET status = 'done', done_on = CURRENT_DATE WHERE unit_id = (SELECT id FROM t_ids WHERE name = 'ret_unit') AND status = 'todo';
SELECT pg_temp.act_as(:bridal_staff);
SELECT public.start_rental((SELECT id FROM t_ids WHERE name = 'ret'), '{}');
SELECT public.complete_rental((SELECT id FROM t_ids WHERE name = 'ret'),
  jsonb_build_object('checks', jsonb_build_array(jsonb_build_object('unit_id', (SELECT id FROM t_ids WHERE name = 'ret_unit'), 'condition', 'good'))));
SELECT is((SELECT type FROM service_jobs WHERE unit_id = (SELECT id FROM t_ids WHERE name = 'ret_unit') AND status = 'todo'), 'cleaning',
  'the return adds a cleaning job');

SELECT * FROM finish();
ROLLBACK;
