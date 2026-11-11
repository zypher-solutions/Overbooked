-- Branch settings (migration 038): a branch's own values win over the shop's, clearing them falls back, only some keys may
-- differ per branch, the checks are shared, and the shop's name, city, state and PIN code.
-- Run: npx supabase db reset && npx supabase test db   (uses the seeded demo shops; everything is rolled back)
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(16);

\set bridal_owner '''aaaaaaaa-0000-0000-0000-000000000011'''
\set bridal_staff '''aaaaaaaa-0000-0000-0000-000000000013'''
\set mg_road '''b0000000-0000-0000-0000-000000000001'''

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
-- a new booking at MG Road, p_day days from now; returns its late rules
CREATE FUNCTION pg_temp.terms(p_day integer, p_note text) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.create_rental(jsonb_build_object(
    'branch_id', 'b0000000-0000-0000-0000-000000000001',
    'start_at', ((CURRENT_DATE + p_day) + time '10:00') AT TIME ZONE 'Asia/Kolkata',
    'end_at', ((CURRENT_DATE + p_day + 2) + time '10:00') AT TIME ZONE 'Asia/Kolkata',
    'notes', p_note, 'lines', '[{"variation_id": "e0000000-0000-0000-0000-000000000012", "qty": 1}]'::jsonb,
    'customer', '{"full_name": "QA Branch Rules", "phone": "9000000038"}'::jsonb));
  RETURN (SELECT late_terms FROM public.rentals WHERE notes = p_note);
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.act_as(uuid), pg_temp.as_postgres(), pg_temp.terms(integer, text) TO authenticated;

-- ===== who may set them, and which =====
SELECT pg_temp.act_as(:bridal_staff);
SELECT throws_like(format($f$ SELECT public.update_branch_settings(%L, '{"late_fee_percent": 150}') $f$, :mg_road), '%', 'staff cannot set branch settings');
SELECT pg_temp.act_as(:bridal_owner);
SELECT throws_like(format($f$ SELECT public.update_branch_settings(%L, '{"gst_percent": 5}') $f$, :mg_road),
  '%whole shop, not per branch%', 'GST stays shop-wide');
SELECT throws_like(format($f$ SELECT public.update_branch_settings(%L, '{"late_fee_percent": 400}') $f$, :mg_road),
  '%0 to 300%', 'a branch value gets the same checks as the shop''s');
SELECT throws_like($$ SELECT public.update_branch_settings('00000000-0000-0000-0000-000000000000', '{"late_fee_percent": 100}') $$,
  '%Branch not found%', 'another shop''s or a made-up branch is refused');

-- ===== the branch value wins, clearing it falls back =====
SELECT lives_ok($$ SELECT public.update_my_shop('{"settings": {"late_fee_percent": 120}}') $$, 'the shop''s rule is 120%');
SELECT lives_ok(format($f$ SELECT public.update_branch_settings(%L, '{"late_fee_percent": 200, "receipt_note": "MG Road note"}') $f$, :mg_road),
  'MG Road sets its own 200% and receipt note');
SELECT pg_temp.act_as(:bridal_staff);
SELECT is((pg_temp.terms(100, 'QA br a') ->> 'percent')::numeric, 200::numeric, 'a new MG Road booking gets the branch''s rule');
SELECT pg_temp.act_as(:bridal_owner);
SELECT lives_ok(format($f$ SELECT public.update_branch_settings(%L, '{}', ARRAY['late_fee_percent']) $f$, :mg_road), 'the override is cleared');
SELECT is((SELECT settings FROM branches WHERE id = :mg_road), '{"receipt_note": "MG Road note"}'::jsonb, 'only that key is removed');
SELECT pg_temp.act_as(:bridal_staff);
SELECT is((pg_temp.terms(110, 'QA br b') ->> 'percent')::numeric, 120::numeric, 'then bookings follow the shop again');
SELECT pg_temp.as_postgres();
SELECT is((SELECT count(*) FROM activity_log WHERE action = 'branch_settings_changed' AND record_id = :mg_road), 1::bigint,
  'branch settings changes are in the activity log (one save is one entry)');

-- ===== the shop's name and address parts =====
SELECT pg_temp.act_as(:bridal_owner);
SELECT throws_like($$ SELECT public.update_my_shop('{"pincode": "12345"}') $$, '%6 digits%', 'a short PIN code is refused');
SELECT throws_like($$ SELECT public.update_my_shop('{"name": "  "}') $$, '%1 to 80%', 'an empty shop name is refused');
SELECT lives_ok($$ SELECT public.update_my_shop('{"name": "Bridal  Studio QA", "city": "Kochi", "state": "Kerala", "pincode": "682001"}') $$,
  'the owner renames the shop and sets its city, state and PIN');
SELECT is((SELECT name || '|' || city || '|' || state || '|' || pincode FROM shops WHERE id = current_shop_id()),
  'Bridal Studio QA|Kochi|Kerala|682001', 'saved, spaces tidied');
SELECT throws_like(format($f$ SELECT public.setup_save_branch(current_shop_id(), %L, '{"pincode": "0682"}') $f$, :mg_road),
  '%6 digits%', 'a branch PIN is checked too');

SELECT * FROM finish();
ROLLBACK;
