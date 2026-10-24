-- Console actions, whole-property and set bookings, no-shows, extensions, unit swaps, catalog import,
-- payment corrections, staff management, invites and the login limit.
-- Run: npx supabase db reset && npx supabase test db   (uses the seeded demo shops; everything is rolled back)
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(33);

\set zypher '''aaaaaaaa-0000-0000-0000-000000000001'''
\set bridal_owner '''aaaaaaaa-0000-0000-0000-000000000011'''
\set bridal_staff '''aaaaaaaa-0000-0000-0000-000000000013'''
\set groom_owner '''aaaaaaaa-0000-0000-0000-000000000021'''
\set groom_staff '''aaaaaaaa-0000-0000-0000-000000000022'''
\set resort_owner '''aaaaaaaa-0000-0000-0000-000000000031'''
\set bike_owner '''aaaaaaaa-0000-0000-0000-000000000051'''

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
-- a booking of one line, new customer
CREATE FUNCTION pg_temp.book(p_branch text, p_variation text, p_start timestamptz, p_end timestamptz, p_extra jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.create_rental(jsonb_build_object('branch_id', p_branch,
    'customer', jsonb_build_object('full_name', 'Test Customer', 'phone', '9000099999'),
    'start_at', p_start, 'end_at', p_end,
    'lines', CASE WHEN p_variation IS NULL THEN '[]'::jsonb
                  ELSE jsonb_build_array(jsonb_build_object('variation_id', p_variation, 'qty', 1)) END) || p_extra);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.act_as(uuid), pg_temp.as_postgres(), pg_temp.ist(integer, text),
  pg_temp.book(text, text, timestamptz, timestamptz, jsonb) TO authenticated;

-- ===========================================================================
-- Zypher console actions
-- ===========================================================================
SELECT pg_temp.act_as(:zypher);
SELECT lives_ok($$ SELECT public.update_shop('5a000000-0000-0000-0000-000000000005', '{"status": "suspended"}') $$,
  'Zypher pauses a shop without resending its business types');
SELECT is((SELECT status FROM platform_overview() WHERE slug = 'munnar-bikes'), 'suspended', 'the shop is paused');
SELECT pg_temp.act_as(:bike_owner);
SELECT throws_like($$ SELECT * FROM public.inventory_status() $$, 'Your account is not active in a shop',
  'a paused shop''s people are locked out');
SELECT pg_temp.act_as(:zypher);
SELECT lives_ok($$ SELECT public.record_shop_payment('5a000000-0000-0000-0000-000000000005', 599, CURRENT_DATE, CURRENT_DATE + 30, 'upi', 'Late payment') $$,
  'Zypher records a late payment');
SELECT lives_ok($$ SELECT public.update_shop('5a000000-0000-0000-0000-000000000005', '{"status": "active"}') $$, 'and resumes the shop');
SELECT is((SELECT array[status, paid_until::text, array_to_string(business_types, ',')] FROM platform_overview() WHERE slug = 'munnar-bikes'),
          array['active', (CURRENT_DATE + 30)::text, 'bike'], 'active again, paid until extended, business types kept');
SELECT lives_ok($$ SELECT public.switch_shop('5a000000-0000-0000-0000-000000000003') $$, 'Zypher opens another shop');
SELECT is((SELECT array_agg(token) FROM rentals), (SELECT array_agg(token) FROM rentals WHERE token LIKE 'GVR-%'),
          'Zypher now sees only that shop''s rentals');

-- ===========================================================================
-- Resort: whole property, no-show
-- ===========================================================================
SELECT pg_temp.act_as(:resort_owner);
SELECT lives_ok($$ SELECT pg_temp.book('b0000000-0000-0000-0000-000000000004', NULL, pg_temp.ist(40, '14:00'), pg_temp.ist(42, '11:00'),
                                         '{"whole_property": true, "adults": 8}') $$, 'whole-property booking');
SELECT is((SELECT count(*) FROM unit_reservations ur JOIN rentals r ON r.id = ur.rental_id WHERE r.whole_property), 4::bigint,
          'every room of the branch is held');
SELECT throws_like($$ SELECT pg_temp.book('b0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000000031',
                                         pg_temp.ist(41, '14:00'), pg_temp.ist(42, '11:00')) $$,
  'Only 0 of 1 available%', 'no single room can be sold on those nights');
SELECT throws_like($$ SELECT public.cancel_rental((SELECT id FROM rentals WHERE token LIKE 'GVR-%-0001'), 0, 'upi', NULL, true) $$,
  'A no-show can only be marked after the planned start', 'no-show refused before the start');
SELECT pg_temp.as_postgres();
UPDATE rentals SET start_at = now() - interval '2 hours' WHERE token LIKE 'GVR-%-0001';
SELECT pg_temp.act_as(:resort_owner);
SELECT is(public.cancel_rental((SELECT id FROM rentals WHERE token LIKE 'GVR-%-0001'), 4500, NULL, 'Did not arrive', true) ->> 'status',
          'no_show', 'no-show after the start keeps the advance as the fee');

-- ===========================================================================
-- Bridal sets (optional feature)
-- ===========================================================================
SELECT pg_temp.as_postgres();
INSERT INTO products (id, shop_id, category_id, name, sku, is_set) VALUES
  ('d0000000-0000-0000-0000-0000000000ff', '5a000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Bridal set', 'BR-SET-1', true);
INSERT INTO product_variations (id, shop_id, product_id, name, sku) VALUES
  ('e0000000-0000-0000-0000-0000000000ff', '5a000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000000ff', 'Standard', 'BR-SET-1-STD');
INSERT INTO variation_rates (shop_id, variation_id, rate_type, amount) VALUES
  ('5a000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-0000000000ff', 'day', 3000);
INSERT INTO set_items (shop_id, set_product_id, variation_id, qty) VALUES
  ('5a000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000000ff', 'e0000000-0000-0000-0000-000000000011', 1),
  ('5a000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000000ff', 'e0000000-0000-0000-0000-000000000012', 1);
SELECT pg_temp.act_as(:bridal_staff);
SELECT is((pg_temp.book('b0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-0000000000ff',
             pg_temp.ist(50, '10:00'), pg_temp.ist(51, '10:00')) ->> 'total')::numeric, 3000.00, 'a set is priced as one item');
SELECT is((SELECT string_agg(u.code, ',' ORDER BY u.code) FROM unit_reservations ur JOIN units u ON u.id = ur.unit_id
           JOIN rentals r ON r.id = ur.rental_id WHERE r.start_at = pg_temp.ist(50, '10:00')),
          'BR-LEH-001-M-1,BR-SAR-001-GOLD-1', 'a set holds one piece of each of its parts');

-- ===========================================================================
-- Unit swaps and extensions
-- ===========================================================================
SELECT throws_like($$ SELECT public.swap_unit((SELECT id FROM rentals WHERE token LIKE 'KAL-%-0001'),
    (SELECT id FROM units WHERE code = 'BR-LEH-001-M-1'), (SELECT id FROM units WHERE code = 'BR-LEH-001-M-2')) $$,
  'Choose an available unit of the same item in the same branch', 'cannot swap to a unit in another branch');
SELECT pg_temp.act_as(:groom_staff);
SELECT lives_ok($$ SELECT public.swap_unit((SELECT id FROM rentals WHERE token LIKE 'RAJ-%-0001'),
    (SELECT unit_id FROM unit_reservations WHERE rental_id = (SELECT id FROM rentals WHERE token LIKE 'RAJ-%-0001')),
    (SELECT id FROM units WHERE code = 'GR-SHW-001-L-2')) $$, 'swap to another piece of the same item');
SELECT is((SELECT u.code FROM unit_reservations ur JOIN units u ON u.id = ur.unit_id
           WHERE ur.rental_id = (SELECT id FROM rentals WHERE token LIKE 'RAJ-%-0001')), 'GR-SHW-001-L-2', 'the booking now holds the new piece');
SELECT lives_ok($$ SELECT pg_temp.book('b0000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000022',
                                         pg_temp.ist(20, '10:00'), pg_temp.ist(21, '10:00')) $$, 'suit booked');
SELECT lives_ok($$ SELECT pg_temp.book('b0000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000022',
                                         pg_temp.ist(23, '10:00'), pg_temp.ist(24, '10:00')) $$, 'same suit booked again later');
SELECT throws_like($$ SELECT public.extend_rental((SELECT id FROM rentals WHERE start_at = pg_temp.ist(20, '10:00')), pg_temp.ist(23, '12:00')) $$,
  'Cannot extend: a unit is booked by someone else%', 'cannot extend into the next booking');

-- ===========================================================================
-- Catalog import
-- ===========================================================================
SELECT pg_temp.act_as(:resort_owner);
SELECT is(public.import_catalog('{"items": [{"category": "Rooms", "name": "Tree house", "sku": "RM-TREE", "variations": [
    {"sku": "RM-TREE-1", "rates": {"night": 6000}, "base_occupancy": 2, "max_occupancy": 2, "units": [{"branch": "Vythiri", "code": "T1"}]}]}]}'),
  '{"units": 1, "products": 1, "variations": 1}'::jsonb, 'import creates product, variation, rate and unit');
