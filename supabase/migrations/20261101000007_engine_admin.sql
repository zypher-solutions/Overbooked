-- Overbooked v2 — corrections, catalog tools, reports, staff and the Zypher console.

-- ==============================================================================
-- Corrections (owner or Zypher), always with a reason, always in audit_log
-- ==============================================================================
CREATE OR REPLACE FUNCTION public._require_correction(p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  PERFORM public._require_role(ARRAY['super_admin', 'owner']);
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'A reason (at least 3 characters) is required';
  END IF;
  PERFORM set_config('app.audit_reason', btrim(p_reason), true);
  RETURN auth.uid();
END $$;

CREATE OR REPLACE FUNCTION public._audit(p_table text, p_id uuid, p_reason text, p_old jsonb, p_new jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  INSERT INTO public.audit_log (shop_id, performed_by, via, action, table_name, record_id, reason, old_data, new_data)
  VALUES (public.current_shop_id(), auth.uid(), 'app', 'update', p_table, p_id, btrim(p_reason), p_old, p_new);
$$;

CREATE OR REPLACE FUNCTION public.admin_set_discount(p_rental_id uuid, p_discount numeric, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_r RECORD;
BEGIN
  PERFORM public._require_correction(p_reason);
  SELECT * INTO v_r FROM public.rentals WHERE id = p_rental_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rental not found'; END IF;
  IF p_discount IS NULL OR p_discount < 0 THEN RAISE EXCEPTION 'The discount cannot be negative'; END IF;
  BEGIN
    UPDATE public.rentals SET discount = round(p_discount, 2) WHERE id = p_rental_id;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'That discount is more than the total, or would leave the customer overpaid. Refund first.';
  END;
  PERFORM public._audit('rentals', p_rental_id, p_reason, jsonb_build_object('discount', v_r.discount), jsonb_build_object('discount', round(p_discount, 2)));
  RETURN (SELECT jsonb_build_object('total', total, 'paid', paid, 'balance', total - paid) FROM public.rentals WHERE id = p_rental_id);
END $$;

-- a negotiated price for one line
CREATE OR REPLACE FUNCTION public.admin_set_line_amount(p_line_id uuid, p_amount numeric, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_l RECORD;
BEGIN
  PERFORM public._require_correction(p_reason);
  SELECT * INTO v_l FROM public.rental_lines WHERE id = p_line_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Line not found'; END IF;
  IF p_amount IS NULL OR p_amount < 0 THEN RAISE EXCEPTION 'A price cannot be negative'; END IF;
  BEGIN
    UPDATE public.rental_lines SET amount = round(p_amount, 2), is_override = true WHERE id = p_line_id;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'That price would leave the customer overpaid or the discount above the total. Adjust those first.';
  END;
  PERFORM public._audit('rental_lines', p_line_id, p_reason, jsonb_build_object('amount', v_l.amount), jsonb_build_object('amount', round(p_amount, 2)));
  RETURN (SELECT jsonb_build_object('total', total, 'paid', paid, 'balance', total - paid) FROM public.rentals WHERE id = v_l.rental_id);
END $$;

CREATE OR REPLACE FUNCTION public.admin_update_payment(p_payment_id uuid, p_amount numeric, p_method text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_p RECORD;
BEGIN
  PERFORM public._require_correction(p_reason);
  SELECT * INTO v_p FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'The amount must be above zero'; END IF;
  BEGIN
    UPDATE public.payments SET amount = round(p_amount, 2),
           method = CASE WHEN kind = 'deposit_applied' THEN NULL ELSE p_method END
    WHERE id = p_payment_id;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'That amount would overpay the rental or overdraw the deposit';
  END;
  PERFORM public._audit('payments', p_payment_id, p_reason,
    jsonb_build_object('amount', v_p.amount, 'method', v_p.method), jsonb_build_object('amount', round(p_amount, 2), 'method', p_method));
  RETURN (SELECT jsonb_build_object('total', total, 'paid', paid, 'balance', total - paid) FROM public.rentals WHERE id = v_p.rental_id);
END $$;

CREATE OR REPLACE FUNCTION public.admin_delete_payment(p_payment_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_rental uuid;
BEGIN
  PERFORM public._require_correction(p_reason);
  DELETE FROM public.payments WHERE id = p_payment_id RETURNING rental_id INTO v_rental;
  IF v_rental IS NULL THEN RAISE EXCEPTION 'Payment not found'; END IF;
  RETURN (SELECT jsonb_build_object('total', total, 'paid', paid, 'balance', total - paid) FROM public.rentals WHERE id = v_rental);
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'Removing it would leave more deposit given back or kept than was received';
END $$;

CREATE OR REPLACE FUNCTION public.admin_delete_charge(p_charge_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_rental uuid;
BEGIN
  PERFORM public._require_correction(p_reason);
  DELETE FROM public.rental_charges WHERE id = p_charge_id RETURNING rental_id INTO v_rental;
  IF v_rental IS NULL THEN RAISE EXCEPTION 'Charge not found'; END IF;
  RETURN (SELECT jsonb_build_object('total', total, 'paid', paid, 'balance', total - paid) FROM public.rentals WHERE id = v_rental);
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'Removing it would leave the customer overpaid. Record a refund first.';
END $$;

-- a finished or cancelled rental, with everything under it
CREATE OR REPLACE FUNCTION public.admin_delete_rental(p_rental_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_status text;
BEGIN
  PERFORM public._require_correction(p_reason);
  SELECT status INTO v_status FROM public.rentals WHERE id = p_rental_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rental not found'; END IF;
  IF v_status IN ('reserved', 'active') THEN
    RAISE EXCEPTION 'Cancel or complete the rental before deleting it';
  END IF;
  DELETE FROM public.payments WHERE rental_id = p_rental_id;
  DELETE FROM public.rentals WHERE id = p_rental_id;   -- lines, reservations, add-ons, charges, checks follow
END $$;

-- ==============================================================================
-- Catalog tools
-- ==============================================================================
-- no history: deleted; any rental history: deactivated (history must stay)
CREATE OR REPLACE FUNCTION public.delete_or_deactivate_product(p_product_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  PERFORM public._require_role(ARRAY['super_admin', 'owner']);
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id) THEN
    RAISE EXCEPTION 'Product not found';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rental_lines WHERE product_id = p_product_id)
     OR EXISTS (SELECT 1 FROM public.unit_reservations ur JOIN public.units u ON u.id = ur.unit_id WHERE u.product_id = p_product_id) THEN
    UPDATE public.products SET is_active = false WHERE id = p_product_id;
    UPDATE public.product_variations SET is_enabled = false WHERE product_id = p_product_id;
    RETURN jsonb_build_object('result', 'deactivated');
  END IF;
  DELETE FROM public.units WHERE product_id = p_product_id;
  DELETE FROM public.set_items WHERE set_product_id = p_product_id;
  DELETE FROM public.product_variations WHERE product_id = p_product_id;   -- rates follow
  DELETE FROM public.products WHERE id = p_product_id;
  RETURN jsonb_build_object('result', 'deleted');
END $$;

-- a unit out of service (maintenance, alteration, lost, retired) or back in; lists rentals it affects
CREATE OR REPLACE FUNCTION public.set_unit_status(p_unit_id uuid, p_status text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_u RECORD;
  v_affected jsonb;
BEGIN
  PERFORM public._require_role(ARRAY['super_admin', 'owner', 'manager']);
  SELECT * INTO v_u FROM public.units WHERE id = p_unit_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unit not found'; END IF;
  PERFORM public._require_branch(v_u.branch_id);
  IF p_status = 'alteration' THEN
    IF NOT public.shop_feature(v_u.shop_id, 'alterations') THEN
      RAISE EXCEPTION 'Alterations are not switched on for this shop';
    END IF;
    UPDATE public.units SET status = 'maintenance', status_reason = 'Alteration' || COALESCE(': ' || NULLIF(btrim(p_reason), ''), '') WHERE id = p_unit_id;
  ELSE
    UPDATE public.units SET status = p_status, status_reason = CASE WHEN p_status = 'available' THEN NULL ELSE NULLIF(btrim(p_reason), '') END
    WHERE id = p_unit_id;
  END IF;
  SELECT COALESCE(jsonb_agg(r.token ORDER BY r.start_at), '[]') INTO v_affected
  FROM public.unit_reservations ur JOIN public.rentals r ON r.id = ur.rental_id
  WHERE ur.unit_id = p_unit_id AND ur.state = 'held';
  RETURN jsonb_build_object('status', p_status, 'upcoming_rentals_to_swap', v_affected);
END $$;

-- give a reservation another unit of the same item (e.g. the booked one is damaged)
CREATE OR REPLACE FUNCTION public.swap_unit(p_rental_id uuid, p_old_unit_id uuid, p_new_unit_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_res RECORD;
  v_new RECORD;
BEGIN
  PERFORM public._require_role();
  SELECT ur.*, r.branch_id INTO v_res FROM public.unit_reservations ur JOIN public.rentals r ON r.id = ur.rental_id
  WHERE ur.rental_id = p_rental_id AND ur.unit_id = p_old_unit_id AND ur.state = 'held' FOR UPDATE OF ur;
  IF NOT FOUND THEN RAISE EXCEPTION 'That unit is not reserved on this rental (or already picked up)'; END IF;
  PERFORM public._require_branch(v_res.branch_id);
  SELECT * INTO v_new FROM public.units WHERE id = p_new_unit_id;
  IF NOT FOUND OR v_new.status <> 'available' OR v_new.branch_id <> v_res.branch_id
     OR v_new.variation_id <> (SELECT variation_id FROM public.units WHERE id = p_old_unit_id) THEN
    RAISE EXCEPTION 'Choose an available unit of the same item in the same branch';
  END IF;
  UPDATE public.unit_reservations SET unit_id = p_new_unit_id WHERE id = v_res.id;
EXCEPTION WHEN exclusion_violation THEN
  RAISE EXCEPTION 'That unit is booked by someone else for these dates';
END $$;

-- import a catalog in one go (CSV screen). p = {items: [{category, name, sku, description, purchase_price,
--   replacement_value, image_url, variations: [{sku, name, attributes, rates: {day: 999, ...}, base_occupancy,
--   max_occupancy, km_included_per_day, turnaround_hours, units: [{branch, code, attributes}]}]}]}
-- Existing SKUs are updated, new ones created; units are added by code (never removed).
CREATE OR REPLACE FUNCTION public.import_catalog(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid;
  v_role text;
  v_item jsonb;
  v_var jsonb;
  v_unit jsonb;
  v_rate RECORD;
  v_cat uuid;
  v_prod uuid;
  v_varid uuid;
  v_branch uuid;
  v_counts jsonb := '{"products": 0, "variations": 0, "units": 0}';
BEGIN
  v_role := public._require_role(ARRAY['super_admin', 'owner', 'manager']);
  v_shop := public.current_shop_id();

  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p -> 'items', '[]')) LOOP
    SELECT id INTO v_cat FROM public.categories WHERE lower(name) = lower(btrim(v_item ->> 'category'));
    IF v_cat IS NULL THEN
      RAISE EXCEPTION 'Category "%" does not exist. Create it first.', v_item ->> 'category';
    END IF;

    INSERT INTO public.products (shop_id, category_id, name, sku, description, image_url, purchase_price, replacement_value)
    VALUES (v_shop, v_cat, btrim(v_item ->> 'name'), upper(btrim(v_item ->> 'sku')), NULLIF(btrim(v_item ->> 'description'), ''),
            NULLIF(v_item ->> 'image_url', ''), COALESCE((v_item ->> 'purchase_price')::numeric, 0),
            COALESCE((v_item ->> 'replacement_value')::numeric, 0))
    ON CONFLICT (shop_id, sku) DO UPDATE SET name = EXCLUDED.name, category_id = EXCLUDED.category_id,
      description = COALESCE(EXCLUDED.description, public.products.description),
      purchase_price = EXCLUDED.purchase_price, replacement_value = EXCLUDED.replacement_value
    RETURNING id INTO v_prod;
    v_counts := jsonb_set(v_counts, '{products}', to_jsonb((v_counts ->> 'products')::integer + 1));

    FOR v_var IN SELECT value FROM jsonb_array_elements(COALESCE(v_item -> 'variations', '[]')) LOOP
      INSERT INTO public.product_variations (shop_id, product_id, name, sku, attributes, base_occupancy, max_occupancy,
                                             km_included_per_day, turnaround)
      VALUES (v_shop, v_prod, COALESCE(NULLIF(btrim(v_var ->> 'name'), ''), btrim(v_item ->> 'name')), upper(btrim(v_var ->> 'sku')),
              COALESCE(v_var -> 'attributes', '{}'), (v_var ->> 'base_occupancy')::integer, (v_var ->> 'max_occupancy')::integer,
              (v_var ->> 'km_included_per_day')::integer,
              COALESCE(make_interval(hours => (v_var ->> 'turnaround_hours')::integer),
                       (SELECT t.turnaround FROM public.categories c JOIN public.business_templates t ON t.key = c.template_key WHERE c.id = v_cat)))
      ON CONFLICT (shop_id, sku) DO UPDATE SET name = EXCLUDED.name, attributes = EXCLUDED.attributes,
        base_occupancy = EXCLUDED.base_occupancy, max_occupancy = EXCLUDED.max_occupancy,
        km_included_per_day = EXCLUDED.km_included_per_day
      RETURNING id INTO v_varid;
      IF (SELECT product_id FROM public.product_variations WHERE id = v_varid) <> v_prod THEN
        RAISE EXCEPTION 'Variation SKU % already belongs to another product', v_var ->> 'sku';
      END IF;
      v_counts := jsonb_set(v_counts, '{variations}', to_jsonb((v_counts ->> 'variations')::integer + 1));

      FOR v_rate IN SELECT key, value FROM jsonb_each_text(COALESCE(v_var -> 'rates', '{}')) LOOP
        INSERT INTO public.variation_rates (shop_id, variation_id, rate_type, amount)
        VALUES (v_shop, v_varid, v_rate.key, round(v_rate.value::numeric, 2))
        ON CONFLICT (variation_id, rate_type) DO UPDATE SET amount = EXCLUDED.amount;
      END LOOP;

      FOR v_unit IN SELECT value FROM jsonb_array_elements(COALESCE(v_var -> 'units', '[]')) LOOP
        SELECT id INTO v_branch FROM public.branches WHERE lower(name) = lower(btrim(v_unit ->> 'branch'));
        IF v_branch IS NULL THEN
          RAISE EXCEPTION 'Branch "%" not found', v_unit ->> 'branch';
        END IF;
        PERFORM public._require_branch(v_branch);
        INSERT INTO public.units (shop_id, product_id, variation_id, branch_id, code, attributes)
        VALUES (v_shop, v_prod, v_varid, v_branch, upper(btrim(v_unit ->> 'code')), COALESCE(v_unit -> 'attributes', '{}'))
        ON CONFLICT (shop_id, code) DO NOTHING;
        IF FOUND THEN
          v_counts := jsonb_set(v_counts, '{units}', to_jsonb((v_counts ->> 'units')::integer + 1));
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  RETURN v_counts;
END $$;

-- ==============================================================================
-- Reports
-- ==============================================================================
-- per item and branch: units, free now, out now, reserved ahead, in maintenance, lost
CREATE OR REPLACE FUNCTION public.inventory_status()
RETURNS TABLE (variation_id uuid, branch_id uuid, total bigint, available_now bigint, out_now bigint,
               reserved_ahead bigint, maintenance bigint, lost bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  PERFORM public._require_role();
  RETURN QUERY
  SELECT u.variation_id, u.branch_id,
         count(*) FILTER (WHERE u.status <> 'retired'),
         count(*) FILTER (WHERE u.status = 'available' AND NOT EXISTS (
           SELECT 1 FROM public.unit_reservations ur WHERE ur.unit_id = u.id AND ur.state = 'out')),
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.unit_reservations ur WHERE ur.unit_id = u.id AND ur.state = 'out')),
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.unit_reservations ur
                                        WHERE ur.unit_id = u.id AND ur.state = 'held' AND upper(ur.period) > now())),
         count(*) FILTER (WHERE u.status = 'maintenance'),
         count(*) FILTER (WHERE u.status = 'lost')
  FROM public.units u
  JOIN public.branches b ON b.id = u.branch_id AND b.is_active
  GROUP BY u.variation_id, u.branch_id;
END $$;

-- money for a period (owner: all branches or one; manager: own branch). Sums the records, so it always matches them.
CREATE OR REPLACE FUNCTION public.dashboard_summary(p_from date, p_to date, p_branch_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_role text;
  v_branch uuid := p_branch_id;
  v_tz text := public._shop_tz();
  v_from timestamptz;
  v_to timestamptz;
BEGIN
  v_role := public._require_role(ARRAY['super_admin', 'owner', 'manager']);
  IF v_role = 'manager' THEN
    v_branch := public.get_my_branch();
  END IF;
  v_from := (p_from::timestamp AT TIME ZONE v_tz);
  v_to := ((p_to + 1)::timestamp AT TIME ZONE v_tz);

  RETURN (
    SELECT jsonb_build_object(
      'rentals', (SELECT count(*) FROM public.rentals r WHERE r.start_at >= v_from AND r.start_at < v_to
                    AND (v_branch IS NULL OR r.branch_id = v_branch) AND r.status NOT IN ('cancelled', 'no_show')),
      'revenue', (SELECT COALESCE(sum(r.total), 0) FROM public.rentals r WHERE r.start_at >= v_from AND r.start_at < v_to
                    AND (v_branch IS NULL OR r.branch_id = v_branch)),
      'balance_due', (SELECT COALESCE(sum(r.total - r.paid), 0) FROM public.rentals r WHERE r.start_at >= v_from AND r.start_at < v_to
                    AND (v_branch IS NULL OR r.branch_id = v_branch)),
      'collected', (SELECT COALESCE(sum(CASE p.kind WHEN 'payment' THEN p.amount WHEN 'refund' THEN -p.amount ELSE 0 END), 0)
                    FROM public.payments p JOIN public.rentals r ON r.id = p.rental_id
                    WHERE p.paid_at >= v_from AND p.paid_at < v_to AND (v_branch IS NULL OR r.branch_id = v_branch)),
      'deposit_kept', (SELECT COALESCE(sum(p.amount), 0) FROM public.payments p JOIN public.rentals r ON r.id = p.rental_id
                    WHERE p.kind = 'deposit_applied' AND p.paid_at >= v_from AND p.paid_at < v_to AND (v_branch IS NULL OR r.branch_id = v_branch)),
      'deposits_held_now', (SELECT COALESCE(sum(r.deposit_received - r.deposit_refunded - r.deposit_applied), 0) FROM public.rentals r
                    WHERE (v_branch IS NULL OR r.branch_id = v_branch)),
      'by_method', (SELECT COALESCE(jsonb_object_agg(m.method, m.amount), '{}') FROM (
                      SELECT p.method, sum(CASE p.kind WHEN 'refund' THEN -p.amount WHEN 'deposit_refund' THEN -p.amount ELSE p.amount END) AS amount
                      FROM public.payments p JOIN public.rentals r ON r.id = p.rental_id
                      WHERE p.method IS NOT NULL AND p.paid_at >= v_from AND p.paid_at < v_to AND (v_branch IS NULL OR r.branch_id = v_branch)
                      GROUP BY p.method) m)));
END $$;

-- ==============================================================================
-- Staff (owner or Zypher, inside the current shop)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.get_staff_emails()
RETURNS TABLE (id uuid, email text, last_sign_in_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_catalog AS $$
BEGIN
  PERFORM public._require_role(ARRAY['super_admin', 'owner']);
  RETURN QUERY SELECT u.id, u.email::text, u.last_sign_in_at
  FROM auth.users u JOIN public.profiles p ON p.id = u.id WHERE p.shop_id = public.current_shop_id();
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_staff_status(p_user_id uuid, p_is_active boolean, p_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid;
BEGIN
  PERFORM public._require_role(ARRAY['super_admin', 'owner']);
  v_shop := public.current_shop_id();
  IF p_is_active IS NULL OR p_role IS NULL OR p_role NOT IN ('owner', 'manager', 'staff') THEN
    RAISE EXCEPTION 'Invalid role or status';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot change your own role or active status';
  END IF;
  PERFORM 1 FROM public.profiles WHERE shop_id = v_shop AND role = 'owner' AND is_active FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND shop_id = v_shop) THEN
    RAISE EXCEPTION 'Staff member not found in this shop';
  END IF;
  UPDATE public.profiles SET is_active = p_is_active, role = p_role,
         branch_id = CASE WHEN p_role = 'owner' THEN NULL ELSE branch_id END
  WHERE id = p_user_id;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE shop_id = v_shop AND role = 'owner' AND is_active) THEN
    RAISE EXCEPTION 'At least one active owner must remain in the shop';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_staff_branch(p_user_id uuid, p_branch_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid;
BEGIN
  PERFORM public._require_role(ARRAY['super_admin', 'owner']);
  v_shop := public.current_shop_id();
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND shop_id = v_shop) THEN
    RAISE EXCEPTION 'Staff member not found in this shop';
  END IF;
  IF p_branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id AND shop_id = v_shop) THEN
    RAISE EXCEPTION 'Branch not found in this shop';
  END IF;
  UPDATE public.profiles SET branch_id = p_branch_id WHERE id = p_user_id;
END $$;

-- the shop's own details and optional features (owner)
CREATE OR REPLACE FUNCTION public.update_my_shop(p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid;
BEGIN
  PERFORM public._require_role(ARRAY['super_admin', 'owner']);
  v_shop := public.current_shop_id();
  UPDATE public.shops SET
    phone = COALESCE(p ->> 'phone', phone), email = COALESCE(p ->> 'email', email),
    address = COALESCE(p ->> 'address', address), gstin = COALESCE(p ->> 'gstin', gstin),
    logo_url = COALESCE(p ->> 'logo_url', logo_url),
    settings = settings || COALESCE(p -> 'settings', '{}') - 'plan'
  WHERE id = v_shop;
END $$;

-- ==============================================================================
-- Zypher console (super_admin only; works across shops)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public._require_zypher()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Only Zypher can do this';
  END IF;
END $$;

-- a new shop from one or more templates: first branch, a category per template, default add-ons
-- p = {name, slug, token_prefix, plan, business_types: [...], branch_name, phone, email, address}
CREATE OR REPLACE FUNCTION public.create_shop(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid;
  v_types text[] := ARRAY(SELECT jsonb_array_elements_text(p -> 'business_types'));
  v_branch text := btrim(p ->> 'branch_name');
BEGIN
  PERFORM public._require_zypher();
  IF v_branch IS NULL OR v_branch = '' THEN
    RAISE EXCEPTION 'The first branch needs a name';
  END IF;

  INSERT INTO public.shops (name, slug, token_prefix, business_types, plan, phone, email, address)
  VALUES (btrim(p ->> 'name'), lower(btrim(p ->> 'slug')), upper(btrim(p ->> 'token_prefix')), v_types,
          COALESCE(p ->> 'plan', 'starter'), p ->> 'phone', p ->> 'email', p ->> 'address')
  RETURNING id INTO v_shop;

  INSERT INTO public.branches (shop_id, name, slug, phone, address)
  VALUES (v_shop, v_branch, trim(BOTH '-' FROM lower(regexp_replace(v_branch, '[^a-zA-Z0-9]+', '-', 'g'))), p ->> 'phone', p ->> 'address');

  INSERT INTO public.categories (shop_id, name, template_key)
  SELECT v_shop, t.name, t.key FROM public.business_templates t WHERE t.key = ANY (v_types);

  INSERT INTO public.add_ons (shop_id, name, basis, amount, template_keys)
  SELECT DISTINCT ON (a ->> 'name') v_shop, a ->> 'name', a ->> 'basis', (a ->> 'amount')::numeric, ARRAY[t.key]
  FROM public.business_templates t, jsonb_array_elements(t.default_add_ons) a
  WHERE t.key = ANY (v_types);

  RETURN v_shop;
END $$;

CREATE OR REPLACE FUNCTION public.switch_shop(p_shop_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  PERFORM public._require_zypher();
  IF p_shop_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.shops WHERE id = p_shop_id) THEN
    RAISE EXCEPTION 'Shop not found';
  END IF;
  UPDATE public.profiles SET active_shop_id = p_shop_id WHERE id = auth.uid();
END $$;

-- plan, status, business types, settings, notes
CREATE OR REPLACE FUNCTION public.update_shop(p_shop_id uuid, p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_plan text;
  v_branches integer;
  v_logins integer;
BEGIN
  PERFORM public._require_zypher();
  v_plan := COALESCE(p ->> 'plan', (SELECT plan FROM public.shops WHERE id = p_shop_id));
  SELECT count(*) INTO v_branches FROM public.branches WHERE shop_id = p_shop_id AND is_active;
  SELECT count(*) INTO v_logins FROM public.profiles WHERE shop_id = p_shop_id AND is_active;
  IF public.plan_limit(v_plan, 'branches') < v_branches THEN
    RAISE EXCEPTION 'The shop has % active branches; the % plan allows %', v_branches, v_plan, public.plan_limit(v_plan, 'branches');
  END IF;
  IF public.plan_limit(v_plan, 'logins') < v_logins THEN
    RAISE EXCEPTION 'The shop has % active logins; the % plan allows %', v_logins, v_plan, public.plan_limit(v_plan, 'logins');
  END IF;
  UPDATE public.shops SET
    name = COALESCE(NULLIF(btrim(p ->> 'name'), ''), name),
    plan = v_plan,
    status = COALESCE(p ->> 'status', status),
    business_types = CASE WHEN p ? 'business_types' THEN ARRAY(SELECT jsonb_array_elements_text(p -> 'business_types'))
                          ELSE business_types END,
    settings = settings || COALESCE(p -> 'settings', '{}'),
    notes = COALESCE(p ->> 'notes', notes)
  WHERE id = p_shop_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shop not found'; END IF;
  -- a newly added business type gets its category
  INSERT INTO public.categories (shop_id, name, template_key)
  SELECT p_shop_id, t.name, t.key FROM public.shops s JOIN public.business_templates t ON t.key = ANY (s.business_types)
  WHERE s.id = p_shop_id AND NOT EXISTS (SELECT 1 FROM public.categories c WHERE c.shop_id = p_shop_id AND c.template_key = t.key)
  ON CONFLICT DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION public.record_shop_payment(p_shop_id uuid, p_amount numeric, p_paid_on date, p_period_to date,
                                                      p_method text DEFAULT 'bank_transfer', p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  PERFORM public._require_zypher();
  INSERT INTO public.shop_payments (shop_id, amount, paid_on, method, period_to, note, recorded_by)
  VALUES (p_shop_id, p_amount, p_paid_on, p_method, p_period_to, p_note, auth.uid());
  UPDATE public.shops SET paid_until = GREATEST(COALESCE(paid_until, p_period_to), p_period_to) WHERE id = p_shop_id;
END $$;

-- one row per shop for the console
CREATE OR REPLACE FUNCTION public.platform_overview()
RETURNS TABLE (shop_id uuid, name text, slug text, token_prefix text, business_types text[], plan text, status text,
               paid_until date, last_payment_on date, last_payment_amount numeric, branches bigint, active_logins bigint,
               units bigint, rentals_30d bigint, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  PERFORM public._require_zypher();
  RETURN QUERY
  SELECT s.id, s.name, s.slug, s.token_prefix, s.business_types, s.plan, s.status, s.paid_until,
         lp.paid_on, lp.amount,
         (SELECT count(*) FROM public.branches b WHERE b.shop_id = s.id AND b.is_active),
         (SELECT count(*) FROM public.profiles pr WHERE pr.shop_id = s.id AND pr.is_active),
         (SELECT count(*) FROM public.units u WHERE u.shop_id = s.id AND u.status <> 'retired'),
         (SELECT count(*) FROM public.rentals r WHERE r.shop_id = s.id AND r.created_at > now() - interval '30 days'),
         s.created_at
  FROM public.shops s
  LEFT JOIN LATERAL (SELECT sp.paid_on, sp.amount FROM public.shop_payments sp WHERE sp.shop_id = s.id
                     ORDER BY sp.paid_on DESC, sp.created_at DESC LIMIT 1) lp ON true
  ORDER BY s.name;
END $$;

-- ==============================================================================
-- Ownership and grants
-- ==============================================================================
-- shop workflow functions run as app_rpc so the shop rule binds them; Zypher and auth functions stay with postgres
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'quote_rental(jsonb)', 'find_available_units(uuid, uuid, timestamptz, timestamptz)', '_quote(jsonb)',
    'price_line(uuid, integer, timestamptz, timestamptz, text)', 'available_units(uuid, uuid, timestamptz, timestamptz)',
    'create_rental(jsonb)', 'start_rental(uuid, jsonb)', 'return_suggestions(uuid, timestamptz, jsonb)',
    'complete_rental(uuid, jsonb)', 'add_rental_charge(uuid, text, numeric, text)',
    'record_rental_payment(uuid, text, numeric, text, text)', 'extend_rental(uuid, timestamptz, jsonb)',
    'cancel_rental(uuid, numeric, text, text, boolean)', 'update_rental_notes(uuid, text)',
    '_insert_payment(uuid, text, numeric, text, text)', '_period(timestamptz, timestamptz, uuid)', '_shop_tz()',
    'admin_set_discount(uuid, numeric, text)', 'admin_set_line_amount(uuid, numeric, text)',
    'admin_update_payment(uuid, numeric, text, text)', 'admin_delete_payment(uuid, text)', 'admin_delete_charge(uuid, text)',
    'admin_delete_rental(uuid, text)', 'delete_or_deactivate_product(uuid)', 'set_unit_status(uuid, text, text)',
    'swap_unit(uuid, uuid, uuid)', 'import_catalog(jsonb)', 'inventory_status()', 'dashboard_summary(date, date, uuid)']
  LOOP
    EXECUTE format('ALTER FUNCTION public.%s OWNER TO app_rpc', f);
  END LOOP;
END $$;

-- internal helpers: not callable from the API
REVOKE EXECUTE ON FUNCTION public._require_role(text[]), public._require_branch(uuid), public._quote(jsonb),
  public.price_line(uuid, integer, timestamptz, timestamptz, text), public.available_units(uuid, uuid, timestamptz, timestamptz),
  public._period(timestamptz, timestamptz, uuid), public._shop_tz(), public._money(jsonb, text),
  public._insert_payment(uuid, text, numeric, text, text), public._require_correction(text),
  public._audit(text, uuid, text, jsonb, jsonb), public._require_zypher(),
  public.rental_days(timestamptz, timestamptz, text), public.rental_hours(timestamptz, timestamptz)
FROM PUBLIC, anon, authenticated;

-- the app's functions: signed-in users only (each checks role, branch and shop itself)
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'quote_rental(jsonb)', 'find_available_units(uuid, uuid, timestamptz, timestamptz)', 'create_rental(jsonb)',
    'start_rental(uuid, jsonb)', 'return_suggestions(uuid, timestamptz, jsonb)', 'complete_rental(uuid, jsonb)',
    'add_rental_charge(uuid, text, numeric, text)', 'record_rental_payment(uuid, text, numeric, text, text)',
    'extend_rental(uuid, timestamptz, jsonb)', 'cancel_rental(uuid, numeric, text, text, boolean)',
    'update_rental_notes(uuid, text)', 'admin_set_discount(uuid, numeric, text)', 'admin_set_line_amount(uuid, numeric, text)',
    'admin_update_payment(uuid, numeric, text, text)', 'admin_delete_payment(uuid, text)', 'admin_delete_charge(uuid, text)',
    'admin_delete_rental(uuid, text)', 'delete_or_deactivate_product(uuid)', 'set_unit_status(uuid, text, text)',
    'swap_unit(uuid, uuid, uuid)', 'import_catalog(jsonb)', 'inventory_status()', 'dashboard_summary(date, date, uuid)',
    'get_staff_emails()', 'admin_set_staff_status(uuid, boolean, text)', 'set_staff_branch(uuid, uuid)',
    'update_my_shop(jsonb)', 'create_shop(jsonb)', 'switch_shop(uuid)', 'update_shop(uuid, jsonb)',
    'record_shop_payment(uuid, numeric, date, date, text, text)', 'platform_overview()']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
