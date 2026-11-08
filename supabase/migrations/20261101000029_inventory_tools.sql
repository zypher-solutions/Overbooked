-- Inventory tools (8 Nov 2026): MRP and a default security deposit per product, accessories linked to categories,
-- and earnings per product for the earnings report.
--
-- Products
--   mrp               the shop's selling price of the piece (shown, used nowhere in money rules)
--   security_deposit  the deposit a booking starts with for one piece; the booking form adds them up and staff can change it
-- Both are saved by save_product (the product form) and import_catalog (bulk add & edit, Excel/CSV import). They are
-- added by wrapping those functions, as 024 did: a call without the new keys leaves the saved values as they are.
--
-- Accessories (add_ons)
--   category_ids  categories the accessory is suggested for at booking; empty = every category
--   quantity      how many the shop owns (shown to staff); NULL = not counted
-- The price was already allowed to be 0, which the screens show as "free".

ALTER TABLE public.products
  ADD COLUMN mrp numeric(14,2) NOT NULL DEFAULT 0 CHECK (mrp >= 0),
  ADD COLUMN security_deposit numeric(14,2) NOT NULL DEFAULT 0 CHECK (security_deposit >= 0 AND security_deposit <= 1000000);

ALTER TABLE public.add_ons
  ADD COLUMN category_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN quantity integer CHECK (quantity IS NULL OR quantity BETWEEN 0 AND 100000);

-- ------------------------------------------------------------------------------
-- the money fields of a product, from the keys a form sent (a key left out keeps the saved value)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._save_product_money(p_product uuid, p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  UPDATE public.products SET
    mrp = CASE WHEN p ? 'mrp' THEN COALESCE(NULLIF(p ->> 'mrp', '')::numeric, 0) ELSE mrp END,
    security_deposit = CASE WHEN p ? 'security_deposit' THEN COALESCE(NULLIF(p ->> 'security_deposit', '')::numeric, 0) ELSE security_deposit END
  WHERE id = p_product AND shop_id = public.current_shop_id();
END $$;

-- ------------------------------------------------------------------------------
-- save_product: the product form
-- ------------------------------------------------------------------------------
ALTER FUNCTION public.save_product(jsonb) RENAME TO _save_product_pieces;

CREATE OR REPLACE FUNCTION public.save_product(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_id uuid;
BEGIN
  v_id := public._save_product_pieces(p);
  PERFORM public._save_product_money(v_id, p);
  RETURN v_id;
END $$;

-- ------------------------------------------------------------------------------
-- import_catalog: bulk add & edit, and Excel/CSV import (products found by SKU)
-- ------------------------------------------------------------------------------
ALTER FUNCTION public.import_catalog(jsonb) RENAME TO _import_catalog_core;

CREATE OR REPLACE FUNCTION public.import_catalog(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_counts jsonb;
  v_item jsonb;
BEGIN
  v_counts := public._import_catalog_core(p);
  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p -> 'items', '[]')) LOOP
    PERFORM public._save_product_money(
      (SELECT id FROM public.products WHERE shop_id = public.current_shop_id() AND sku = upper(btrim(v_item ->> 'sku'))), v_item);
  END LOOP;
  RETURN v_counts;
END $$;

ALTER FUNCTION public.save_product(jsonb) OWNER TO app_rpc;
ALTER FUNCTION public._save_product_pieces(jsonb) OWNER TO app_rpc;
ALTER FUNCTION public.import_catalog(jsonb) OWNER TO app_rpc;
ALTER FUNCTION public._import_catalog_core(jsonb) OWNER TO app_rpc;
ALTER FUNCTION public._save_product_money(uuid, jsonb) OWNER TO app_rpc;
REVOKE ALL ON FUNCTION public._save_product_pieces(jsonb), public._import_catalog_core(jsonb), public._save_product_money(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_product(jsonb), public.import_catalog(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_product(jsonb), public.import_catalog(jsonb) TO authenticated;

-- ------------------------------------------------------------------------------
-- earnings per product, as the product's Business figures tab counts them:
--   times rented = bookings picked up (out now or returned); earned = line amounts of returned bookings.
-- Runs as the caller, so it sees exactly the rentals the person may see (row level security).
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.product_earnings()
RETURNS TABLE (product_id uuid, times_rented bigint, earned numeric)
LANGUAGE sql STABLE SET search_path = public, pg_catalog AS $$
  SELECT l.product_id,
         count(DISTINCT l.rental_id) FILTER (WHERE r.status IN ('active', 'completed')),
         COALESCE(sum(l.amount) FILTER (WHERE r.status = 'completed'), 0)
  FROM public.rental_lines l
  JOIN public.rentals r ON r.id = l.rental_id
  GROUP BY l.product_id;
$$;
REVOKE ALL ON FUNCTION public.product_earnings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.product_earnings() TO authenticated;

NOTIFY pgrst, 'reload schema';