SELECT is(public.import_catalog('{"items": [{"category": "Rooms", "name": "Tree house", "sku": "RM-TREE", "variations": [
    {"sku": "RM-TREE-1", "rates": {"night": 6500}, "units": [{"branch": "Vythiri", "code": "T1"}]}]}]}') ->> 'units', '0',
  're-import updates and never duplicates units');
SELECT is((SELECT amount FROM variation_rates r JOIN product_variations v ON v.id = r.variation_id WHERE v.sku = 'RM-TREE-1'), 6500.00,
          're-import updates the rate');
SELECT throws_like($$ SELECT public.import_catalog('{"items": [{"category": "Boats", "name": "Houseboat", "sku": "HB-1"}]}') $$,
  'Category "Boats" does not exist%', 'import refuses an unknown category');

-- ===========================================================================
-- Payment corrections
-- ===========================================================================
SELECT pg_temp.act_as(:bridal_staff);
SELECT throws_like($$ SELECT public.admin_update_payment((SELECT p.id FROM payments p JOIN rentals r ON r.id = p.rental_id
    WHERE r.token LIKE 'KAL-%-0001' AND p.kind = 'payment'), 1500, 'cash', 'Typo') $$, 'Your role (staff) cannot do this',
  'staff cannot correct payments');
SELECT pg_temp.act_as(:bridal_owner);
SELECT is((public.admin_update_payment((SELECT p.id FROM payments p JOIN rentals r ON r.id = p.rental_id
    WHERE r.token LIKE 'KAL-%-0001' AND p.kind = 'payment'), 1500, 'cash', 'Typo in amount') ->> 'paid')::numeric, 1500.00,
  'owner corrects a payment amount');
