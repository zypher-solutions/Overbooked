-- Attack tests: a person (or a stolen login) trying to go beyond what their role allows, plus rules about the database itself.
-- Run: npx supabase db reset && npx supabase test db   (uses the seeded demo shops; everything is rolled back)
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(56);

\set zypher '''aaaaaaaa-0000-0000-0000-000000000001'''
\set bridal_owner '''aaaaaaaa-0000-0000-0000-000000000011'''
\set bridal_manager '''aaaaaaaa-0000-0000-0000-000000000012'''
\set bridal_staff '''aaaaaaaa-0000-0000-0000-000000000013'''
\set bridal_support '''aaaaaaaa-0000-0000-0000-000000000014'''
\set groom_owner '''aaaaaaaa-0000-0000-0000-000000000021'''
\set kalyani '''5a000000-0000-0000-0000-000000000001'''

CREATE FUNCTION pg_temp.act_as(p_user uuid, p_aal text DEFAULT 'aal1') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;
CREATE FUNCTION pg_temp.as_anon() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('role', 'anon', true);
END $$;
CREATE FUNCTION pg_temp.as_postgres() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.act_as(uuid, text), pg_temp.as_anon(), pg_temp.as_postgres() TO authenticated, anon;

SELECT id AS krental FROM rentals WHERE shop_id = :kalyani LIMIT 1 \gset
SELECT id AS kpayment FROM payments WHERE shop_id = :kalyani LIMIT 1 \gset
SELECT id AS kproduct FROM products WHERE shop_id = :kalyani LIMIT 1 \gset

-- ===== another shop's owner =====
SELECT pg_temp.act_as(:groom_owner);
SELECT is((SELECT count(*) FROM customers WHERE shop_id = :kalyani), 0::bigint, 'another shop''s owner cannot read customers');
SELECT is((SELECT count(*) FROM rentals WHERE shop_id = :kalyani), 0::bigint, 'nor bookings');
SELECT is((SELECT count(*) FROM payments WHERE shop_id = :kalyani), 0::bigint, 'nor payments');
SELECT throws_ok($$ INSERT INTO customers (shop_id, full_name, phone) VALUES ('5a000000-0000-0000-0000-000000000001', 'Intruder', '9000000000') $$,
  '42501', NULL, 'nor add a customer to it');
SELECT lives_ok(format($$ UPDATE products SET name = 'hacked' WHERE id = %L $$, :'kproduct'), 'a write at another shop''s product runs, but...');
SELECT throws_ok(format($$ SELECT public.cancel_rental(%L, 0) $$, :'krental'), NULL, NULL, 'cannot cancel another shop''s booking');
SELECT throws_ok(format($$ SELECT public.record_rental_payment(%L, 'payment', 1, 'cash') $$, :'krental'), NULL, NULL, 'cannot pay into another shop''s booking');
SELECT throws_ok(format($$ SELECT public.admin_delete_rental(%L, 'attack') $$, :'krental'), NULL, NULL, 'cannot delete another shop''s booking');
SELECT throws_ok($$ INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('product_images', '5a000000-0000-0000-0000-000000000001/hack.png', 'aaaaaaaa-0000-0000-0000-000000000021') $$,
  NULL, NULL, 'cannot upload a file into another shop''s photo folder');
SELECT pg_temp.as_postgres();
SELECT is((SELECT count(*) FROM products WHERE name = 'hacked'), 0::bigint, '...it changed nothing');

