-- Local demo data only. Runs after the migrations on `npx supabase db reset`.
-- One demo shop per business template, so every flow can be tried and tested.
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

UPDATE public.profiles SET role = 'super_admin', is_active = true, shop_id = NULL,
       active_shop_id = '5a000000-0000-0000-0000-000000000001'
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

INSERT INTO public.products (id, shop_id, category_id, name, sku, description, purchase_price, replacement_value) VALUES
  ('d0000000-0000-0000-0000-000000000011', '5a000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Red bridal lehenga', 'BR-001', 'Hand-embroidered', 60000, 75000),
  ('d0000000-0000-0000-0000-000000000012', '5a000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Kanjivaram silk saree', 'BR-002', NULL, 25000, 30000),
  ('d0000000-0000-0000-0000-000000000021', '5a000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'Cream sherwani', 'GR-001', NULL, 18000, 22000),
  ('d0000000-0000-0000-0000-000000000022', '5a000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'Navy three-piece suit', 'GR-002', NULL, 12000, 15000),
  ('d0000000-0000-0000-0000-000000000031', '5a000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 'Deluxe cottage', 'RM-DLX', 'Valley view, private sit-out', 0, 0),
  ('d0000000-0000-0000-0000-000000000032', '5a000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 'Family villa', 'RM-VIL', 'Two bedrooms, kitchenette', 0, 0),
  ('d0000000-0000-0000-0000-000000000041', '5a000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000004', 'Maruti Swift', 'CR-SWIFT', NULL, 650000, 650000),
  ('d0000000-0000-0000-0000-000000000042', '5a000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000004', 'Toyota Innova Crysta', 'CR-INNOVA', NULL, 2000000, 2000000),
  ('d0000000-0000-0000-0000-000000000051', '5a000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000005', 'Royal Enfield Classic 350', 'BK-RE350', NULL, 200000, 200000),
  ('d0000000-0000-0000-0000-000000000052', '5a000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000005', 'Honda Activa', 'BK-ACTIVA', NULL, 80000, 80000);

INSERT INTO public.product_variations (id, shop_id, product_id, name, sku, attributes, base_occupancy, max_occupancy, km_included_per_day, turnaround) VALUES
  ('e0000000-0000-0000-0000-000000000011', '5a000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000011', 'M', 'BR-001-M', '{"color": "Red", "size": "M"}', NULL, NULL, NULL, '1 day'),
  ('e0000000-0000-0000-0000-000000000012', '5a000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000012', 'Gold', 'BR-002-GOLD', '{"color": "Gold", "size": "Free"}', NULL, NULL, NULL, '1 day'),
  ('e0000000-0000-0000-0000-000000000021', '5a000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000021', 'L', 'GR-001-L', '{"color": "Cream", "size": "L"}', NULL, NULL, NULL, '1 day'),
  ('e0000000-0000-0000-0000-000000000022', '5a000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000022', '40', 'GR-002-40', '{"color": "Navy", "size": "40"}', NULL, NULL, NULL, '1 day'),
  ('e0000000-0000-0000-0000-000000000031', '5a000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000031', 'Deluxe cottage', 'RM-DLX-KING', '{"bed_type": "King", "view": "Valley"}', 2, 4, NULL, '3 hours'),
  ('e0000000-0000-0000-0000-000000000032', '5a000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000032', 'Family villa', 'RM-VIL-2BR', '{"bed_type": "2 x Queen", "view": "Garden"}', 4, 6, NULL, '3 hours'),
  ('e0000000-0000-0000-0000-000000000041', '5a000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000041', 'VXi manual', 'CR-SWIFT-MT', '{"fuel_type": "Petrol", "transmission": "Manual", "seats": 5}', NULL, NULL, 250, '1 hour'),
  ('e0000000-0000-0000-0000-000000000042', '5a000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000042', 'Automatic', 'CR-INNOVA-AT', '{"fuel_type": "Diesel", "transmission": "Automatic", "seats": 7}', NULL, NULL, 300, '1 hour'),
  ('e0000000-0000-0000-0000-000000000051', '5a000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000051', 'Standard', 'BK-RE350-STD', '{"engine_cc": 349, "fuel_type": "Petrol"}', NULL, NULL, 150, '30 minutes'),
  ('e0000000-0000-0000-0000-000000000052', '5a000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000052', '6G', 'BK-ACTIVA-6G', '{"engine_cc": 110, "fuel_type": "Petrol"}', NULL, NULL, 100, '30 minutes');

INSERT INTO public.variation_rates (shop_id, variation_id, rate_type, amount)
SELECT v.shop_id, v.id, r.rate_type, r.amount
FROM (VALUES
  ('e0000000-0000-0000-0000-000000000011'::uuid, 'day', 2500), ('e0000000-0000-0000-0000-000000000011'::uuid, 'late_penalty', 500),
  ('e0000000-0000-0000-0000-000000000012'::uuid, 'day', 1200), ('e0000000-0000-0000-0000-000000000012'::uuid, 'late_penalty', 300),
  ('e0000000-0000-0000-0000-000000000021'::uuid, 'day', 1500), ('e0000000-0000-0000-0000-000000000021'::uuid, 'late_penalty', 300),
  ('e0000000-0000-0000-0000-000000000022'::uuid, 'day', 1000),
  ('e0000000-0000-0000-0000-000000000031'::uuid, 'night', 4500), ('e0000000-0000-0000-0000-000000000031'::uuid, 'extra_person', 800),
  ('e0000000-0000-0000-0000-000000000031'::uuid, 'extra_hour', 300),
  ('e0000000-0000-0000-0000-000000000032'::uuid, 'night', 9000), ('e0000000-0000-0000-0000-000000000032'::uuid, 'extra_person', 1000),
  ('e0000000-0000-0000-0000-000000000041'::uuid, 'hour', 200), ('e0000000-0000-0000-0000-000000000041'::uuid, 'day', 1800),
  ('e0000000-0000-0000-0000-000000000041'::uuid, 'extra_km', 10), ('e0000000-0000-0000-0000-000000000041'::uuid, 'extra_hour', 150),
  ('e0000000-0000-0000-0000-000000000041'::uuid, 'driver_day', 800), ('e0000000-0000-0000-0000-000000000041'::uuid, 'late_penalty', 500),
  ('e0000000-0000-0000-0000-000000000042'::uuid, 'hour', 400), ('e0000000-0000-0000-0000-000000000042'::uuid, 'day', 3500),
  ('e0000000-0000-0000-0000-000000000042'::uuid, 'extra_km', 15), ('e0000000-0000-0000-0000-000000000042'::uuid, 'extra_hour', 300),
  ('e0000000-0000-0000-0000-000000000042'::uuid, 'driver_day', 1000),
  ('e0000000-0000-0000-0000-000000000051'::uuid, 'hour', 100), ('e0000000-0000-0000-0000-000000000051'::uuid, 'day', 1200),
  ('e0000000-0000-0000-0000-000000000051'::uuid, 'extra_km', 5), ('e0000000-0000-0000-0000-000000000051'::uuid, 'extra_hour', 100),
  ('e0000000-0000-0000-0000-000000000051'::uuid, 'late_penalty', 300),
  ('e0000000-0000-0000-0000-000000000052'::uuid, 'hour', 50), ('e0000000-0000-0000-0000-000000000052'::uuid, 'day', 500),
  ('e0000000-0000-0000-0000-000000000052'::uuid, 'extra_km', 3), ('e0000000-0000-0000-0000-000000000052'::uuid, 'extra_hour', 50)
) AS r(variation_id, rate_type, amount)
JOIN public.product_variations v ON v.id = r.variation_id;

INSERT INTO public.units (shop_id, product_id, variation_id, branch_id, code, attributes, odometer)
SELECT v.shop_id, v.product_id, v.id, u.branch_id, u.code, u.attributes::jsonb, u.odometer
FROM (VALUES
  ('e0000000-0000-0000-0000-000000000011'::uuid, 'b0000000-0000-0000-0000-000000000001'::uuid, 'BR-001-M-1', '{}', NULL::integer),
  ('e0000000-0000-0000-0000-000000000011'::uuid, 'b0000000-0000-0000-0000-000000000002'::uuid, 'BR-001-M-2', '{}', NULL),
  ('e0000000-0000-0000-0000-000000000012'::uuid, 'b0000000-0000-0000-0000-000000000001'::uuid, 'BR-002-GOLD-1', '{}', NULL),
  ('e0000000-0000-0000-0000-000000000012'::uuid, 'b0000000-0000-0000-0000-000000000001'::uuid, 'BR-002-GOLD-2', '{}', NULL),
  ('e0000000-0000-0000-0000-000000000021'::uuid, 'b0000000-0000-0000-0000-000000000003'::uuid, 'GR-001-L-1', '{}', NULL),
  ('e0000000-0000-0000-0000-000000000021'::uuid, 'b0000000-0000-0000-0000-000000000003'::uuid, 'GR-001-L-2', '{}', NULL),
  ('e0000000-0000-0000-0000-000000000022'::uuid, 'b0000000-0000-0000-0000-000000000003'::uuid, 'GR-002-40-1', '{}', NULL),
  ('e0000000-0000-0000-0000-000000000031'::uuid, 'b0000000-0000-0000-0000-000000000004'::uuid, '101', '{"floor": "Block A"}', NULL),
  ('e0000000-0000-0000-0000-000000000031'::uuid, 'b0000000-0000-0000-0000-000000000004'::uuid, '102', '{"floor": "Block A"}', NULL),
  ('e0000000-0000-0000-0000-000000000031'::uuid, 'b0000000-0000-0000-0000-000000000004'::uuid, '103', '{"floor": "Block B"}', NULL),
  ('e0000000-0000-0000-0000-000000000032'::uuid, 'b0000000-0000-0000-0000-000000000004'::uuid, 'V1', '{"floor": "Garden"}', NULL),
  ('e0000000-0000-0000-0000-000000000041'::uuid, 'b0000000-0000-0000-0000-000000000005'::uuid, 'KL-07-AB-1234', '{"registration_no": "KL-07-AB-1234", "colour": "White", "year": 2023}', 18250),
  ('e0000000-0000-0000-0000-000000000041'::uuid, 'b0000000-0000-0000-0000-000000000005'::uuid, 'KL-07-AB-5678', '{"registration_no": "KL-07-AB-5678", "colour": "Red", "year": 2024}', 6400),
  ('e0000000-0000-0000-0000-000000000042'::uuid, 'b0000000-0000-0000-0000-000000000005'::uuid, 'KL-07-CD-9012', '{"registration_no": "KL-07-CD-9012", "colour": "Silver", "year": 2022}', 41200),
  ('e0000000-0000-0000-0000-000000000051'::uuid, 'b0000000-0000-0000-0000-000000000006'::uuid, 'KL-68-E-1111', '{"registration_no": "KL-68-E-1111", "colour": "Black", "year": 2023}', 9100),
  ('e0000000-0000-0000-0000-000000000051'::uuid, 'b0000000-0000-0000-0000-000000000006'::uuid, 'KL-68-E-2222', '{"registration_no": "KL-68-E-2222", "colour": "Green", "year": 2024}', 3050),
  ('e0000000-0000-0000-0000-000000000052'::uuid, 'b0000000-0000-0000-0000-000000000006'::uuid, 'KL-68-F-3333', '{"registration_no": "KL-68-F-3333", "colour": "Grey", "year": 2022}', 15800)
) AS u(variation_id, branch_id, code, attributes, odometer)
JOIN public.product_variations v ON v.id = u.variation_id;

-- each shop's template add-ons, with demo prices
INSERT INTO public.add_ons (shop_id, name, basis, amount, template_keys) VALUES
  ('5a000000-0000-0000-0000-000000000003', 'Breakfast', 'per_person_night', 300, ARRAY['resort']),
  ('5a000000-0000-0000-0000-000000000003', 'All meals', 'per_person_night', 900, ARRAY['resort']),
  ('5a000000-0000-0000-0000-000000000003', 'Extra bed', 'per_unit_day', 600, ARRAY['resort']),
  ('5a000000-0000-0000-0000-000000000003', 'Campfire', 'per_rental', 1500, ARRAY['resort']),
  ('5a000000-0000-0000-0000-000000000004', 'Child seat', 'per_day', 200, ARRAY['car']),
  ('5a000000-0000-0000-0000-000000000004', 'Delivery and collection', 'per_rental', 500, ARRAY['car']),
  ('5a000000-0000-0000-0000-000000000005', 'Extra helmet', 'per_day', 100, ARRAY['bike']),
  ('5a000000-0000-0000-0000-000000000005', 'Delivery and collection', 'per_rental', 300, ARRAY['bike']);

INSERT INTO public.customers (shop_id, full_name, phone, email, id_type, id_number, licence_number, licence_expiry) VALUES
  ('5a000000-0000-0000-0000-000000000001', 'Anjali Menon', '9847000001', 'anjali@example.test', 'aadhaar', 'XXXX-XXXX-0001', NULL, NULL),
  ('5a000000-0000-0000-0000-000000000002', 'Arjun Nair', '9847000002', NULL, 'aadhaar', 'XXXX-XXXX-0002', NULL, NULL),
  ('5a000000-0000-0000-0000-000000000003', 'Priya Thomas', '9847000003', 'priya@example.test', 'passport', 'Z0000003', NULL, NULL),
  ('5a000000-0000-0000-0000-000000000004', 'Rahul Varma', '9847000004', NULL, 'driving_licence', 'KL0720190000004', 'KL0720190000004', CURRENT_DATE + 1000),
  ('5a000000-0000-0000-0000-000000000005', 'Sneha Pillai', '9847000005', NULL, 'driving_licence', 'KL6820210000005', 'KL6820210000005', CURRENT_DATE + 1500);

-- ---- one upcoming booking per shop, made through the engine as each owner ----
DO $$
DECLARE
  b RECORD;
  v_day date := CURRENT_DATE + 7;
BEGIN
  FOR b IN
    SELECT * FROM (VALUES
      ('aaaaaaaa-0000-0000-0000-000000000011'::uuid, 'b0000000-0000-0000-0000-000000000001'::uuid,
       '[{"variation_id": "e0000000-0000-0000-0000-000000000011", "qty": 1}]'::jsonb, '10:00'::time, 2, '11:00'::time, 1, 0, 5000, 2000),
      ('aaaaaaaa-0000-0000-0000-000000000021'::uuid, 'b0000000-0000-0000-0000-000000000003'::uuid,
       '[{"variation_id": "e0000000-0000-0000-0000-000000000021", "qty": 1}]', '10:00', 1, '18:00', 1, 0, 2000, 500),
      ('aaaaaaaa-0000-0000-0000-000000000031'::uuid, 'b0000000-0000-0000-0000-000000000004'::uuid,
       '[{"variation_id": "e0000000-0000-0000-0000-000000000031", "qty": 1}]', '14:00', 2, '11:00', 3, 1, 0, 4500),
      ('aaaaaaaa-0000-0000-0000-000000000041'::uuid, 'b0000000-0000-0000-0000-000000000005'::uuid,
       '[{"variation_id": "e0000000-0000-0000-0000-000000000041", "qty": 1}]', '09:00', 2, '13:00', 1, 0, 5000, 1000),
      ('aaaaaaaa-0000-0000-0000-000000000051'::uuid, 'b0000000-0000-0000-0000-000000000006'::uuid,
       '[{"variation_id": "e0000000-0000-0000-0000-000000000051", "qty": 1}]', '08:00', 1, '08:00', 1, 0, 2000, 500)
    ) AS t(owner, branch, lines, start_time, nights, end_time, adults, children, deposit, advance)
  LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', b.owner, 'role', 'authenticated')::text, true);
    PERFORM public.create_rental(jsonb_build_object(
      'branch_id', b.branch,
      'customer', jsonb_build_object('id', (SELECT c.id FROM public.customers c JOIN public.profiles p ON p.shop_id = c.shop_id WHERE p.id = b.owner LIMIT 1)),
      'start_at', ((v_day + b.start_time) AT TIME ZONE 'Asia/Kolkata'),
      'end_at', (((v_day + b.nights) + b.end_time) AT TIME ZONE 'Asia/Kolkata'),
      'adults', b.adults, 'children', b.children,
      'lines', b.lines,
      'deposit_agreed', b.deposit,
      'advance', jsonb_build_object('amount', b.advance, 'method', 'upi')));
  END LOOP;
  PERFORM set_config('request.jwt.claims', '', true);
END $$;
