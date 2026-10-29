-- SKU format of bridal and groom shops (like TRENDZ); other shops keep any SKU.
-- Run: npx supabase db reset && npx supabase test db   (uses the seeded demo shops; everything is rolled back)
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(10);

SELECT throws_like($$ INSERT INTO products (shop_id, category_id, name, sku) VALUES
    ('5a000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'QA bad', 'BR-LEH-009') $$,
  'SKU BR-LEH-009 is not allowed%', 'a clothes shop refuses BR-LEH-009');
SELECT lives_ok($$ INSERT INTO products (id, shop_id, category_id, name, sku) VALUES
    ('d0000000-0000-0000-0000-0000000000a1', '5a000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'QA good', 'BR-003') $$,
  'and takes BR-003');
SELECT throws_like($$ INSERT INTO product_variations (shop_id, product_id, name, sku) VALUES
    ('5a000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000000a1', 'QA', 'BRIDAL-RED') $$,
  'SKU BRIDAL-RED is not allowed%', 'a variation SKU must start with the product SKU pattern');
SELECT lives_ok($$ INSERT INTO product_variations (shop_id, product_id, name, sku) VALUES
    ('5a000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000000a1', 'QA', 'BR-003-RED-M') $$,
  'a variation SKU like BR-003-RED-M is fine');
SELECT throws_like($$ UPDATE products SET sku = 'br-9' WHERE id = 'd0000000-0000-0000-0000-0000000000a1' $$,
  'SKU br-9 is not allowed%', 'a SKU cannot be changed to a wrong one');

-- a SKU that was there before the rule is left alone when something else changes
ALTER TABLE products DISABLE TRIGGER check_sku_format;
INSERT INTO products (id, shop_id, category_id, name, sku) VALUES
  ('d0000000-0000-0000-0000-0000000000a2', '5a000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'QA old', 'OLD-STYLE');
ALTER TABLE products ENABLE TRIGGER check_sku_format;
SELECT lives_ok($$ UPDATE products SET name = 'QA old renamed' WHERE id = 'd0000000-0000-0000-0000-0000000000a2' $$,
  'an older SKU does not block other changes');

SELECT throws_like($$ INSERT INTO categories (shop_id, name, template_key) VALUES
    ('5a000000-0000-0000-0000-000000000001', 'QA no prefix', 'bridal') $$,
  'A category needs a base SKU%', 'a clothes category needs its base SKU');
SELECT lives_ok($$ INSERT INTO categories (shop_id, name, template_key) VALUES
    ('5a000000-0000-0000-0000-000000000003', 'QA suites', 'resort') $$,
  'a resort category does not');
SELECT lives_ok($$ INSERT INTO products (shop_id, category_id, name, sku) VALUES
    ('5a000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 'QA room', 'FREE-FORM-1') $$,
  'a resort keeps its own style of SKU');
SELECT is(public._is_clothes_shop('5a000000-0000-0000-0000-000000000002'), true, 'the groom shop counts as clothes');

SELECT * FROM finish();
ROLLBACK;