-- ===== a shop's own owner: no platform powers =====
SELECT pg_temp.act_as(:bridal_owner);
SELECT throws_like($$ SELECT public.update_shop('5a000000-0000-0000-0000-000000000001', '{"plan":"business"}') $$, 'Only Zypher can do this', 'an owner cannot change their own plan');
SELECT throws_like($$ SELECT public.record_shop_payment('5a000000-0000-0000-0000-000000000001', 1, CURRENT_DATE, CURRENT_DATE, 'cash', 'x', 'subscription') $$, 'Only Zypher can do this', 'an owner cannot record Zypher billing');
SELECT throws_like($$ SELECT public.switch_shop('5a000000-0000-0000-0000-000000000002') $$, 'Only Zypher can do this', 'an owner cannot open another shop');
SELECT throws_like($$ SELECT public.admin_set_staff_status('aaaaaaaa-0000-0000-0000-000000000013', true, 'owner') $$, 'Only Zypher can do this', 'an owner cannot promote staff');
SELECT throws_ok($$ UPDATE shops SET plan = 'business' WHERE id = '5a000000-0000-0000-0000-000000000001' $$, '42501', NULL, 'nor edit the shop row directly');
SELECT throws_ok($$ INSERT INTO staff_invites (shop_id, email, role) VALUES ('5a000000-0000-0000-0000-000000000001', 'x@x.test', 'owner') $$, '42501', NULL, 'nor invite people');
SELECT throws_ok($$ UPDATE profiles SET role = 'super_admin', shop_id = NULL WHERE id = 'aaaaaaaa-0000-0000-0000-000000000011' $$, '42501', NULL, 'nor make themselves Zypher');
SELECT throws_ok($$ DELETE FROM audit_log $$, '42501', NULL, 'cannot delete the audit log');
SELECT throws_ok($$ INSERT INTO audit_log (via, action, table_name) VALUES ('app', 'forged', 'rentals') $$, '42501', NULL, 'cannot forge audit entries');
SELECT lives_ok($$ UPDATE platform_settings SET bank_details = 'my own account' $$, 'an owner''s write at the bank details runs (it hits no row)');

