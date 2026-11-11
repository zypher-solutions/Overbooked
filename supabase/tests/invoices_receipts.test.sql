-- Invoices at booking, the lock after an invoice, credit notes, supplementary bills and receipt numbers (migration 040).
-- Run: npx supabase db reset && npx supabase test db   (uses the seeded demo shops; everything is rolled back)
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(19);

\set bridal_owner '''aaaaaaaa-0000-0000-0000-000000000011'''
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
CREATE FUNCTION pg_temp.book(p_day integer, p_note text) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.create_rental(jsonb_build_object(
    'branch_id', 'b0000000-0000-0000-0000-000000000001',
    'start_at', ((CURRENT_DATE + p_day) + time '10:00') AT TIME ZONE 'Asia/Kolkata',
    'end_at', ((CURRENT_DATE + p_day + 2) + time '10:00') AT TIME ZONE 'Asia/Kolkata',
    'notes', p_note, 'advance', '{"amount": 100, "method": "cash"}'::jsonb,
    'lines', '[{"variation_id": "e0000000-0000-0000-0000-000000000012", "qty": 1}]'::jsonb,
    'customer', '{"full_name": "QA Bills", "phone": "9000000040"}'::jsonb));
  RETURN (SELECT id FROM public.rentals WHERE notes = p_note);
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.act_as(uuid), pg_temp.as_postgres(), pg_temp.book(integer, text) TO authenticated;
CREATE TEMP TABLE t_ids (name text PRIMARY KEY, id uuid);
GRANT ALL ON t_ids TO authenticated;

-- ===== receipts =====
SELECT pg_temp.act_as(:bridal_staff);
INSERT INTO t_ids VALUES ('a', pg_temp.book(230, 'QA bill a'));
SELECT pg_temp.as_postgres();
SELECT matches((SELECT receipt_no FROM payments WHERE rental_id = (SELECT id FROM t_ids WHERE name = 'a') LIMIT 1), '-R/[0-9]{4}/[0-9]{4}$',
  'a payment gets a receipt number');
SELECT is((SELECT count(*) FROM payments WHERE receipt_no IS NULL), 0::bigint, 'every payment has one, older ones too');

-- ===== settings =====
SELECT pg_temp.act_as(:bridal_owner);
SELECT throws_like($$ SELECT public.update_my_shop('{"settings": {"bank_last4": "123456789"}}') $$, '%last 4 digits%', 'a full account number is refused');
SELECT throws_like($$ SELECT public.update_my_shop('{"settings": {"bank_ifsc": "SBIN1234"}}') $$, '%IFSC%', 'a wrong IFSC is refused');
SELECT throws_like($$ SELECT public.update_my_shop('{"settings": {"invoice_timing": "never"}}') $$, '%after the return or at booking%', 'only the two timings');
SELECT lives_ok($$ SELECT public.update_my_shop('{"gstin": "32ABCDE1234F1Z5", "settings": {"gst_percent": 5, "invoice_timing": "at_booking", "bank_name": "SBI", "bank_last4": "1234", "bank_ifsc": "SBIN0001234"}}') $$,
  'the owner bills at booking');

-- ===== issuing =====
SELECT pg_temp.act_as(:bridal_staff);
SELECT throws_like(format($f$ SELECT public.issue_invoice(%L) $f$, (SELECT id FROM t_ids WHERE name = 'a')), '%SAC code%', 'the SAC code is needed to issue');
SELECT pg_temp.act_as(:bridal_owner);
SELECT lives_ok($$ SELECT public.update_my_shop('{"settings": {"sac_code": "997329"}}') $$, 'SAC set');
SELECT pg_temp.act_as(:bridal_staff);
SELECT matches(public.issue_invoice((SELECT id FROM t_ids WHERE name = 'a')) ->> 'invoice_no', '/[0-9]{4}/[0-9]{4}$', 'issued at booking, before the pickup');
SELECT is((SELECT invoice_total FROM rentals WHERE id = (SELECT id FROM t_ids WHERE name = 'a')),
          (SELECT total FROM rentals WHERE id = (SELECT id FROM t_ids WHERE name = 'a')), 'the billed amount is kept');

-- ===== the lock and credit notes =====
SELECT pg_temp.act_as(:bridal_owner);
SELECT throws_like(format($f$ SELECT public.admin_set_discount(%L, 50, 'goodwill') $f$, (SELECT id FROM t_ids WHERE name = 'a')),
  '%Issue a credit note instead%', 'an invoiced amount is not lowered in place');
SELECT pg_temp.act_as(:bridal_staff);
SELECT throws_like(format($f$ SELECT public.issue_credit_note(%L, 50, 'goodwill') $f$, (SELECT id FROM t_ids WHERE name = 'a')), '%', 'staff cannot issue a credit note');
SELECT pg_temp.act_as(:bridal_owner);
SELECT matches(public.issue_credit_note((SELECT id FROM t_ids WHERE name = 'a'), 50, 'Goodwill') ->> 'number', '-C/[0-9]{4}/0001$', 'the owner issues credit note 0001');
SELECT is((SELECT total FROM rentals WHERE id = (SELECT id FROM t_ids WHERE name = 'a')),
          (SELECT invoice_total - 50 FROM rentals WHERE id = (SELECT id FROM t_ids WHERE name = 'a')), 'and the booking costs 50 less');
SELECT throws_like(format($f$ SELECT public.issue_credit_note(%L, 999999, 'too much') $f$, (SELECT id FROM t_ids WHERE name = 'a')),
  '%cannot be more than what was billed%', 'never more than was billed');

-- ===== supplementary bill at return =====
SELECT pg_temp.act_as(:bridal_staff);
SELECT lives_ok(format($f$ SELECT public.start_rental(%L, '{}') $f$, (SELECT id FROM t_ids WHERE name = 'a')), 'handed over');
SELECT lives_ok(format($f$ SELECT public.complete_rental(%L, jsonb_build_object('charges', '[{"type": "damage", "amount": 300, "note": "Stain"}]'::jsonb,
    'checks', jsonb_build_array(jsonb_build_object('unit_id', (SELECT unit_id FROM unit_reservations WHERE rental_id = %L LIMIT 1), 'condition', 'good')))) $f$,
  (SELECT id FROM t_ids WHERE name = 'a'), (SELECT id FROM t_ids WHERE name = 'a')), 'returned with a damage charge');
SELECT is((SELECT amount FROM rental_documents WHERE rental_id = (SELECT id FROM t_ids WHERE name = 'a') AND kind = 'supplementary'), 300::numeric,
  'the damage charge is on a supplementary bill by itself');

-- ===== cancellation after an invoice =====
INSERT INTO t_ids VALUES ('b', pg_temp.book(240, 'QA bill b'));
SELECT public.issue_invoice((SELECT id FROM t_ids WHERE name = 'b'));
SELECT public.cancel_rental((SELECT id FROM t_ids WHERE name = 'b'), 0, 'cash', 'Customer changed plans');
SELECT is((SELECT amount FROM rental_documents WHERE rental_id = (SELECT id FROM t_ids WHERE name = 'b') AND kind = 'credit_note'),
          (SELECT invoice_total FROM rentals WHERE id = (SELECT id FROM t_ids WHERE name = 'b')), 'cancelling makes a credit note for the whole bill');

SELECT * FROM finish();
ROLLBACK;
