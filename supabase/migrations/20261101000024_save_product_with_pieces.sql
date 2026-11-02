-- The product form creates a product and its pieces in one step.
-- Before, the pieces were inserted by the browser after the product was saved: a failure in between left a product
-- without pieces, and two people saving at once could pick the same piece codes.
-- Each variation may now carry stock: {"<branch id>": <how many pieces the branch should have>}. The database counts what
-- exists (not retired) and creates the missing ones, numbered SKU-1, SKU-2 ..., all in the same transaction as the product.

ALTER FUNCTION public.save_product(jsonb) RENAME TO _save_product_core;

CREATE OR REPLACE FUNCTION public.save_product(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid;
  v_id uuid;
  v_var jsonb;
  v_vid uuid;
  v_sku text;
  v_attrs jsonb;
  v_branch uuid;
  v_target integer;
  v_have integer;
  v_missing integer;
  v_n integer;
  v_code text;
  r record;
BEGIN
  PERFORM public._require_role(ARRAY['super_admin', 'owner', 'manager']);
  v_shop := public.current_shop_id();
  v_id := public._save_product_core(p);

  -- one saver at a time per product, so piece codes cannot collide
  PERFORM pg_advisory_xact_lock(hashtextextended(v_id::text, 0));

  FOR v_var IN SELECT value FROM jsonb_array_elements(COALESCE(p -> 'variations', '[]')) LOOP
    CONTINUE WHEN NOT COALESCE((v_var ->> 'is_enabled')::boolean, true) OR jsonb_typeof(v_var -> 'stock') IS DISTINCT FROM 'object';
    v_sku := upper(btrim(v_var ->> 'sku'));
    SELECT id, attributes INTO v_vid, v_attrs FROM public.product_variations WHERE product_id = v_id AND sku = v_sku;
    CONTINUE WHEN v_vid IS NULL;

    FOR r IN SELECT key, value FROM jsonb_each_text(v_var -> 'stock') LOOP
      v_branch := r.key::uuid;
      v_target := floor(COALESCE(NULLIF(r.value, ''), '0')::numeric)::integer;
      IF v_target < 0 OR v_target > 2000 THEN
        RAISE EXCEPTION 'Pieces per branch must be between 0 and 2000 (% for %)', v_target, v_sku;
      END IF;
      SELECT count(*) INTO v_have FROM public.units WHERE variation_id = v_vid AND branch_id = v_branch AND status <> 'retired';
      v_missing := v_target - v_have;
      CONTINUE WHEN v_missing <= 0;
      IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id = v_branch AND is_active) THEN
        RAISE EXCEPTION 'Choose an active branch for the pieces of %', v_sku;
      END IF;
      PERFORM public._require_branch(v_branch);
      v_n := 0;
      WHILE v_missing > 0 LOOP
        v_n := v_n + 1;
        v_code := v_sku || '-' || v_n;
        IF NOT EXISTS (SELECT 1 FROM public.units WHERE shop_id = v_shop AND code = v_code) THEN
          INSERT INTO public.units (shop_id, product_id, variation_id, branch_id, code, attributes)
          VALUES (v_shop, v_id, v_vid, v_branch, v_code, v_attrs);
          v_missing := v_missing - 1;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  RETURN v_id;
END $$;

ALTER FUNCTION public.save_product(jsonb) OWNER TO app_rpc;
ALTER FUNCTION public._save_product_core(jsonb) OWNER TO app_rpc;
REVOKE ALL ON FUNCTION public.save_product(jsonb), public._save_product_core(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_product(jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
