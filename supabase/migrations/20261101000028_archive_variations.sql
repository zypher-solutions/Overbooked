-- Taking a variation (for example Black / S) out of a product.
--   * Never booked, never in a set: it is deleted with its pieces, as before.
--   * It has history (past bookings): it is ARCHIVED. It disappears from every screen, its pieces are retired, and the old
--     bookings keep pointing at it, so receipts, piece history and the ledger stay correct.
--   * It is out with a customer, booked for the future, or part of a set: the save is refused and says which.
--   * Adding the same variation again (same SKU) brings the archived one back instead of failing on the duplicate SKU.
-- The removal happens inside save_product, in the same step as the rest of the form: a variation left out of the form is removed.

ALTER TABLE public.product_variations ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- the one-off function of an earlier draft is not needed
DROP FUNCTION IF EXISTS public.delete_or_deactivate_variation(uuid);

CREATE OR REPLACE FUNCTION public._save_product_core(p jsonb)
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
  v_out text;
  v_booked text;
  v_set text;
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
      -- a variation added again after it was removed: the archived one with this SKU comes back (one lookup on the unique SKU)
      IF v_var_id IS NULL THEN
        SELECT id INTO v_var_id FROM public.product_variations
        WHERE shop_id = v_shop AND product_id = v_id AND sku = upper(btrim(v_var ->> 'sku')) AND archived_at IS NOT NULL;
        IF v_var_id IS NOT NULL THEN
          UPDATE public.product_variations SET archived_at = NULL WHERE id = v_var_id;
        END IF;
      END IF;
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

    -- variations left out of the form are removed
    FOR v_old IN SELECT id, name FROM public.product_variations WHERE product_id = v_id AND archived_at IS NULL AND NOT id = ANY (v_keep) LOOP
      -- not while a customer has it, or it is booked: finish the booking first
      SELECT string_agg(DISTINCT r.token, ', ') INTO v_out FROM public.rental_lines l JOIN public.rentals r ON r.id = l.rental_id
      WHERE l.variation_id = v_old.id AND r.status = 'active';
      IF v_out IS NOT NULL THEN
        RAISE EXCEPTION 'Cannot remove %: it is out with a customer on %. Take it back first, then remove it.', v_old.name, v_out;
      END IF;
      SELECT string_agg(DISTINCT r.token, ', ') INTO v_booked FROM public.rental_lines l JOIN public.rentals r ON r.id = l.rental_id
      WHERE l.variation_id = v_old.id AND r.status = 'reserved';
      IF v_booked IS NOT NULL THEN
        RAISE EXCEPTION 'Cannot remove %: it is booked on %. Finish or cancel those bookings first.', v_old.name, v_booked;
      END IF;
      SELECT string_agg(DISTINCT sp.name, ', ') INTO v_set FROM public.set_items si JOIN public.products sp ON sp.id = si.set_product_id
      WHERE si.variation_id = v_old.id;
      IF v_set IS NOT NULL THEN
        RAISE EXCEPTION 'Cannot remove %: it is part of the set %. Take it out of the set first.', v_old.name, v_set;
      END IF;

      IF EXISTS (SELECT 1 FROM public.rental_lines WHERE variation_id = v_old.id)
         OR EXISTS (SELECT 1 FROM public.unit_reservations ur JOIN public.units u ON u.id = ur.unit_id WHERE u.variation_id = v_old.id) THEN
        -- it has history: archived, its pieces retired, the old bookings keep their record
        UPDATE public.product_variations SET archived_at = now(), is_enabled = false WHERE id = v_old.id;
        UPDATE public.units SET status = 'retired', status_reason = 'Variation removed' WHERE variation_id = v_old.id AND status <> 'retired';
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

NOTIFY pgrst, 'reload schema';
