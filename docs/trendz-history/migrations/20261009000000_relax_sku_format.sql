ALTER TABLE "public"."products" DROP CONSTRAINT IF EXISTS "chk_product_sku_format";
ALTER TABLE "public"."products" ADD CONSTRAINT "chk_product_sku_format" CHECK (sku ~ '^[A-Z]{2,6}-[0-9]{3,4}(-[A-Za-z0-9]+)*$');

ALTER TABLE "public"."product_variations" DROP CONSTRAINT IF EXISTS "chk_variation_sku_format";
ALTER TABLE "public"."product_variations" ADD CONSTRAINT "chk_variation_sku_format" CHECK (sku ~ '^[A-Z]{2,6}-[0-9]{3,4}(-[A-Za-z0-9]+)*$');

ALTER TABLE "public"."categories" DROP CONSTRAINT IF EXISTS "chk_category_base_sku_format";
ALTER TABLE "public"."categories" ADD CONSTRAINT "chk_category_base_sku_format" CHECK (base_sku ~ '^[A-Z]{2,6}$');
