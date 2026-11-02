-- Local development data. Runs after the migrations on `npx supabase db reset`.
-- One shop per business template and their logins, with NO products, pieces, customers or bookings:
-- add those in the app. (The tests load their own demo products from test_fixtures.sql.)
--
-- Logins (local only, never reuse elsewhere), all with password  Overbooked-Demo-2026!
--   zypher@overbooked.test   super_admin (Zypher; starts inside Kalyani Bridal)
--   owner@bridal.test        owner    Kalyani Bridal (Pro plan, 2 branches)
--   manager@bridal.test      manager  Kalyani Bridal, MG Road branch
--   staff@bridal.test        staff    Kalyani Bridal, MG Road branch
--   support@bridal.test      support  Zypher's login for Kalyani Bridal only (owner-like inside that shop, no money corrections)
--   owner@groom.test         owner    Raja Groom Wear (Starter)
--   staff@groom.test         staff    Raja Groom Wear
--   owner@resort.test        owner    Green Valley Resort (Starter)
--   staff@resort.test        staff    Green Valley Resort
--   owner@car.test           owner    Kochi Drive Cars (Starter)
--   staff@car.test           staff    Kochi Drive Cars
--   owner@bike.test          owner    Munnar Bike Rentals (Starter)
--   staff@bike.test          staff    Munnar Bike Rentals
--
-- Id scheme: shops 5a..0N, branches b0..0N, categories c0..0N, products d0.., variations e0.., users aa..

-- ---- shops ----
INSERT INTO public.shops (id, name, slug, token_prefix, business_types, plan, monthly_fee, phone, address, paid_until, settings) VALUES
  ('5a000000-0000-0000-0000-000000000001', 'Kalyani Bridal', 'kalyani-bridal', 'KAL', ARRAY['clothing'], 'pro', 899, '9000000001', 'MG Road, Kochi', CURRENT_DATE + 30, '{}'),
  ('5a000000-0000-0000-0000-000000000002', 'Raja Groom Wear', 'raja-groom', 'RAJ', ARRAY['clothing'], 'starter', 599, '9000000002', 'Broadway, Kochi', CURRENT_DATE + 30, '{}'),
  ('5a000000-0000-0000-0000-000000000003', 'Green Valley Resort', 'green-valley', 'GVR', ARRAY['resort'], 'starter', 599, '9000000003', 'Vythiri, Wayanad', CURRENT_DATE + 30,
   '{"check_in_time": "14:00", "check_out_time": "11:00"}'),
  ('5a000000-0000-0000-0000-000000000004', 'Kochi Drive Cars', 'kochi-drive', 'KDC', ARRAY['car'], 'starter', 599, '9000000004', 'Edappally, Kochi', CURRENT_DATE + 30,
   '{"grace_minutes": 60, "require_licence": true}'),
  ('5a000000-0000-0000-0000-000000000005', 'Munnar Bike Rentals', 'munnar-bikes', 'MBR', ARRAY['bike'], 'starter', 599, '9000000005', 'Old Munnar', CURRENT_DATE - 3,
   '{"grace_minutes": 30}');

INSERT INTO public.branches (id, shop_id, name, slug, address, phone) VALUES
  ('b0000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001', 'MG Road', 'mg-road', 'MG Road, Kochi', '9000000011'),
  ('b0000000-0000-0000-0000-000000000002', '5a000000-0000-0000-0000-000000000001', 'Thrissur', 'thrissur', 'Round North, Thrissur', '9000000012'),
  ('b0000000-0000-0000-0000-000000000003', '5a000000-0000-0000-0000-000000000002', 'Broadway', 'broadway', 'Broadway, Kochi', '9000000021'),
  ('b0000000-0000-0000-0000-000000000004', '5a000000-0000-0000-0000-000000000003', 'Vythiri', 'vythiri', 'Vythiri, Wayanad', '9000000031'),
  ('b0000000-0000-0000-0000-000000000005', '5a000000-0000-0000-0000-000000000004', 'Edappally', 'edappally', 'Edappally, Kochi', '9000000041'),
  ('b0000000-0000-0000-0000-000000000006', '5a000000-0000-0000-0000-000000000005', 'Old Munnar', 'old-munnar', 'Old Munnar', '9000000051');