SELECT pg_temp.as_postgres();
SELECT isnt((SELECT bank_details FROM platform_settings), 'my own account', 'but the bank details are unchanged');
SELECT pg_temp.act_as(:bridal_staff);
-- ===== staff =====
SELECT pg_temp.act_as(:bridal_staff);
SELECT throws_ok($$ UPDATE profiles SET role = 'owner' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000013' $$, '42501', NULL, 'staff cannot promote themselves');
SELECT throws_ok($$ UPDATE profiles SET shop_id = '5a000000-0000-0000-0000-000000000002' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000013' $$, '42501', NULL, 'staff cannot move themselves to another shop');
SELECT throws_ok($$ UPDATE profiles SET branch_id = NULL WHERE id = 'aaaaaaaa-0000-0000-0000-000000000013' $$, '42501', NULL, 'staff cannot widen their own branch');
SELECT is((SELECT count(*) FROM rentals WHERE branch_id <> 'b0000000-0000-0000-0000-000000000001'), 0::bigint, 'staff see only their own branch''s bookings');
SELECT is((SELECT count(*) FROM audit_log), 0::bigint, 'staff cannot read the audit log');
SELECT throws_ok(format($$ SELECT public.admin_update_payment(%L, 1, 'cash', 'attack on money') $$, :'kpayment'), NULL, NULL, 'staff cannot change a payment');
SELECT throws_ok(format($$ SELECT public.admin_delete_rental(%L, 'attack on money') $$, :'krental'), NULL, NULL, 'staff cannot delete a booking');
SELECT throws_ok($$ INSERT INTO products (shop_id, category_id, name, sku) VALUES ('5a000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Free dress', 'BR-777') $$, '42501', NULL, 'staff cannot add products');

-- ===== a manager stays in one branch =====
SELECT pg_temp.act_as(:bridal_manager);
SELECT is((SELECT count(*) FROM rentals WHERE branch_id <> 'b0000000-0000-0000-0000-000000000001'), 0::bigint, 'a manager sees only their branch''s bookings');
SELECT throws_ok($$ UPDATE profiles SET role = 'owner' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000012' $$, '42501', NULL, 'a manager cannot promote themselves');

-- ===== not signed in =====
SELECT pg_temp.as_anon();
SELECT throws_ok($$ SELECT count(*) FROM customers $$, '42501', NULL, 'not signed in: no customers');
SELECT throws_ok($$ SELECT count(*) FROM shops $$, '42501', NULL, 'not signed in: no shop list');
SELECT throws_ok($$ SELECT public.is_platform_admin() $$, '42501', NULL, 'not signed in: no database functions');
SELECT throws_ok($$ SELECT public.create_rental('{}'::jsonb) $$, '42501', NULL, 'not signed in: cannot book');

-- ===== paused shop, deactivated person =====
SELECT pg_temp.as_postgres();
UPDATE shops SET status = 'suspended' WHERE id = :kalyani;
SELECT pg_temp.act_as(:bridal_owner);
SELECT is((SELECT count(*) FROM rentals), 0::bigint, 'a paused shop''s owner sees no bookings');
SELECT is(public.current_shop_id(), NULL::uuid, 'and has no shop');
SELECT pg_temp.as_postgres();
UPDATE shops SET status = 'active' WHERE id = :kalyani;
UPDATE profiles SET is_active = false WHERE id = :bridal_staff;
SELECT pg_temp.act_as(:bridal_staff);
SELECT is((SELECT count(*) FROM rentals), 0::bigint, 'a deactivated person sees nothing');
SELECT pg_temp.as_postgres();
UPDATE profiles SET is_active = true WHERE id = :bridal_staff;

-- ===== rules about the database itself (a future table or function that breaks them fails here) =====
SELECT is((SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity), 0::bigint, 'every table has row rules switched on');
SELECT is((SELECT count(*) FROM information_schema.role_table_grants WHERE grantee = 'anon' AND table_schema = 'public'), 0::bigint, 'the signed-out role has no table rights');
SELECT is((SELECT count(*) FROM information_schema.role_table_grants WHERE grantee = 'authenticated' AND table_schema = 'public'
           AND privilege_type IN ('TRUNCATE', 'TRIGGER', 'REFERENCES')), 0::bigint, 'signed-in people cannot truncate or add triggers');
SELECT is((SELECT count(*) FROM information_schema.routine_privileges WHERE grantee IN ('anon', 'PUBLIC') AND routine_schema = 'public'), 0::bigint, 'no database function is open to the signed-out');
SELECT is((SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.prosecdef AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%')), 0::bigint,
          'every privileged function pins its search path');
SELECT is((SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'r'
             AND has_table_privilege('authenticated', c.oid, 'INSERT')
             AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polpermissive AND p.polcmd IN ('a', '*'))), 0::bigint,
          'no table is writable without a rule that allows writing');

-- ===== Zypher's private notes =====
SELECT pg_temp.act_as(:bridal_owner);
SELECT throws_ok($$ SELECT notes FROM shops $$, '42501', NULL, 'a shop cannot read Zypher''s notes about it');
SELECT lives_ok($$ SELECT id, name, plan, monthly_fee, settings FROM shops $$, 'but can read its own shop details');
SELECT pg_temp.as_postgres();

-- ===== Zypher's audit view =====
SELECT pg_temp.as_postgres();
INSERT INTO audit_log (shop_id, via, action, table_name, reason, old_data, new_data) VALUES ('5a000000-0000-0000-0000-000000000001', 'app', 'update', 'payments', 'QA correction', '{"amount": 100}', '{"amount": 90}');
INSERT INTO audit_log (shop_id, via, action, table_name) VALUES ('5a000000-0000-0000-0000-000000000001', 'app', 'setup_update', 'branches');
SELECT pg_temp.act_as(:zypher);
SELECT is((SELECT count(*) FROM audit_log WHERE table_name = 'payments'), 0::bigint, 'Zypher''s audit view hides money corrections');
SELECT cmp_ok((SELECT count(*) FROM audit_log WHERE table_name = 'branches'), '>', 0::bigint, 'but shows setup changes');
SELECT pg_temp.as_postgres();

-- ===== two-step sign-in =====
UPDATE platform_settings SET require_mfa = true;
SELECT pg_temp.act_as(:zypher, 'aal1');
SELECT is(public.mfa_required(), true, 'Zypher with only a password must still enter a code');
SELECT is(public.is_platform_admin(), false, 'and is not Zypher yet');
SELECT is((SELECT count(*) FROM branches), 0::bigint, 'and reaches no shop setup');
SELECT pg_temp.act_as(:zypher, 'aal2');
SELECT is(public.is_platform_admin(), true, 'with the code Zypher works');
SELECT throws_ok($$ UPDATE platform_settings SET require_mfa = false $$, '42501', NULL, 'and cannot switch two-step sign-in off');
SELECT pg_temp.act_as(:bridal_support, 'aal1');
SELECT is(public.current_shop_id(), NULL::uuid, 'a support login with only a password has no shop');
SELECT pg_temp.act_as(:bridal_support, 'aal2');
SELECT is(public.current_shop_id(), :kalyani::uuid, 'with the code it works in its shop');
SELECT pg_temp.act_as(:bridal_owner, 'aal1');
SELECT is(public.mfa_required(), false, 'a shop owner is not forced to use it');

SELECT * FROM finish();
ROLLBACK;
