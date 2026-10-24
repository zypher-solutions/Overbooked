-- Overbooked v2 — helpers for the shop app: availability for the booking picker, saving a product in one go.

-- every enabled item of a branch with how many of its units are free for a period (incl. turnaround)
CREATE OR REPLACE FUNCTION public.branch_availability(p_branch_id uuid, p_start timestamptz, p_end timestamptz)
RETURNS TABLE (variation_id uuid, free integer, total integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  PERFORM public._require_role();
  PERFORM public._require_branch(p_branch_id);
  IF p_end <= p_start THEN
    RAISE EXCEPTION 'The end must be after the start';
  END IF;
  RETURN QUERY
  SELECT v.id,
         count(u.id) FILTER (WHERE NOT EXISTS (
           SELECT 1 FROM public.unit_reservations ur
           WHERE ur.unit_id = u.id AND ur.state <> 'released'
             AND ur.period && tstzrange(p_start, p_end + v.turnaround, '[)')))::integer,
         count(u.id)::integer
  FROM public.product_variations v
  JOIN public.products p ON p.id = v.product_id AND p.is_active
  LEFT JOIN public.units u ON u.variation_id = v.id AND u.branch_id = p_branch_id AND u.status = 'available'
  WHERE v.is_enabled
  GROUP BY v.id;
END $$;

-- create or update a product with its variations and rates, all or nothing.
-- p = {id?, category_id, name, sku, description, image_url, purchase_price, replacement_value, is_active,
--      variations: [{id?, name, sku, attributes, base_occupancy, max_occupancy, km_included_per_day,
--                    turnaround_hours, is_enabled, rates: {day: 999, late_penalty: 200, ...}}]}
-- Variations left out are deleted when they were never rented, otherwise switched off.
-- Rates left out (or empty) are removed. Units are managed separately.
CREATE OR REPLACE FUNCTION public.save_product(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid;
  v_id uuid := NULLIF(p ->> 'id', '')::uuid;
  v_category uuid := (p ->> 'category_id')::uuid;
  v_template public.business_templates;
  v_var jsonb;
  v_var_id uuid;
  v_keep uuid[] := '{}';
  v_rate RECORD;
  v_old RECORD;
  v_turnaround interval;
BEGIN
  PERFORM public._require_role(ARRAY['super_admin', 'owner', 'manager']);
  v_shop := public.current_shop_id();

  SELECT t.* INTO v_template FROM public.categories c JOIN public.business_templates t ON t.key = c.template_key
  WHERE c.id = v_category;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Choose a category';
  END IF;
  IF jsonb_array_length(COALESCE(p -> 'variations', '[]')) = 0 THEN
    RAISE EXCEPTION 'Add at least one variation';
  END IF;

  BEGIN
    IF v_id IS NULL THEN
      INSERT INTO public.products (shop_id, category_id, name, sku, description, image_url, purchase_price, replacement_value, is_active)
      VALUES (v_shop, v_category, btrim(p ->> 'name'), upper(btrim(p ->> 'sku')), NULLIF(btrim(p ->> 'description'), ''),
              NULLIF(p ->> 'image_url', ''), COALESCE((p ->> 'purchase_price')::numeric, 0),
              COALESCE((p ->> 'replacement_value')::numeric, 0), COALESCE((p ->> 'is_active')::boolean, true))
      RETURNING id INTO v_id;
    ELSE
      UPDATE public.products SET category_id = v_category, name = btrim(p ->> 'name'), sku = upper(btrim(p ->> 'sku')),
        description = NULLIF(btrim(p ->> 'description'), ''), image_url = NULLIF(p ->> 'image_url', ''),
        purchase_price = COALESCE((p ->> 'purchase_price')::numeric, 0),
        replacement_value = COALESCE((p ->> 'replacement_value')::numeric, 0),
        is_active = COALESCE((p ->> 'is_active')::boolean, true)
      WHERE id = v_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Product not found';
      END IF;
    END IF;

    FOR v_var IN SELECT value FROM jsonb_array_elements(p -> 'variations') LOOP
      v_turnaround := COALESCE(make_interval(mins => round((v_var ->> 'turnaround_hours')::numeric * 60)::integer), v_template.turnaround);
      v_var_id := NULLIF(v_var ->> 'id', '')::uuid;
      IF v_var_id IS NULL THEN
        INSERT INTO public.product_variations (shop_id, product_id, name, sku, attributes, base_occupancy, max_occupancy,
                                               km_included_per_day, turnaround, is_enabled)
        VALUES (v_shop, v_id, btrim(v_var ->> 'name'), upper(btrim(v_var ->> 'sku')), COALESCE(v_var -> 'attributes', '{}'),
                (v_var ->> 'base_occupancy')::integer, (v_var ->> 'max_occupancy')::integer,
                (v_var ->> 'km_included_per_day')::integer, v_turnaround, COALESCE((v_var ->> 'is_enabled')::boolean, true))
        RETURNING id INTO v_var_id;
      ELSE
        UPDATE public.product_variations SET name = btrim(v_var ->> 'name'), sku = upper(btrim(v_var ->> 'sku')),
          attributes = COALESCE(v_var -> 'attributes', '{}'), base_occupancy = (v_var ->> 'base_occupancy')::integer,
          max_occupancy = (v_var ->> 'max_occupancy')::integer, km_included_per_day = (v_var ->> 'km_included_per_day')::integer,
          turnaround = v_turnaround, is_enabled = COALESCE((v_var ->> 'is_enabled')::boolean, true)
        WHERE id = v_var_id AND product_id = v_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Variation % does not belong to this product', v_var ->> 'sku';
        END IF;
      END IF;
      v_keep := v_keep || v_var_id;

      -- rates: only the template's types, empty = none
      FOR v_rate IN SELECT key, value FROM jsonb_each_text(COALESCE(v_var -> 'rates', '{}')) LOOP
        IF NOT v_rate.key = ANY (v_template.rate_types) THEN
          RAISE EXCEPTION '"%" prices are not used for %', v_rate.key, v_template.name;
        END IF;
      END LOOP;
      DELETE FROM public.variation_rates r WHERE r.variation_id = v_var_id
        AND NOT EXISTS (SELECT 1 FROM jsonb_each_text(COALESCE(v_var -> 'rates', '{}')) x
                        WHERE x.key = r.rate_type AND NULLIF(x.value, '') IS NOT NULL);
      INSERT INTO public.variation_rates (shop_id, variation_id, rate_type, amount)
      SELECT v_shop, v_var_id, x.key, round(x.value::numeric, 2)
      FROM jsonb_each_text(COALESCE(v_var -> 'rates', '{}')) x WHERE NULLIF(x.value, '') IS NOT NULL
      ON CONFLICT (variation_id, rate_type) DO UPDATE SET amount = EXCLUDED.amount;
    END LOOP;

    -- variations removed from the form
    FOR v_old IN SELECT id FROM public.product_variations WHERE product_id = v_id AND NOT id = ANY (v_keep) LOOP
      IF EXISTS (SELECT 1 FROM public.rental_lines WHERE variation_id = v_old.id)
         OR EXISTS (SELECT 1 FROM public.unit_reservations ur JOIN public.units u ON u.id = ur.unit_id WHERE u.variation_id = v_old.id)
         OR EXISTS (SELECT 1 FROM public.set_items WHERE variation_id = v_old.id) THEN
        UPDATE public.product_variations SET is_enabled = false WHERE id = v_old.id;
      ELSE
        DELETE FROM public.units WHERE variation_id = v_old.id;
        DELETE FROM public.product_variations WHERE id = v_old.id;
      END IF;
    END LOOP;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'That SKU is already used by another product or variation';
  END;

  RETURN v_id;
END $$;

ALTER FUNCTION public.branch_availability(uuid, timestamptz, timestamptz) OWNER TO app_rpc;
ALTER FUNCTION public.save_product(jsonb) OWNER TO app_rpc;
REVOKE ALL ON FUNCTION public.branch_availability(uuid, timestamptz, timestamptz), public.save_product(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.branch_availability(uuid, timestamptz, timestamptz), public.save_product(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
