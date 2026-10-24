-- Platform: shop isolation, roles and branches, plan limits, feature switches, corrections, reports, Zypher console.
-- Run: npx supabase db reset && npx supabase test db   (uses the seeded demo shops; everything is rolled back)
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(36);

\set zypher '''aaaaaaaa-0000-0000-0000-000000000001'''
\set bridal_owner '''aaaaaaaa-0000-0000-0000-000000000011'''
\set bridal_manager '''aaaaaaaa-0000-0000-0000-000000000012'''
\set bridal_staff '''aaaaaaaa-0000-0000-0000-000000000013'''
\set groom_owner '''aaaaaaaa-0000-0000-0000-000000000021'''
\set groom_staff '''aaaaaaaa-0000-0000-0000-000000000022'''
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
GRANT EXECUTE ON FUNCTION pg_temp.act_as(uuid), pg_temp.as_postgres(), pg_temp.ist(integer, text) TO authenticated;

-- ===========================================================================
-- Isolation between shops
-- ===========================================================================
SELECT pg_temp.act_as(:groom_owner);
SELECT is((SELECT count(*) FROM rentals), 1::bigint, 'a shop sees only its own rentals');
SELECT is((SELECT count(*) FROM customers WHERE full_name = 'Anjali Menon'), 0::bigint, 'another shop''s customers are invisible');
SELECT is((SELECT count(*) FROM units WHERE code LIKE 'BR-%'), 0::bigint, 'another shop''s units are invisible');
SELECT is((SELECT count(*) FROM payments), (SELECT count(*) FROM payments p JOIN rentals r ON r.id = p.rental_id), 'payments only of own rentals');
SELECT throws_ok($$ INSERT INTO customers (shop_id, full_name, phone) VALUES ('5a000000-0000-0000-0000-000000000001', 'Sneaky', '9000000999') $$,
  '42501', NULL, 'cannot write into another shop');
SELECT throws_like($$ SELECT public.quote_rental(jsonb_build_object('branch_id', 'b0000000-0000-0000-0000-000000000003',
    'start_at', pg_temp.ist(30, '10:00'), 'end_at', pg_temp.ist(31, '10:00'),
    'lines', '[{"variation_id": "e0000000-0000-0000-0000-000000000011", "qty": 1}]'::jsonb)) $$,
  'Item not found', 'cannot quote another shop''s item');
SELECT throws_like($$ SELECT public.cancel_rental((SELECT id FROM rentals WHERE false), 0) $$,
  'Rental not found', 'unknown rental id is refused');
SELECT pg_temp.as_postgres();
SELECT throws_like(format($$ SELECT public.cancel_rental(%L, 0) $$, (SELECT id FROM rentals WHERE token LIKE 'KAL-%')),
  '%', 'postgres call without a user is refused');
SELECT pg_temp.act_as(:groom_owner);
SELECT throws_like(format($$ SELECT public.cancel_rental(%L, 0, 'upi') $$,
    (SELECT r.id FROM rentals r WHERE false UNION ALL SELECT '00000000-0000-0000-0000-000000000000'::uuid LIMIT 1)),
  'Rental not found', 'cannot act on a rental id the shop cannot see');

-- ===========================================================================
-- Roles and branches inside a shop
-- ===========================================================================
SELECT pg_temp.as_postgres();
INSERT INTO public.customers (shop_id, full_name, phone) VALUES ('5a000000-0000-0000-0000-000000000001', 'Thrissur Bride', '9000033333');
SELECT pg_temp.act_as(:bridal_owner);
SELECT lives_ok($$ SELECT public.create_rental(jsonb_build_object('branch_id', 'b0000000-0000-0000-0000-000000000002',
    'customer', jsonb_build_object('id', (SELECT id FROM customers WHERE full_name = 'Thrissur Bride')),
    'start_at', pg_temp.ist(20, '10:00'), 'end_at', pg_temp.ist(21, '10:00'),
    'lines', '[{"variation_id": "e0000000-0000-0000-0000-000000000011", "qty": 1}]'::jsonb)) $$, 'owner books in any branch');
SELECT is((SELECT count(*) FROM rentals), 2::bigint, 'owner sees both branches');
SELECT pg_temp.act_as(:bridal_manager);
SELECT is((SELECT count(*) FROM rentals), 1::bigint, 'manager sees only their branch');
SELECT is((SELECT count(*) FROM jsonb_object_keys(public.dashboard_summary(CURRENT_DATE, CURRENT_DATE + 60))), 7::bigint,
          'manager gets a dashboard');
SELECT is((public.dashboard_summary(CURRENT_DATE, CURRENT_DATE + 60, 'b0000000-0000-0000-0000-000000000002') ->> 'rentals')::integer, 1,
          'manager dashboard is pinned to their own branch whatever they ask');
SELECT pg_temp.act_as(:bridal_staff);
SELECT throws_like($$ SELECT public.dashboard_summary(CURRENT_DATE, CURRENT_DATE + 60) $$, 'Your role (staff) cannot do this',
  'staff have no dashboard money');
