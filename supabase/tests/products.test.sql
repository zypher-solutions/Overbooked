-- Saving a product with its pieces in one step: all or nothing, no duplicate piece codes, branch rules.
-- Run: npx supabase db reset && npx supabase test db   (uses the seeded demo shops; everything is rolled back)
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(11);

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
GRANT EXECUTE ON FUNCTION pg_temp.act_as(uuid), pg_temp.as_postgres() TO authenticated;
CREATE TEMP TABLE t_ids (name text PRIMARY KEY, id uuid);
GRANT ALL ON t_ids TO authenticated;

-- counter staff cannot save products
SELECT pg_temp.act_as(:bridal_staff);
SELECT throws_like($$ SELECT public.save_product('{"category_id": "c0000000-0000-0000-0000-000000000001", "name": "QA", "sku": "BR-901",
  "variations": [{"name": "Gold M", "sku": "BR-901-GOLD-M", "rates": {"day": "500"}}]}') $$,
  'Your role (staff) cannot do this', 'counter staff cannot save a product');

-- the owner creates a product with pieces in two branches
SELECT pg_temp.act_as(:bridal_owner);
SELECT lives_ok($$ SELECT public.save_product('{"category_id": "c0000000-0000-0000-0000-000000000001", "name": "QA Lehenga", "sku": "BR-901",
  "variations": [{"name": "Gold M", "sku": "BR-901-GOLD-M", "attributes": {"Colour": "Gold"}, "rates": {"day": "500"},
                  "stock": {"b0000000-0000-0000-0000-000000000001": 2, "b0000000-0000-0000-0000-000000000002": 1}}]}') $$,
  'the owner saves a product with stock for two branches');
INSERT INTO t_ids SELECT 'p', id FROM products WHERE sku = 'BR-901';
SELECT is((SELECT count(*) FROM units WHERE product_id = (SELECT id FROM t_ids WHERE name = 'p')), 3::bigint, 'three pieces were made');
SELECT is((SELECT array_agg(code ORDER BY code) FROM units WHERE product_id = (SELECT id FROM t_ids WHERE name = 'p')),
  ARRAY['BR-901-GOLD-M-1', 'BR-901-GOLD-M-2', 'BR-901-GOLD-M-3'], 'numbered one after the other');

-- saving again with a higher target adds only what is missing
SELECT lives_ok($$ SELECT public.save_product(jsonb_build_object('id', (SELECT id FROM t_ids WHERE name = 'p'),
  'category_id', 'c0000000-0000-0000-0000-000000000001', 'name', 'QA Lehenga', 'sku', 'BR-901',
  'variations', jsonb_build_array(jsonb_build_object('id', (SELECT id FROM product_variations WHERE sku = 'BR-901-GOLD-M'),
    'name', 'Gold M', 'sku', 'BR-901-GOLD-M', 'rates', '{"day": "500"}'::jsonb,
    'stock', '{"b0000000-0000-0000-0000-000000000001": 3, "b0000000-0000-0000-0000-000000000002": 1}'::jsonb)))) $$,
  'saving again with one more piece for MG Road');
SELECT is((SELECT count(*) FROM units WHERE product_id = (SELECT id FROM t_ids WHERE name = 'p')), 4::bigint, 'only one piece was added');
SELECT is((SELECT count(DISTINCT code) FROM units WHERE product_id = (SELECT id FROM t_ids WHERE name = 'p')), 4::bigint, 'with a new code');

-- all or nothing: a bad number of pieces creates no product
SELECT throws_like($$ SELECT public.save_product('{"category_id": "c0000000-0000-0000-0000-000000000001", "name": "QA Fail", "sku": "BR-902",
  "variations": [{"name": "Gold M", "sku": "BR-902-GOLD-M", "rates": {"day": "500"}, "stock": {"b0000000-0000-0000-0000-000000000001": 5000}}]}') $$,
  'Pieces per branch must be between 0 and 2000%', 'too many pieces is refused');
SELECT is((SELECT count(*) FROM products WHERE sku = 'BR-902'), 0::bigint, 'and the product was not left behind without pieces');

-- a manager makes pieces only in their own branch
SELECT pg_temp.act_as(:bridal_manager);
SELECT throws_like($$ SELECT public.save_product('{"category_id": "c0000000-0000-0000-0000-000000000001", "name": "QA Manager", "sku": "BR-903",
  "variations": [{"name": "Gold M", "sku": "BR-903-GOLD-M", "rates": {"day": "500"}, "stock": {"b0000000-0000-0000-0000-000000000002": 1}}]}') $$,
  'You can only work with your own branch', 'a manager cannot add pieces to another branch');
SELECT is((SELECT count(*) FROM products WHERE sku = 'BR-903'), 0::bigint, 'and nothing was saved');

SELECT * FROM finish();
ROLLBACK;
