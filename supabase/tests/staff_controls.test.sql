-- Staff controls and voids (migration 039): defaults keep today's behaviour; the owner's rules are enforced in the database;
-- a voided payment stays but counts nowhere.
-- Run: npx supabase db reset && npx supabase test db   (uses the seeded demo shops; everything is rolled back)
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(20);

\set bridal_owner '''aaaaaaaa-0000-0000-0000-000000000011'''
\set bridal_manager '''aaaaaaaa-0000-0000-0000-000000000012'''
\set bridal_staff '''aaaaaaaa-0000-0000-0000-000000000013'''

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
-- a booking at MG Road with an advance paid in cash; returns its id
CREATE FUNCTION pg_temp.book(p_day integer, p_note text, p_discount numeric DEFAULT 0) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.create_rental(jsonb_build_object(
    'branch_id', 'b0000000-0000-0000-0000-000000000001',
    'start_at', ((CURRENT_DATE + p_day) + time '10:00') AT TIME ZONE 'Asia/Kolkata',
    'end_at', ((CURRENT_DATE + p_day + 2) + time '10:00') AT TIME ZONE 'Asia/Kolkata',
    'notes', p_note, 'discount', p_discount, 'advance', '{"amount": 100, "method": "cash"}'::jsonb,
    'lines', '[{"variation_id": "e0000000-0000-0000-0000-000000000012", "qty": 1}]'::jsonb,
    'customer', '{"full_name": "QA Controls", "phone": "9000000039"}'::jsonb));
  RETURN (SELECT id FROM public.rentals WHERE notes = p_note);
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.act_as(uuid), pg_temp.as_postgres(), pg_temp.book(integer, text, numeric) TO authenticated;
CREATE TEMP TABLE t_ids (name text PRIMARY KEY, id uuid);
GRANT ALL ON t_ids TO authenticated;

-- ===== settings =====
SELECT pg_temp.act_as(:bridal_owner);
SELECT throws_like($$ SELECT public.update_my_shop('{"settings": {"void_payment_role": "everyone"}}') $$, '%owner, or the owner and managers%',
  'voiding cannot be opened to everyone');
SELECT throws_like($$ SELECT public.update_my_shop('{"settings": {"discount_limit_staff": 150}}') $$, '%0 to 100%', 'a discount limit is a percentage');
SELECT throws_like($$ SELECT public.update_my_shop('{"settings": {"backdate_return_hours": 5}}') $$, '%2, 6 or 24%', 'only 2, 6 or 24 hours');

-- ===== defaults: today's behaviour =====
SELECT pg_temp.act_as(:bridal_staff);
INSERT INTO t_ids VALUES ('a', pg_temp.book(200, 'QA ctl a', 500));
SELECT is((SELECT discount FROM rentals WHERE id = (SELECT id FROM t_ids WHERE name = 'a')), 500::numeric, 'with no limit set, staff give any discount');
SELECT lives_ok(format($f$ SELECT public.cancel_rental(%L, 0, 'cash', 'QA') $f$, (SELECT id FROM t_ids WHERE name = 'a')),
  'with the default rule, staff cancel a paid booking');

-- ===== the owner's rules =====
SELECT pg_temp.act_as(:bridal_owner);
SELECT lives_ok($$ SELECT public.update_my_shop('{"settings": {"discount_limit_staff": 10, "discount_limit_manager": 25, "cancel_paid_role": "owner_manager", "void_payment_role": "owner_manager"}}') $$,
  'the owner sets limits');
SELECT pg_temp.act_as(:bridal_staff);
SELECT throws_like($$ SELECT pg_temp.book(210, 'QA ctl big', 100000) $$, '%needs a manager or the owner%', 'staff cannot go over 10%');
INSERT INTO t_ids VALUES ('b', pg_temp.book(220, 'QA ctl b', 1));
SELECT ok((SELECT discount FROM rentals WHERE id = (SELECT id FROM t_ids WHERE name = 'b')) = 1, 'a small discount is fine');
SELECT throws_like(format($f$ SELECT public.cancel_rental(%L, 0, 'cash', 'QA') $f$, (SELECT id FROM t_ids WHERE name = 'b')),
  '%needs a manager or the owner%', 'staff cannot cancel a paid booking now');

-- ===== voiding =====
SELECT throws_like(format($f$ SELECT public.void_payment(%L, 'typo') $f$,
  (SELECT id FROM payments WHERE rental_id = (SELECT id FROM t_ids WHERE name = 'b') LIMIT 1)), '%', 'staff cannot void');
SELECT pg_temp.as_postgres();
INSERT INTO t_ids SELECT 'pay', id FROM payments WHERE rental_id = (SELECT id FROM t_ids WHERE name = 'b') AND kind = 'payment' LIMIT 1;
SELECT pg_temp.act_as(:bridal_manager);
SELECT throws_like(format($f$ SELECT public.void_payment(%L, 'x') $f$, (SELECT id FROM t_ids WHERE name = 'pay')), '%reason%', 'a reason is needed');
SELECT lives_ok(format($f$ SELECT public.void_payment(%L, 'Wrong amount typed', '{"amount": 90, "method": "upi"}') $f$, (SELECT id FROM t_ids WHERE name = 'pay')),
  'a manager voids it (the owner allowed it) and enters the correct one');
SELECT is((SELECT paid FROM rentals WHERE id = (SELECT id FROM t_ids WHERE name = 'b')), 90::numeric, 'the voided payment no longer counts');
SELECT is((SELECT void_reason FROM payments WHERE id = (SELECT id FROM t_ids WHERE name = 'pay')), 'Wrong amount typed', 'the row stays, with the reason');
SELECT is((SELECT count(*) FROM payments WHERE rental_id = (SELECT id FROM t_ids WHERE name = 'b')), 2::bigint, 'and the correct one is next to it');
SELECT throws_like(format($f$ SELECT public.void_payment(%L, 'again') $f$, (SELECT id FROM t_ids WHERE name = 'pay')), '%already void%',
  'a payment cannot be voided twice');
SELECT pg_temp.as_postgres();
SELECT is((SELECT count(*) FROM activity_log WHERE action = 'payment_voided' AND record_id = (SELECT id FROM t_ids WHERE name = 'pay')), 1::bigint,
  'the void is in the activity log');
SELECT ok((SELECT important FROM activity_log WHERE action = 'payment_voided' AND record_id = (SELECT id FROM t_ids WHERE name = 'pay')),
  'marked important');

-- ===== deposit back early =====
SELECT pg_temp.act_as(:bridal_manager);
SELECT lives_ok(format($f$ SELECT public.record_rental_payment(%L, 'deposit', 50, 'cash') $f$, (SELECT id FROM t_ids WHERE name = 'b')), 'a deposit is taken');
SELECT throws_like(format($f$ SELECT public.record_rental_payment(%L, 'deposit_refund', 50, 'cash') $f$, (SELECT id FROM t_ids WHERE name = 'b')),
  '%Only the owner can give it back earlier%', 'by default a manager cannot give it back before the return');

SELECT * FROM finish();
ROLLBACK;
