-- Each shop's own attributes and preferred values (migration 030).
-- Run: npx supabase db reset && npx supabase test db   (uses the seeded demo shops; everything is rolled back)
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(12);

\set kalyani '''5a000000-0000-0000-0000-000000000001'''
\set groom '''5a000000-0000-0000-0000-000000000002'''
\set resort '''5a000000-0000-0000-0000-000000000003'''
\set bridal_owner '''aaaaaaaa-0000-0000-0000-000000000011'''
\set bridal_staff '''aaaaaaaa-0000-0000-0000-000000000013'''

CREATE FUNCTION pg_temp.act_as(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;
CREATE FUNCTION pg_temp.as_postgres() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.act_as(uuid), pg_temp.as_postgres() TO authenticated;

SELECT id AS color FROM shop_attributes WHERE shop_id = :kalyani AND key = 'color' \gset
SELECT id AS product, sku AS psku FROM products WHERE shop_id = :kalyani ORDER BY sku LIMIT 1 \gset

-- ===== a shop starts with its business type's attributes and suggestions =====
SELECT is((SELECT array_agg(key ORDER BY sort) FROM shop_attributes WHERE shop_id = :kalyani), ARRAY['color', 'size'],
  'a clothing shop starts with Colour and Size, in order');
SELECT ok((SELECT count(*) FROM shop_attribute_values WHERE attribute_id = :'color' AND value = 'Royal Blue') = 1,
  'with the suggested colours');
SELECT is((SELECT count(*) FROM shop_attributes WHERE shop_id = :resort),
  (SELECT count(*) FROM business_templates t, jsonb_array_elements(t.variation_fields) WHERE t.key = 'resort'),
  'a shop made after the migration gets its type''s attributes too');
SELECT is((SELECT count(*) FROM shop_attributes WHERE shop_id = :kalyani AND sku_position IS NULL), 0::bigint,
  'every starting attribute is in the SKU, as before');

-- ===== a value typed on a product joins the list once =====
INSERT INTO product_variations (shop_id, product_id, name, sku, attributes)
VALUES (:kalyani, :'product', 'QA orange', :'psku' || '-QAORANGE', '{"color": "Orange", "sleeve": "Full"}');
SELECT is((SELECT count(*) FROM shop_attribute_values WHERE attribute_id = :'color' AND lower(value) = 'orange'), 1::bigint,
  'a new colour saved on a product is added to Colour');
INSERT INTO product_variations (shop_id, product_id, name, sku, attributes)
VALUES (:kalyani, :'product', 'QA orange 2', :'psku' || '-QAORANGE2', '{"color": "orange "}');
SELECT is((SELECT count(*) FROM shop_attribute_values WHERE attribute_id = :'color' AND lower(value) = 'orange'), 1::bigint,
  'the same colour in other capitals is not added twice');
SELECT is((SELECT count(*) FROM shop_attributes WHERE shop_id = :kalyani AND key = 'sleeve'), 0::bigint,
  'an attribute typed on one product does not become a shop attribute');

-- ===== who may change what =====
SELECT pg_temp.act_as(:bridal_owner);
SELECT lives_ok(format($$ INSERT INTO shop_attribute_values (shop_id, attribute_id, value) VALUES (%L, %L, 'QA Teal') $$, :kalyani, :'color'),
  'the owner adds a preferred value');
SELECT throws_ok(format($$ UPDATE shop_attributes SET key = 'colour' WHERE id = %L $$, :'color'), '42501', NULL,
  'an attribute''s key cannot be changed (products store it)');
SELECT throws_ok(format($$ DELETE FROM shop_attributes WHERE id = %L $$, :'color'), '42501', NULL,
  'an attribute is archived, not deleted');
SELECT is((SELECT count(*) FROM shop_attribute_values WHERE shop_id = :groom), 0::bigint,
  'another shop''s values are not visible');

SELECT pg_temp.act_as(:bridal_staff);
SELECT throws_ok(format($$ INSERT INTO shop_attributes (shop_id, key, label) VALUES (%L, 'length', 'Length') $$, :kalyani), '42501', NULL,
  'staff cannot add attributes');

SELECT pg_temp.as_postgres();
SELECT * FROM finish();
ROLLBACK;
