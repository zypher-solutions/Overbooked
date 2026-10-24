-- Local demo data only. Runs after the migrations on `npx supabase db reset`.
-- Two shops, so shop isolation can be seen and tested. Both use the SKU SU-001 on purpose.
--
-- Logins (local only, never reuse elsewhere), all with password  Overbooked-Demo-2026!
--   zypher@overbooked.test     super_admin (Zypher; starts inside Demo Rentals)
--   owner@demo.test            owner    Demo Rentals (Pro plan)
--   manager@demo.test          manager  Demo Rentals, Main Street branch
--   staff@demo.test            staff    Demo Rentals, Main Street branch
--   owner@second.test          owner    Second Shop (Starter plan)
--   staff@second.test          staff    Second Shop

-- ---- shops ----
INSERT INTO public.shops (id, name, slug, token_prefix, plan, phone, paid_until) VALUES
  ('5a000000-0000-0000-0000-000000000001', 'Demo Rentals', 'demo', 'DEM', 'pro', '9000000001', CURRENT_DATE + 30),
  ('5a000000-0000-0000-0000-000000000002', 'Second Shop', 'second', 'SEC', 'starter', '9000000002', CURRENT_DATE + 30);

-- ---- branches ----
INSERT INTO public.branches (id, shop_id, name, slug, address, phone, is_active) VALUES
  ('11111111-1111-1111-1111-111111111111', '5a000000-0000-0000-0000-000000000001', 'Main Street', 'main-street', '12 Main Street', '9000000011', true),
  ('22222222-2222-2222-2222-222222222222', '5a000000-0000-0000-0000-000000000001', 'City Centre', 'city-centre', '4 City Centre Mall', '9000000012', true),
  ('33333333-3333-3333-3333-333333333333', '5a000000-0000-0000-0000-000000000002', 'Market Road', 'market-road', '7 Market Road', '9000000021', true);

-- ---- users (handle_new_user creates an inactive profile with no shop for each) ----
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
SELECT '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
       crypt('Overbooked-Demo-2026!', gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', u.full_name),
       now(), now(), '', '', '', ''
FROM (VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'zypher@overbooked.test', 'Zypher Admin'),
  ('aaaaaaaa-0000-0000-0000-000000000002'::uuid, 'owner@demo.test', 'Demo Owner'),
  ('aaaaaaaa-0000-0000-0000-000000000003'::uuid, 'manager@demo.test', 'Demo Manager'),
  ('aaaaaaaa-0000-0000-0000-000000000004'::uuid, 'staff@demo.test', 'Demo Staff'),
  ('aaaaaaaa-0000-0000-0000-000000000005'::uuid, 'owner@second.test', 'Second Owner'),
  ('aaaaaaaa-0000-0000-0000-000000000006'::uuid, 'staff@second.test', 'Second Staff')
) AS u(id, email, full_name);

INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
SELECT gen_random_uuid(), u.id, u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
FROM auth.users u
WHERE u.email LIKE '%.test';

UPDATE public.profiles SET role = 'super_admin', is_active = true, shop_id = NULL,
       active_shop_id = '5a000000-0000-0000-0000-000000000001'
WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';

UPDATE public.profiles p SET role = v.role, shop_id = v.shop_id, branch_id = v.branch_id, is_active = true
FROM (VALUES
  ('aaaaaaaa-0000-0000-0000-000000000002'::uuid, 'owner', '5a000000-0000-0000-0000-000000000001'::uuid, NULL::uuid),
  ('aaaaaaaa-0000-0000-0000-000000000003'::uuid, 'manager', '5a000000-0000-0000-0000-000000000001'::uuid, '11111111-1111-1111-1111-111111111111'::uuid),
  ('aaaaaaaa-0000-0000-0000-000000000004'::uuid, 'staff', '5a000000-0000-0000-0000-000000000001'::uuid, '11111111-1111-1111-1111-111111111111'::uuid),
  ('aaaaaaaa-0000-0000-0000-000000000005'::uuid, 'owner', '5a000000-0000-0000-0000-000000000002'::uuid, NULL::uuid),
  ('aaaaaaaa-0000-0000-0000-000000000006'::uuid, 'staff', '5a000000-0000-0000-0000-000000000002'::uuid, '33333333-3333-3333-3333-333333333333'::uuid)
) AS v(id, role, shop_id, branch_id)
WHERE p.id = v.id;

