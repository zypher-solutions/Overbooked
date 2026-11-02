-- Launch rules: a piece kept late is not offered again, the deposit goes back at return, backdated returns need a
-- manager, a new shop has a trial, price changes are logged, settings and unblocking are guarded.
-- Run: npx supabase db reset && npx supabase test db   (uses the seeded demo shops; everything is rolled back)
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(30);

\set zypher '''aaaaaaaa-0000-0000-0000-000000000001'''
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
CREATE FUNCTION pg_temp.ist(p_days integer, p_time text) RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$
  SELECT ((CURRENT_DATE + p_days) + p_time::time) AT TIME ZONE 'Asia/Kolkata';
$$;
GRANT EXECUTE ON FUNCTION pg_temp.act_as(uuid), pg_temp.as_postgres(), pg_temp.ist(integer, text) TO authenticated;
CREATE TEMP TABLE t_ids (name text PRIMARY KEY, id uuid);
GRANT ALL ON t_ids TO authenticated;

-- ===== 1. a piece still out past its return date =====
SELECT pg_temp.act_as(:bridal_staff);
SELECT lives_ok($$ SELECT public.create_rental(jsonb_build_object(
    'branch_id', 'b0000000-0000-0000-0000-000000000001', 'start_at', pg_temp.ist(0, '10:00'), 'end_at', pg_temp.ist(1, '10:00'),
    'notes', 'QA late', 'deposit', '{"amount": 1000, "method": "cash"}'::jsonb,
    'lines', '[{"variation_id": "e0000000-0000-0000-0000-000000000012", "qty": 1}]'::jsonb,
    'customer', '{"full_name": "QA Late", "phone": "9000000088"}'::jsonb)) $$, 'a booking with a deposit');
INSERT INTO t_ids SELECT 'late', id FROM rentals WHERE notes = 'QA late';
INSERT INTO t_ids SELECT 'late_unit', unit_id FROM unit_reservations WHERE rental_id = (SELECT id FROM t_ids WHERE name = 'late');
SELECT lives_ok(format($f$ SELECT public.start_rental(%L, '{}') $f$, (SELECT id FROM t_ids WHERE name = 'late')), 'handed over');

SELECT pg_temp.as_postgres();
UPDATE rentals SET start_at = now() - interval '2 days', end_at = now() - interval '1 hour', actual_start_at = now() - interval '2 days'
WHERE id = (SELECT id FROM t_ids WHERE name = 'late');

SELECT pg_temp.act_as(:bridal_staff);
SELECT is(public._unit_kept_late((SELECT id FROM t_ids WHERE name = 'late_unit')), true, 'the piece is kept late');
SELECT is((SELECT free FROM public.branch_availability(:mg_road, pg_temp.ist(60, '10:00'), pg_temp.ist(61, '10:00'))
           WHERE variation_id = :gold_saree), 1, 'the free count leaves out the piece that is still out');
SELECT is((SELECT count(*) FROM public.find_available_units(:mg_road, :gold_saree, pg_temp.ist(60, '10:00'), pg_temp.ist(61, '10:00'))),
  1::bigint, 'the piece picker leaves it out too');
SELECT throws_like(format($f$ SELECT public.create_rental(jsonb_build_object(
    'branch_id', 'b0000000-0000-0000-0000-000000000001', 'start_at', pg_temp.ist(60, '10:00'), 'end_at', pg_temp.ist(61, '10:00'),
    'lines', jsonb_build_array(jsonb_build_object('variation_id', 'e0000000-0000-0000-0000-000000000012', 'qty', 1,
                                                  'unit_ids', jsonb_build_array(%L))),
    'customer', '{"full_name": "QA Late", "phone": "9000000088"}'::jsonb)) $f$, (SELECT id FROM t_ids WHERE name = 'late_unit')),
  '%still out with another customer%', 'choosing that piece by hand is refused');

-- ===== 2. the deposit goes back at return, not earlier, unless the owner says so =====
SELECT throws_like(format($f$ SELECT public.record_rental_payment(%L, 'deposit_refund', 500, 'cash') $f$, (SELECT id FROM t_ids WHERE name = 'late')),
  'The deposit is given back when the rental is returned%', 'counter staff cannot hand the deposit back while the piece is out');
SELECT pg_temp.act_as(:bridal_owner);
SELECT lives_ok(format($f$ SELECT public.record_rental_payment(%L, 'deposit_refund', 100, 'cash') $f$, (SELECT id FROM t_ids WHERE name = 'late')),
  'the owner can');

-- ===== 3. a return time long ago =====
SELECT pg_temp.act_as(:bridal_staff);
SELECT throws_like(format($f$ SELECT public.complete_rental(%L, jsonb_build_object('returned_at', now() - interval '5 hours',
    'checks', jsonb_build_array(jsonb_build_object('unit_id', %L, 'condition', 'good')))) $f$,
    (SELECT id FROM t_ids WHERE name = 'late'), (SELECT id FROM t_ids WHERE name = 'late_unit')),
  'A return time more than 2 hours ago needs a manager%', 'counter staff cannot backdate a return');
SELECT pg_temp.act_as(:bridal_manager);
SELECT lives_ok(format($f$ SELECT public.complete_rental(%L, jsonb_build_object('returned_at', now() - interval '5 hours',
    'checks', jsonb_build_array(jsonb_build_object('unit_id', %L, 'condition', 'good')))) $f$,
    (SELECT id FROM t_ids WHERE name = 'late'), (SELECT id FROM t_ids WHERE name = 'late_unit')),
  'a manager can');
