-- Overbooked v2 — SKU format for bridal and groom shops, as in TRENDZ.
--   category base SKU  2 to 6 capital letters (required)            e.g. BR
--   product SKU        base SKU, hyphen, 3 or 4 digits               e.g. BR-001
--   variation SKU      product SKU, then more parts after hyphens    e.g. BR-001-GOLD-M
-- Only for shops whose business types are all clothes. Checked when a SKU is added or changed, so SKUs a shop
-- already has are never refused when something else about the product changes.

CREATE OR REPLACE FUNCTION public._is_clothes_shop(p_shop_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT COALESCE(bool_and(t.kind = 'wearable'), false)
  FROM public.shops s JOIN public.business_templates t ON t.key = ANY (s.business_types)
  WHERE s.id = p_shop_id;
$$;

CREATE OR REPLACE FUNCTION public._check_sku_format()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  IF NOT public._is_clothes_shop(NEW.shop_id) THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'categories' THEN
    IF TG_OP = 'UPDATE' AND NEW.sku_prefix IS NOT DISTINCT FROM OLD.sku_prefix THEN
      RETURN NEW;
    END IF;
    IF NEW.sku_prefix IS NULL THEN
      RAISE EXCEPTION 'A category needs a base SKU of 2 to 6 capital letters (e.g. BR)';
    END IF;
  ELSE
    IF TG_OP = 'UPDATE' AND NEW.sku = OLD.sku THEN
      RETURN NEW;
    END IF;
    IF NEW.sku !~ '^[A-Z]{2,6}-[0-9]{3,4}(-[A-Za-z0-9]+)*$' THEN
      RAISE EXCEPTION 'SKU % is not allowed: use 2 to 6 capital letters, a hyphen, then 3 or 4 digits (e.g. BR-001), with more parts after hyphens for variations (e.g. BR-001-GOLD)', NEW.sku;
    END IF;
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public._is_clothes_shop(uuid), public._check_sku_format() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER check_sku_format BEFORE INSERT OR UPDATE OF sku ON public.products
  FOR EACH ROW EXECUTE FUNCTION public._check_sku_format();
CREATE TRIGGER check_sku_format BEFORE INSERT OR UPDATE OF sku ON public.product_variations
  FOR EACH ROW EXECUTE FUNCTION public._check_sku_format();
CREATE TRIGGER check_sku_format BEFORE INSERT OR UPDATE OF sku_prefix ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public._check_sku_format();
