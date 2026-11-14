-- Finance reports (migration 043): expense payment method, opening cash, daily cashbook, pending bills, product performance.
-- Run: npx supabase db reset && npx supabase test db   (uses the seeded demo shops; everything is rolled back)
-- Seeded shops already hold payments, so cashbook checks compare before and after, on days long before the seed.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(25);

\set bridal_owner '''aaaaaaaa-0000-0000-0000-000000000011'''
\set bridal_manager '''aaaaaaaa-0000-0000-0000-000000000012'''
\set bridal_staff '''aaaaaaaa-0000-0000-0000-000000000013'''
\set mg_road '''b0000000-0000-0000-0000-000000000001'''
\set thrissur '''b0000000-0000-0000-0000-000000000002'''

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
-- day d, days from today, at noon in the shop's time zone
CREATE FUNCTION pg_temp.ist(p_days integer, p_time text) RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$
  SELECT ((CURRENT_DATE + p_days) + p_time::time) AT TIME ZONE 'Asia/Kolkata';
$$;
CREATE FUNCTION pg_temp.day(p_days integer) RETURNS date LANGUAGE sql IMMUTABLE AS $$ SELECT CURRENT_DATE + p_days; $$;
-- the cash balance at the start of a day, for MG Road
CREATE FUNCTION pg_temp.cash_at(p_days integer) RETURNS numeric LANGUAGE sql AS $$
  SELECT (public.finance_cashbook(CURRENT_DATE + p_days, CURRENT_DATE + p_days, 'b0000000-0000-0000-0000-000000000001')
          -> 'opening' ->> 'cash')::numeric;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.act_as(uuid), pg_temp.as_postgres(), pg_temp.ist(integer, text), pg_temp.day(integer),
  pg_temp.cash_at(integer) TO authenticated;
CREATE TEMP TABLE t_n (name text PRIMARY KEY, n numeric);
GRANT ALL ON t_n TO authenticated;

-- a booking at MG Road to take money on
SELECT pg_temp.act_as(:bridal_staff);
SELECT lives_ok($$ SELECT public.create_rental(jsonb_build_object(
    'branch_id', 'b0000000-0000-0000-0000-000000000001', 'start_at', pg_temp.ist(60, '10:00'), 'end_at', pg_temp.ist(61, '10:00'),
    'lines', '[{"variation_id": "e0000000-0000-0000-0000-000000000012", "qty": 1}]'::jsonb,
    'customer', '{"full_name": "QA Finance", "phone": "9000000098"}'::jsonb)) $$,
  'a booking to record money on');
SELECT throws_like($$ SELECT public.finance_cashbook(CURRENT_DATE, CURRENT_DATE) $$, 'Your role (staff) cannot do this',
  'counter staff do not see the cashbook');
SELECT throws_like($$ SELECT * FROM public.pending_bills() $$, 'Your role (staff) cannot do this', 'nor the pending bills');

-- money on day -500 and -499, recorded as it would have been then
SELECT pg_temp.act_as(:bridal_owner);
INSERT INTO t_n VALUES ('before', pg_temp.cash_at(-500)), ('after', pg_temp.cash_at(-497)),
  ('upi', (public.finance_cashbook(pg_temp.day(-497), pg_temp.day(-497), :mg_road) -> 'opening' ->> 'upi')::numeric);
SELECT pg_temp.as_postgres();
INSERT INTO payments (shop_id, rental_id, kind, amount, method, paid_at)
SELECT r.shop_id, r.id, k.kind, k.amount, k.method, pg_temp.ist(k.d, '12:00')
FROM rentals r JOIN customers c ON c.id = r.customer_id,
  (VALUES ('payment', 100, 'cash', -500), ('deposit', 500, 'cash', -500), ('payment', 40, 'upi', -500),
          ('refund', 20, 'upi', -499), ('deposit_refund', 500, 'cash', -499)) AS k(kind, amount, method, d)
WHERE c.phone = '9000000098';
SELECT pg_temp.act_as(:bridal_owner);
SELECT lives_ok(format($f$ SELECT public.add_expense(jsonb_build_object('branch_id', %L, 'spent_on', %L, 'category', 'Dry-cleaning',
    'amount', 300, 'method', 'cash', 'paid_to', 'QA Cleaners')) $f$, :mg_road, pg_temp.day(-500)), 'an expense paid in cash to a cleaner');
SELECT lives_ok(format($f$ SELECT public.add_expense(jsonb_build_object('branch_id', %L, 'spent_on', %L, 'category', 'Rent', 'amount', 50)) $f$,
    :mg_road, pg_temp.day(-499)), 'an expense saved without a method');
SELECT is((SELECT method FROM expenses WHERE category = 'Rent' AND spent_on = pg_temp.day(-499)), 'cash', 'is counted as cash');
SELECT throws_like(format($f$ SELECT public.add_expense(jsonb_build_object('branch_id', %L, 'spent_on', %L, 'category', 'Rent',
    'amount', 50, 'method', 'cheque')) $f$, :mg_road, pg_temp.day(-499)), 'Choose how it was paid', 'an unknown method is refused');

