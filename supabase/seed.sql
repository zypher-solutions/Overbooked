-- Local demo data only. Runs after the migrations on `npx supabase db reset`.
-- Logins (local only, never reuse elsewhere):
--   admin@overbooked.test    / Overbooked-Demo-2026!   super_admin (all branches)
--   owner@overbooked.test    / Overbooked-Demo-2026!   owner (all branches)
--   manager@overbooked.test  / Overbooked-Demo-2026!   manager at Main Street
--   staff@overbooked.test    / Overbooked-Demo-2026!   staff at Main Street

-- ---- branches ----
INSERT INTO public.branches (id, name, slug, address, phone, is_active) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Main Street', 'main-street', '12 Main Street', '9000000001', true),
  ('22222222-2222-2222-2222-222222222222', 'City Centre', 'city-centre', '4 City Centre Mall', '9000000002', true);

-- ---- users (handle_new_user creates an inactive profile for each) ----
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'admin@overbooked.test', crypt('Overbooked-Demo-2026!', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Demo Admin"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'staff@overbooked.test', crypt('Overbooked-Demo-2026!', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Demo Staff"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
   'owner@overbooked.test', crypt('Overbooked-Demo-2026!', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Demo Owner"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000004', 'authenticated', 'authenticated',
   'manager@overbooked.test', crypt('Overbooked-Demo-2026!', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Demo Manager"}', now(), now(), '', '', '', '');

INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
SELECT gen_random_uuid(), u.id, u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
FROM auth.users u
WHERE u.email LIKE '%@overbooked.test';

UPDATE public.profiles SET role = 'super_admin', is_active = true, branch_id = NULL
WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
UPDATE public.profiles SET role = 'staff', is_active = true, branch_id = '11111111-1111-1111-1111-111111111111'
WHERE id = 'aaaaaaaa-0000-0000-0000-000000000002';
UPDATE public.profiles SET role = 'owner', is_active = true, branch_id = NULL
WHERE id = 'aaaaaaaa-0000-0000-0000-000000000003';
UPDATE public.profiles SET role = 'manager', is_active = true, branch_id = '11111111-1111-1111-1111-111111111111'
WHERE id = 'aaaaaaaa-0000-0000-0000-000000000004';

-- ---- catalog ----
INSERT INTO public.categories (id, name, base_sku) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'Suits', 'SU'),
  ('c0000000-0000-0000-0000-000000000002', 'Sarees', 'SA');

INSERT INTO public.products (id, name, sku, description, category_id, purchase_price, attributes) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'Bridal Suit', 'SU-001', 'Demo product', 'c0000000-0000-0000-0000-000000000001', 15000,
   '[{"name":"Color","values":["Red"]},{"name":"Size","values":["M","L"]}]'),
  ('d0000000-0000-0000-0000-000000000002', 'Silk Saree', 'SA-001', 'Demo product', 'c0000000-0000-0000-0000-000000000002', 8000,
   '[{"name":"Color","values":["Gold"]},{"name":"Size","values":["Free"]}]');

INSERT INTO public.product_variations (id, product_id, name, sku, daily_rate, attributes) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Bridal Suit - Red - M', 'SU-001-RED-M', 999, '{"Color":"Red","Size":"M"}'),
  ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 'Bridal Suit - Red - L', 'SU-001-RED-L', 999, '{"Color":"Red","Size":"L"}'),
  ('e0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000002', 'Silk Saree - Gold - Free', 'SA-001-GOLD-FREE', 799, '{"Color":"Gold","Size":"Free"}');

-- physical units: <variation sku>-NNN, numbered across branches like the app does
INSERT INTO public.inventory_items (product_id, variation_id, branch_id, item_sku)
SELECT v.product_id, v.id, s.branch_id, v.sku || '-' || lpad((s.offset_n + g)::text, 3, '0')
FROM (VALUES
  ('e0000000-0000-0000-0000-000000000001'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, 0, 3),
  ('e0000000-0000-0000-0000-000000000001'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 3, 2),
  ('e0000000-0000-0000-0000-000000000002'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, 0, 2),
  ('e0000000-0000-0000-0000-000000000003'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, 0, 2),
  ('e0000000-0000-0000-0000-000000000003'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 2, 1)
) AS s(variation_id, branch_id, offset_n, qty)
JOIN public.product_variations v ON v.id = s.variation_id
CROSS JOIN LATERAL generate_series(1, s.qty) AS g;

INSERT INTO public.product_stock (product_id, variation_id, branch_id, quantity)
SELECT product_id, variation_id, branch_id, COUNT(*)
FROM public.inventory_items
GROUP BY product_id, variation_id, branch_id;