-- Zypher's record of the shops' payments (receipt numbers by Indian financial year)
INSERT INTO public.shop_payments (shop_id, receipt_no, kind, amount, paid_on, method, period_to, note) VALUES
  ('5a000000-0000-0000-0000-000000000001', 'ZYP-DEMO-0001', 'installation', 15000, CURRENT_DATE - 60, 'bank_transfer', NULL, 'One-time installation'),
  ('5a000000-0000-0000-0000-000000000001', 'ZYP-DEMO-0002', 'subscription', 1798, CURRENT_DATE - 30, 'bank_transfer', CURRENT_DATE + 30, 'Two months'),
  ('5a000000-0000-0000-0000-000000000005', 'ZYP-DEMO-0003', 'installation', 12000, CURRENT_DATE - 33, 'upi', NULL, 'One-time installation'),
  ('5a000000-0000-0000-0000-000000000005', 'ZYP-DEMO-0004', 'subscription', 599, CURRENT_DATE - 33, 'upi', CURRENT_DATE - 3, 'First month');

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
  ('aaaaaaaa-0000-0000-0000-000000000011'::uuid, 'owner@bridal.test', 'Bridal Owner'),
  ('aaaaaaaa-0000-0000-0000-000000000012'::uuid, 'manager@bridal.test', 'Bridal Manager'),
  ('aaaaaaaa-0000-0000-0000-000000000013'::uuid, 'staff@bridal.test', 'Bridal Staff'),
  ('aaaaaaaa-0000-0000-0000-000000000014'::uuid, 'support@bridal.test', 'Zypher Support (Kalyani)'),
  ('aaaaaaaa-0000-0000-0000-000000000021'::uuid, 'owner@groom.test', 'Groom Owner'),
  ('aaaaaaaa-0000-0000-0000-000000000022'::uuid, 'staff@groom.test', 'Groom Staff'),
  ('aaaaaaaa-0000-0000-0000-000000000031'::uuid, 'owner@resort.test', 'Resort Owner'),
  ('aaaaaaaa-0000-0000-0000-000000000032'::uuid, 'staff@resort.test', 'Resort Staff'),
  ('aaaaaaaa-0000-0000-0000-000000000041'::uuid, 'owner@car.test', 'Car Owner'),
  ('aaaaaaaa-0000-0000-0000-000000000042'::uuid, 'staff@car.test', 'Car Staff'),
  ('aaaaaaaa-0000-0000-0000-000000000051'::uuid, 'owner@bike.test', 'Bike Owner'),
  ('aaaaaaaa-0000-0000-0000-000000000052'::uuid, 'staff@bike.test', 'Bike Staff')
) AS u(id, email, full_name);

INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
SELECT gen_random_uuid(), u.id, u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
FROM auth.users u
WHERE u.email LIKE '%.test';

UPDATE public.profiles SET role = 'super_admin', is_active = true, shop_id = NULL
WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';

UPDATE public.profiles p SET role = v.role, shop_id = v.shop_id, branch_id = v.branch_id, is_active = true
FROM (VALUES
  ('aaaaaaaa-0000-0000-0000-000000000011'::uuid, 'owner',   '5a000000-0000-0000-0000-000000000001'::uuid, NULL::uuid),
  ('aaaaaaaa-0000-0000-0000-000000000012'::uuid, 'manager', '5a000000-0000-0000-0000-000000000001'::uuid, 'b0000000-0000-0000-0000-000000000001'::uuid),
  ('aaaaaaaa-0000-0000-0000-000000000013'::uuid, 'staff',   '5a000000-0000-0000-0000-000000000001'::uuid, 'b0000000-0000-0000-0000-000000000001'::uuid),
  ('aaaaaaaa-0000-0000-0000-000000000014'::uuid, 'support', '5a000000-0000-0000-0000-000000000001'::uuid, NULL),
  ('aaaaaaaa-0000-0000-0000-000000000021'::uuid, 'owner',   '5a000000-0000-0000-0000-000000000002'::uuid, NULL),
  ('aaaaaaaa-0000-0000-0000-000000000022'::uuid, 'staff',   '5a000000-0000-0000-0000-000000000002'::uuid, 'b0000000-0000-0000-0000-000000000003'::uuid),
  ('aaaaaaaa-0000-0000-0000-000000000031'::uuid, 'owner',   '5a000000-0000-0000-0000-000000000003'::uuid, NULL),
  ('aaaaaaaa-0000-0000-0000-000000000032'::uuid, 'staff',   '5a000000-0000-0000-0000-000000000003'::uuid, 'b0000000-0000-0000-0000-000000000004'::uuid),
  ('aaaaaaaa-0000-0000-0000-000000000041'::uuid, 'owner',   '5a000000-0000-0000-0000-000000000004'::uuid, NULL),
  ('aaaaaaaa-0000-0000-0000-000000000042'::uuid, 'staff',   '5a000000-0000-0000-0000-000000000004'::uuid, 'b0000000-0000-0000-0000-000000000005'::uuid),
  ('aaaaaaaa-0000-0000-0000-000000000051'::uuid, 'owner',   '5a000000-0000-0000-0000-000000000005'::uuid, NULL),
  ('aaaaaaaa-0000-0000-0000-000000000052'::uuid, 'staff',   '5a000000-0000-0000-0000-000000000005'::uuid, 'b0000000-0000-0000-0000-000000000006'::uuid)
) AS v(id, role, shop_id, branch_id)
WHERE p.id = v.id;

-- ---- catalog: one category per shop, from its template ----
INSERT INTO public.categories (id, shop_id, name, template_key, sku_prefix) VALUES
  ('c0000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001', 'Bridal wear', 'clothing', 'BR'),
  ('c0000000-0000-0000-0000-000000000002', '5a000000-0000-0000-0000-000000000002', 'Groom wear', 'clothing', 'GR'),
  ('c0000000-0000-0000-0000-000000000003', '5a000000-0000-0000-0000-000000000003', 'Rooms', 'resort', 'RM'),
  ('c0000000-0000-0000-0000-000000000004', '5a000000-0000-0000-0000-000000000004', 'Cars', 'car', 'CR'),
  ('c0000000-0000-0000-0000-000000000005', '5a000000-0000-0000-0000-000000000005', 'Bikes', 'bike', 'BK');


-- Local demo only: the demo logins have no authenticator app, so two-factor is off here.
-- Hosted databases keep the default (on) and nobody can change it from the app.
UPDATE public.platform_settings SET require_mfa = false;