SELECT throws_like($$ SELECT public.delete_or_deactivate_product('d0000000-0000-0000-0000-000000000012') $$,
  'Your role (staff) cannot do this', 'staff cannot delete products');

-- ===========================================================================
-- Dashboard equals the records
-- ===========================================================================
SELECT pg_temp.act_as(:bridal_owner);
SELECT is((public.dashboard_summary(CURRENT_DATE, CURRENT_DATE + 60) ->> 'revenue')::numeric,
          (SELECT sum(total) FROM rentals), 'dashboard revenue = sum of rental totals');
SELECT is((public.dashboard_summary(CURRENT_DATE, CURRENT_DATE + 60) ->> 'balance_due')::numeric,
          (SELECT sum(total - paid) FROM rentals), 'dashboard balance due = sum of balances');
SELECT is((public.dashboard_summary(CURRENT_DATE, CURRENT_DATE) ->> 'collected')::numeric,
          (SELECT sum(amount) FROM payments WHERE kind = 'payment'), 'dashboard collected = payments recorded today');
SELECT is((SELECT sum(total) FROM inventory_status() WHERE variation_id = 'e0000000-0000-0000-0000-000000000011'), 2::numeric,
          'inventory: 2 lehenga pieces across branches');

-- ===========================================================================
-- Corrections: owner only, reason required, logged
-- ===========================================================================
SELECT throws_like($$ SELECT public.admin_set_discount((SELECT id FROM rentals WHERE token LIKE 'KAL-%-0001'), 100, '') $$,
  'A reason%', 'a correction needs a reason');
SELECT throws_like($$ SELECT public.admin_set_discount((SELECT id FROM rentals WHERE token LIKE 'KAL-%-0001'), 4000, 'Regular') $$,
  '%overpaid%', 'a discount cannot leave the customer overpaid');
SELECT is((public.admin_set_discount((SELECT id FROM rentals WHERE token LIKE 'KAL-%-0001'), 1000, 'Regular customer') ->> 'balance')::numeric,
          2000.00, 'discount lowers the balance');
SELECT pg_temp.as_postgres();
SELECT is((SELECT reason FROM audit_log WHERE table_name = 'rentals' ORDER BY id DESC LIMIT 1), 'Regular customer',
          'the correction is in the audit log with its reason');
SELECT pg_temp.act_as(:bridal_owner);
SELECT is(public.delete_or_deactivate_product('d0000000-0000-0000-0000-000000000011') ->> 'result', 'deactivated',
          'a product with history is only deactivated');
SELECT is(public.delete_or_deactivate_product('d0000000-0000-0000-0000-000000000012') ->> 'result', 'deleted',
          'a product with no history is deleted');

-- ===========================================================================
-- Optional features
-- ===========================================================================
SELECT throws_like($$ SELECT public.set_unit_status((SELECT id FROM units WHERE code = 'BR-LEH-001-M-2'), 'alteration', 'Hem') $$,
  'Alterations are not switched on%', 'alterations are off by default');
SELECT lives_ok($$ SELECT public.update_my_shop('{"settings": {"features": {"alterations": true}}}') $$, 'owner switches alterations on');
SELECT is(public.set_unit_status((SELECT id FROM units WHERE code = 'BR-LEH-001-M-2'), 'alteration', 'Hem') ->> 'status', 'alteration',
          'a piece can now go for alteration');

-- ===========================================================================
-- Plan limits
-- ===========================================================================
SELECT pg_temp.as_postgres();
SELECT throws_like($$ INSERT INTO branches (shop_id, name, slug) VALUES ('5a000000-0000-0000-0000-000000000002', 'Second', 'second') $$,
  'Your Starter plan allows 1 active branch%', 'starter plan: one branch');

-- ===========================================================================
-- Zypher console
-- ===========================================================================
SELECT pg_temp.act_as(:bridal_owner);
SELECT throws_like($$ SELECT public.platform_overview() $$, 'Only Zypher can do this', 'shops cannot see the console');
SELECT pg_temp.act_as(:zypher);
SELECT is((SELECT count(*) FROM platform_overview()), 5::bigint, 'Zypher sees every shop');
SELECT lives_ok($$ SELECT public.create_shop('{"name": "Hill Stay", "slug": "hill-stay", "token_prefix": "HIL",
    "business_types": ["resort", "bike"], "branch_name": "Ooty Main"}') $$, 'Zypher creates a resort + bike shop');
SELECT pg_temp.as_postgres();
SELECT is((SELECT array_agg(template_key ORDER BY template_key) FROM categories c JOIN shops s ON s.id = c.shop_id WHERE s.slug = 'hill-stay'),
          ARRAY['bike', 'resort'], 'one category per business type');
SELECT is((SELECT count(*) FROM add_ons a JOIN shops s ON s.id = a.shop_id WHERE s.slug = 'hill-stay'), 6::bigint,
          'default add-ons from both templates');
SELECT pg_temp.act_as(:zypher);
SELECT throws_like($$ SELECT public.update_shop('5a000000-0000-0000-0000-000000000001', '{"plan": "starter"}') $$,
  'The shop has 2 active branches%', 'cannot downgrade below what the shop uses');

SELECT * FROM finish();
ROLLBACK;