-- the day's lines and the balances
SELECT is((SELECT (x ->> 'rent_in')::numeric + (x ->> 'deposit_in')::numeric - (x ->> 'expense_out')::numeric
           FROM jsonb_array_elements(public.finance_cashbook(pg_temp.day(-500), pg_temp.day(-499), :mg_road) -> 'days') x
           WHERE x ->> 'method' = 'cash' AND (x ->> 'day')::date = pg_temp.day(-500)), 300::numeric,
  'cash on the first day: 100 rent + 500 deposit - 300 expense');
SELECT is((SELECT sum((x ->> 'refund_out')::numeric) FROM jsonb_array_elements(public.finance_cashbook(pg_temp.day(-500), pg_temp.day(-499), :mg_road) -> 'days') x
           WHERE x ->> 'method' = 'upi'), 20::numeric, 'the UPI refund is on the UPI line');
SELECT is(pg_temp.cash_at(-497) - (SELECT n FROM t_n WHERE name = 'after'), 300 - 500 - 50::numeric,
  'the cash balance moves by exactly the cash in and out (deposit given back, rent expense)');
SELECT is((public.finance_cashbook(pg_temp.day(-497), pg_temp.day(-497), :mg_road) -> 'opening' ->> 'upi')::numeric
          - (SELECT n FROM t_n WHERE name = 'upi'), 20::numeric, 'the UPI balance is 40 in, 20 refunded');
SELECT is(pg_temp.cash_at(-500), (SELECT n FROM t_n WHERE name = 'before'), 'nothing changes before the first day');
SELECT is((public.finance_cashbook(pg_temp.day(-500), pg_temp.day(-499), :thrissur) -> 'days'), '[]'::jsonb,
  'another branch sees none of it');

-- the drawer counted on day -499: from then the cash starts at the count
SELECT pg_temp.act_as(:bridal_manager);
SELECT throws_like(format($f$ SELECT public.set_opening_cash(%L, 5000, %L) $f$, :mg_road, pg_temp.day(-499)),
  'Your role (manager) cannot do this', 'a manager cannot set the opening cash');
SELECT pg_temp.act_as(:bridal_owner);
SELECT throws_like(format($f$ SELECT public.set_opening_cash(%L, 5000, %L) $f$, :mg_road, pg_temp.day(5)),
  'Choose the day it was counted%', 'not a day in the future');
SELECT lives_ok(format($f$ SELECT public.set_opening_cash(%L, 5000, %L) $f$, :mg_road, pg_temp.day(-499)), 'the owner sets it');
SELECT is(pg_temp.cash_at(-499), 5000::numeric, 'the count is the cash at the start of that day');
SELECT is(pg_temp.cash_at(-497), 5000 - 500 - 50::numeric, 'later days start from the count');
SELECT is((SELECT (x ->> 'amount')::numeric - (x ->> 'book')::numeric + (public.finance_cashbook(pg_temp.day(-500), pg_temp.day(-500), :mg_road) -> 'opening' ->> 'cash')::numeric + 300
           FROM jsonb_array_elements(public.finance_cashbook(pg_temp.day(-500), pg_temp.day(-497), :mg_road) -> 'cash_counts') x),
  5000::numeric, 'a count inside the dates is given with what the book said, so the page can restart the cash there');

-- pending bills: what is owed equals the bill less what was paid
SELECT is((SELECT pending FROM public.pending_bills() WHERE customer_name = 'QA Finance'),
          (SELECT total - paid FROM rentals r JOIN customers c ON c.id = r.customer_id WHERE c.phone = '9000000098'),
  'the pending amount is the bill less what was paid');
SELECT is((SELECT count(*) FROM public.pending_bills() WHERE pending <= 0), 0::bigint, 'a paid bill is never listed');
SELECT pg_temp.act_as(:bridal_manager);
SELECT is((SELECT count(*) FROM public.pending_bills(NULL, NULL, :thrissur) WHERE branch_id <> :mg_road), 0::bigint,
  'a manager sees only their own branch, whatever they ask for');

-- product performance adds up to the booking lines
SELECT pg_temp.act_as(:bridal_owner);
SELECT is((SELECT COALESCE(sum(rent), 0) FROM public.product_performance()),
          (SELECT COALESCE(sum(l.amount), 0) FROM rental_lines l JOIN rentals r ON r.id = l.rental_id
           WHERE r.status IN ('active', 'completed')), 'the rent of all products equals the lines that went out');

-- the activity log
SELECT pg_temp.as_postgres();
SELECT ok(EXISTS (SELECT 1 FROM activity_log WHERE action = 'expense_added' AND summary LIKE '%paid to QA Cleaners%'
                  AND changes ? 'Paid by'), 'an expense is logged with who was paid and how');
SELECT ok(EXISTS (SELECT 1 FROM activity_log WHERE action = 'opening_cash_set' AND area = 'money' AND important),
  'setting the opening cash is an important money entry');

SELECT * FROM finish();
ROLLBACK;