SELECT pg_temp.as_postgres();
SELECT is((SELECT count(*) FROM audit_log WHERE record_id = (SELECT id FROM t_ids WHERE name = 'late')
           AND reason = 'Return recorded for an earlier time'), 1::bigint, 'and it is written to the audit log');
SELECT is(public._unit_kept_late((SELECT id FROM t_ids WHERE name = 'late_unit')), false, 'after the return the piece is free again');
SELECT is((SELECT status FROM rentals WHERE id = (SELECT id FROM t_ids WHERE name = 'late')), 'completed', 'the rental is completed');

-- ===== 4. price changes are logged =====
SELECT pg_temp.act_as(:bridal_staff);
SELECT lives_ok($$ SELECT public.create_rental(jsonb_build_object(
    'branch_id', 'b0000000-0000-0000-0000-000000000001', 'start_at', pg_temp.ist(70, '10:00'), 'end_at', pg_temp.ist(71, '10:00'),
    'notes', 'QA price', 'discount', 1,
    'lines', '[{"variation_id": "e0000000-0000-0000-0000-000000000012", "qty": 1, "amount_override": 777}]'::jsonb,
    'customer', '{"full_name": "QA Price", "phone": "9000000077"}'::jsonb)) $$, 'a booking with a discount and an agreed price');
INSERT INTO t_ids SELECT 'price', id FROM rentals WHERE notes = 'QA price';
SELECT is((SELECT count(*) FROM price_changes), 0::bigint, 'counter staff cannot read the price log');
SELECT pg_temp.act_as(:bridal_owner);
SELECT is((SELECT amount FROM price_changes WHERE rental_id = (SELECT id FROM t_ids WHERE name = 'price') AND kind = 'discount'),
  1.00::numeric, 'the owner sees the discount');
SELECT is((SELECT amount FROM price_changes WHERE rental_id = (SELECT id FROM t_ids WHERE name = 'price') AND kind = 'agreed_price'),
  777.00::numeric, 'and the agreed price');
SELECT is((SELECT created_by FROM price_changes WHERE rental_id = (SELECT id FROM t_ids WHERE name = 'price') AND kind = 'discount'),
  'aaaaaaaa-0000-0000-0000-000000000013'::uuid, 'with the person who gave it');

-- ===== 5. settings, unblocking =====
SELECT throws_like($$ SELECT public.update_my_shop('{"settings": {"monthly_fee": 1}}') $$, 'Unknown setting: monthly_fee', 'an owner cannot save a made-up setting');
SELECT lives_ok($$ SELECT public.update_my_shop('{"settings": {"grace_minutes": 20, "features": {"sets": false}}}') $$, 'known settings are saved');
SELECT pg_temp.act_as(:bridal_staff);
SELECT pg_temp.as_postgres();
UPDATE customers SET is_blocked = true, blocked_reason = 'QA' WHERE phone = '9000000088';
SELECT pg_temp.act_as(:bridal_staff);
SELECT throws_like($$ UPDATE customers SET is_blocked = false WHERE phone = '9000000088' $$,
  'Only a manager or the owner can unblock a customer', 'counter staff cannot unblock a customer');
SELECT pg_temp.act_as(:bridal_manager);
SELECT lives_ok($$ UPDATE customers SET is_blocked = false WHERE phone = '9000000088' $$, 'a manager can');

-- ===== 5b. Finance loads only the rentals where money is still open =====
SELECT pg_temp.act_as(:bridal_owner);
SELECT is((SELECT count(*) FROM public.finance_open_money() WHERE id = (SELECT id FROM t_ids WHERE name = 'late')), 1::bigint,
  'a returned rental whose deposit is still held is listed');
SELECT is((SELECT count(*) FROM public.finance_open_money() WHERE id = (SELECT id FROM t_ids WHERE name = 'price')), 0::bigint,
  'a booking not picked up is not');
SELECT is((SELECT sum(deposit_received - deposit_refunded - deposit_applied) FROM public.finance_open_money()),
  (SELECT sum(deposit_received - deposit_refunded - deposit_applied) FROM rentals WHERE status IN ('active', 'completed', 'cancelled', 'no_show')),
  'the deposits held add up to the same as summing every rental');

-- ===== 6. trial =====
SELECT pg_temp.act_as(:zypher);
SELECT lives_ok($$ SELECT public.create_shop('{"name": "Trial Boutique", "slug": "trial-boutique", "token_prefix": "TRB",
    "business_types": ["clothing"], "branch_name": "Main", "monthly_fee": 499}') $$, 'Zypher creates a shop');
SELECT pg_temp.as_postgres();
SELECT is((SELECT trial_ends FROM shops WHERE slug = 'trial-boutique'), (now() AT TIME ZONE 'Asia/Kolkata')::date + 14, 'it has a 14 day trial');
SELECT is(public.pause_overdue_shops(), 0, 'a shop in its trial is not paused for a missing payment');

SELECT pg_temp.act_as(:zypher);
SELECT is((SELECT trial_ends FROM platform_overview() WHERE slug = 'trial-boutique'), (now() AT TIME ZONE 'Asia/Kolkata')::date + 14, 'the console shows the trial end');
SELECT cmp_ok((public.console_summary() ->> 'in_trial')::integer, '>=', 1, 'and counts the shop as in trial, not overdue');

SELECT * FROM finish();
ROLLBACK;