-- ---- catalog ----
INSERT INTO public.categories (id, shop_id, name, base_sku) VALUES
  ('c0000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001', 'Suits', 'SU'),
  ('c0000000-0000-0000-0000-000000000002', '5a000000-0000-0000-0000-000000000001', 'Sarees', 'SA'),
  ('c0000000-0000-0000-0000-000000000003', '5a000000-0000-0000-0000-000000000002', 'Suits', 'SU');

INSERT INTO public.products (id, shop_id, name, sku, description, category_id, purchase_price, attributes) VALUES
  ('d0000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001', 'Bridal Suit', 'SU-001', 'Demo product',
   'c0000000-0000-0000-0000-000000000001', 15000, '[{"name":"Color","values":["Red"]},{"name":"Size","values":["M","L"]}]'),
  ('d0000000-0000-0000-0000-000000000002', '5a000000-0000-0000-0000-000000000001', 'Silk Saree', 'SA-001', 'Demo product',
   'c0000000-0000-0000-0000-000000000002', 8000, '[{"name":"Color","values":["Gold"]},{"name":"Size","values":["Free"]}]'),
  ('d0000000-0000-0000-0000-000000000003', '5a000000-0000-0000-0000-000000000002', 'Groom Sherwani', 'SU-001', 'Demo product',
   'c0000000-0000-0000-0000-000000000003', 12000, '[{"name":"Color","values":["Cream"]},{"name":"Size","values":["L"]}]');

INSERT INTO public.product_variations (id, shop_id, product_id, name, sku, daily_rate, attributes) VALUES
  ('e0000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Bridal Suit - Red - M', 'SU-001-RED-M', 999, '{"Color":"Red","Size":"M"}'),
  ('e0000000-0000-0000-0000-000000000002', '5a000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Bridal Suit - Red - L', 'SU-001-RED-L', 999, '{"Color":"Red","Size":"L"}'),
  ('e0000000-0000-0000-0000-000000000003', '5a000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', 'Silk Saree - Gold - Free', 'SA-001-GOLD-FREE', 799, '{"Color":"Gold","Size":"Free"}'),
  ('e0000000-0000-0000-0000-000000000004', '5a000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000003', 'Groom Sherwani - Cream - L', 'SU-001-CREAM-L', 1299, '{"Color":"Cream","Size":"L"}');

-- physical units: <variation sku>-NNN, numbered across a shop's branches like the app does
INSERT INTO public.inventory_items (shop_id, product_id, variation_id, branch_id, item_sku)
SELECT v.shop_id, v.product_id, v.id, s.branch_id, v.sku || '-' || lpad((s.offset_n + g)::text, 3, '0')
FROM (VALUES
  ('e0000000-0000-0000-0000-000000000001'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, 0, 3),
  ('e0000000-0000-0000-0000-000000000001'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 3, 2),
  ('e0000000-0000-0000-0000-000000000002'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, 0, 2),
  ('e0000000-0000-0000-0000-000000000003'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, 0, 2),
  ('e0000000-0000-0000-0000-000000000003'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 2, 1),
  ('e0000000-0000-0000-0000-000000000004'::uuid, '33333333-3333-3333-3333-333333333333'::uuid, 0, 2)
) AS s(variation_id, branch_id, offset_n, qty)
JOIN public.product_variations v ON v.id = s.variation_id
CROSS JOIN LATERAL generate_series(1, s.qty) AS g;

INSERT INTO public.product_stock (shop_id, product_id, variation_id, branch_id, quantity)
SELECT shop_id, product_id, variation_id, branch_id, COUNT(*)
FROM public.inventory_items
GROUP BY shop_id, product_id, variation_id, branch_id;