SELECT is((public.admin_delete_payment((SELECT p.id FROM payments p JOIN rentals r ON r.id = p.rental_id
    WHERE r.token LIKE 'KAL-%-0001' AND p.kind = 'payment'), 'Entered twice') ->> 'paid')::numeric, 0.00,
  'owner deletes a payment; paid follows');

-- ===========================================================================
-- Staff management, invites, login limit
-- ===========================================================================
SELECT is((SELECT count(*) FROM public.get_staff_emails()), 3::bigint, 'owner sees the shop''s 3 logins');
SELECT throws_like($$ SELECT public.admin_set_staff_status('aaaaaaaa-0000-0000-0000-000000000011', false, 'owner') $$,
  'You cannot change your own role or active status', 'owner cannot lock themselves out');
SELECT throws_like($$ SELECT public.set_staff_branch('aaaaaaaa-0000-0000-0000-000000000013', 'b0000000-0000-0000-0000-000000000003') $$,
  'Branch not found in this shop', 'cannot move staff to another shop''s branch');
SELECT pg_temp.as_postgres();
INSERT INTO staff_invites (shop_id, email, role, branch_id) VALUES
  ('5a000000-0000-0000-0000-000000000002', 'third@groom.test', 'staff', 'b0000000-0000-0000-0000-000000000003'),
  ('5a000000-0000-0000-0000-000000000002', 'fourth@groom.test', 'staff', 'b0000000-0000-0000-0000-000000000003');
INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data)
VALUES ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'third@groom.test', '{"full_name": "Third"}');
SELECT is((SELECT array[role, shop_id::text, branch_id::text, is_active::text] FROM profiles WHERE full_name = 'Third'),
          array['staff', '5a000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000003', 'true'],
          'an invited login joins its shop, role and branch');
SELECT throws_like($$ INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data)
    VALUES ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'fourth@groom.test', '{}') $$,
  'Your Starter plan allows 3 staff logins%', 'starter plan: a 4th login is refused');

SELECT * FROM finish();
ROLLBACK;
