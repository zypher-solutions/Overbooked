-- Overbooked: rules found missing in the pre-launch review (29 Oct 2026).
--   1. A piece that is still out past its return date is not offered to new bookings.
--   2. The deposit is given back at return or cancellation (a counter person cannot hand it back earlier).
--   3. A return time more than 2 hours in the past needs a manager or the owner, and is audited.
--   4. 14-day free trial: a new shop is not paused while it runs.
--   5. Shop settings: only known keys; unblocking a customer needs a manager or the owner.
--   6. Price changes (discount, agreed price) are logged with who made them.
--   7. Missing indexes.

-- ------------------------------------------------------------------------------
-- 1. pieces kept late
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._unit_kept_late(p_unit_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.unit_reservations ur JOIN public.rentals r ON r.id = ur.rental_id
    WHERE ur.unit_id = p_unit_id AND ur.state = 'out' AND r.end_at < now());
$$;

CREATE OR REPLACE FUNCTION public.available_units(p_branch_id uuid, p_variation_id uuid, p_start timestamptz, p_end timestamptz, p_cleaning_days integer)
RETURNS TABLE (unit_id uuid, code text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT u.id, u.code
  FROM public.units u
  JOIN public.product_variations v ON v.id = u.variation_id
  WHERE u.branch_id = p_branch_id AND u.variation_id = p_variation_id AND u.status = 'available'
    AND NOT public._unit_kept_late(u.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.unit_reservations ur
      WHERE ur.unit_id = u.id AND ur.state <> 'released'
        AND ur.period && tstzrange(p_start, p_end + COALESCE(make_interval(days => p_cleaning_days), v.turnaround), '[)'))
  ORDER BY u.code;
$$;

CREATE OR REPLACE FUNCTION public.branch_availability(p_branch_id uuid, p_start timestamptz, p_end timestamptz, p_cleaning_days integer)
RETURNS TABLE (variation_id uuid, free integer, total integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  PERFORM public._require_role();
  PERFORM public._require_branch(p_branch_id);
  IF p_end <= p_start THEN
    RAISE EXCEPTION 'The end must be after the start';
  END IF;
  RETURN QUERY
  WITH plain AS (
    SELECT v.id AS vid,
           count(u.id) FILTER (WHERE NOT public._unit_kept_late(u.id) AND NOT EXISTS (
             SELECT 1 FROM public.unit_reservations ur
             WHERE ur.unit_id = u.id AND ur.state <> 'released'
               AND ur.period && tstzrange(p_start, p_end + COALESCE(make_interval(days => p_cleaning_days), v.turnaround), '[)')))::integer AS free,
           count(u.id)::integer AS total
    FROM public.product_variations v
    JOIN public.products p ON p.id = v.product_id AND p.is_active AND NOT p.is_set
    LEFT JOIN public.units u ON u.variation_id = v.id AND u.branch_id = p_branch_id AND u.status = 'available'
    WHERE v.is_enabled
    GROUP BY v.id
  )
  SELECT vid, plain.free, plain.total FROM plain
  UNION ALL
  SELECT v.id, COALESCE(min(pl.free / si.qty), 0)::integer, COALESCE(min(pl.total / si.qty), 0)::integer
  FROM public.product_variations v
  JOIN public.products p ON p.id = v.product_id AND p.is_active AND p.is_set
  JOIN public.set_items si ON si.set_product_id = p.id
  LEFT JOIN plain pl ON pl.vid = si.variation_id
  WHERE v.is_enabled
  GROUP BY v.id;
END $$;

-- a unit chosen by hand must not be one that is still out
CREATE OR REPLACE FUNCTION public._reserve_line(p_rental_id uuid, p_line_id uuid, p_line jsonb, p_branch uuid,
                                                p_start timestamptz, p_end timestamptz, p_prefer uuid[] DEFAULT '{}')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_need RECORD;
  v_chosen uuid[];
  v_found integer;
  v_unit uuid;
  v_shop uuid := public.current_shop_id();
  v_cleaning integer := (SELECT cleaning_days FROM public.rentals WHERE id = p_rental_id);
BEGIN
  FOR v_need IN
    SELECT si.variation_id, si.qty * (p_line ->> 'qty')::integer AS qty
    FROM public.set_items si JOIN public.products pr ON pr.id = si.set_product_id
    WHERE si.set_product_id = (p_line ->> 'product_id')::uuid AND pr.is_set
    UNION ALL
    SELECT (p_line ->> 'variation_id')::uuid, (p_line ->> 'qty')::integer
    WHERE NOT EXISTS (SELECT 1 FROM public.products WHERE id = (p_line ->> 'product_id')::uuid AND is_set)
  LOOP
    v_chosen := ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(p_line -> 'unit_ids') = 'array'
                                                            THEN p_line -> 'unit_ids' ELSE '[]' END)::uuid);
    IF cardinality(v_chosen) > 0 THEN
      IF cardinality(v_chosen) <> v_need.qty OR (SELECT count(DISTINCT x) FROM unnest(v_chosen) x) <> v_need.qty THEN
        RAISE EXCEPTION 'Choose exactly % different unit(s) for %', v_need.qty, p_line ->> 'description';
      END IF;
      SELECT count(*) INTO v_found FROM public.units
      WHERE id = ANY (v_chosen) AND variation_id = v_need.variation_id AND branch_id = p_branch AND status = 'available';
      IF v_found <> v_need.qty THEN
        RAISE EXCEPTION 'A chosen unit for % is not available in this branch', p_line ->> 'description';
      END IF;
      IF EXISTS (SELECT 1 FROM unnest(v_chosen) x WHERE public._unit_kept_late(x)) THEN
        RAISE EXCEPTION 'A chosen piece for % is still out with another customer past its return date', p_line ->> 'description';
      END IF;
    ELSE
      v_chosen := ARRAY(
        SELECT a.unit_id FROM public.available_units(p_branch, v_need.variation_id, p_start, p_end, v_cleaning) a
        ORDER BY (a.unit_id = ANY (p_prefer)) DESC, a.code
        LIMIT v_need.qty);
      IF cardinality(v_chosen) < v_need.qty THEN
        RAISE EXCEPTION 'Only % of % available for % on these dates', cardinality(v_chosen), v_need.qty, p_line ->> 'description';
      END IF;
    END IF;

    FOREACH v_unit IN ARRAY v_chosen LOOP
      INSERT INTO public.unit_reservations (shop_id, rental_id, line_id, unit_id, period)
      VALUES (v_shop, p_rental_id, p_line_id, v_unit, public._period(p_start, p_end, v_need.variation_id, v_cleaning));
    END LOOP;
  END LOOP;
END $$;

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
  IF public._unit_kept_late(p_new_unit_id) THEN
    RAISE EXCEPTION 'That piece is still out with another customer past its return date';
  END IF;
  UPDATE public.unit_reservations SET unit_id = p_new_unit_id WHERE id = v_res.id;
EXCEPTION WHEN exclusion_violation THEN
  RAISE EXCEPTION 'That unit is booked by someone else for these dates';
END $$;

-- ------------------------------------------------------------------------------
-- 2. the deposit goes back at return or cancellation
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_rental_payment(p_rental_id uuid, p_kind text, p_amount numeric, p_method text DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_r RECORD;
BEGIN
  PERFORM public._require_role();
  SELECT * INTO v_r FROM public.rentals WHERE id = p_rental_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental not found';
  END IF;
  PERFORM public._require_branch(v_r.branch_id);
  IF p_kind NOT IN ('payment', 'deposit', 'deposit_refund', 'deposit_applied') THEN
    RAISE EXCEPTION 'Unknown payment type: %', p_kind;
  END IF;
  IF v_r.status IN ('cancelled', 'no_show') AND p_kind <> 'deposit_refund' THEN
    RAISE EXCEPTION 'This rental is cancelled';
  END IF;
  IF p_kind = 'deposit_refund' AND v_r.status IN ('reserved', 'active')
     AND public.get_my_role() NOT IN ('super_admin', 'owner') THEN
    RAISE EXCEPTION 'The deposit is given back when the rental is returned or cancelled. Only the owner can give it back earlier';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Enter an amount above zero';
  END IF;
  PERFORM public._insert_payment(p_rental_id, p_kind, p_amount, p_method, p_note);
  RETURN (SELECT jsonb_build_object('total', total, 'paid', paid, 'balance', total - paid,
                                    'deposit_held', deposit_received - deposit_refunded - deposit_applied)
          FROM public.rentals WHERE id = p_rental_id);
END $$;

-- ------------------------------------------------------------------------------
-- 3. a return time far in the past (a wrapper around the existing function)
-- ------------------------------------------------------------------------------
ALTER FUNCTION public.complete_rental(uuid, jsonb) RENAME TO _complete_rental_core;

CREATE OR REPLACE FUNCTION public.complete_rental(p_rental_id uuid, p jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_returned timestamptz := COALESCE((p ->> 'returned_at')::timestamptz, now());
BEGIN
  PERFORM public._require_role();
  IF v_returned < now() - interval '2 hours' THEN
    IF public.get_my_role() NOT IN ('super_admin', 'owner', 'manager') THEN
      RAISE EXCEPTION 'A return time more than 2 hours ago needs a manager or the owner';
    END IF;
    INSERT INTO public.audit_log (shop_id, performed_by, via, action, table_name, record_id, reason, new_data)
    VALUES (public.current_shop_id(), auth.uid(), 'app', 'update', 'rentals', p_rental_id,
            'Return recorded for an earlier time', jsonb_build_object('returned_at', v_returned));
  END IF;
  RETURN public._complete_rental_core(p_rental_id, p);
END $$;

ALTER FUNCTION public.complete_rental(uuid, jsonb) OWNER TO app_rpc;
ALTER FUNCTION public._complete_rental_core(uuid, jsonb) OWNER TO app_rpc;
REVOKE ALL ON FUNCTION public.complete_rental(uuid, jsonb), public._complete_rental_core(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_rental(uuid, jsonb) TO authenticated;

-- ------------------------------------------------------------------------------
-- 4. free trial
-- ------------------------------------------------------------------------------
ALTER TABLE public.shops ADD COLUMN trial_ends date;

-- create_shop also fixes a launch blocker: a clothing shop's first category had no base SKU, which the SKU rule
-- (migration 13) refuses, so Zypher could not create a bridal shop. It now starts with the base SKU CL (editable).
CREATE OR REPLACE FUNCTION public.create_shop(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid;
  v_types text[] := ARRAY(SELECT jsonb_array_elements_text(p -> 'business_types'));
  v_branch text := btrim(p ->> 'branch_name');
  v_days integer := COALESCE((p ->> 'trial_days')::integer, 14);
BEGIN
  PERFORM public._require_zypher();
  IF v_branch IS NULL OR v_branch = '' THEN
    RAISE EXCEPTION 'The first branch needs a name';
  END IF;
  IF v_days < 0 OR v_days > 90 THEN
    RAISE EXCEPTION 'The trial is 0 to 90 days';
  END IF;

  INSERT INTO public.shops (name, slug, token_prefix, business_types, plan, monthly_fee, phone, email, address, trial_ends)
  VALUES (btrim(p ->> 'name'), lower(btrim(p ->> 'slug')), upper(btrim(p ->> 'token_prefix')), v_types,
          COALESCE(p ->> 'plan', 'starter'), round(COALESCE((p ->> 'monthly_fee')::numeric, 0), 2),
          NULLIF(btrim(p ->> 'phone'), ''), NULLIF(btrim(p ->> 'email'), ''), NULLIF(btrim(p ->> 'address'), ''),
          (now() AT TIME ZONE 'Asia/Kolkata')::date + v_days)
  RETURNING id INTO v_shop;

  INSERT INTO public.branches (shop_id, name, slug, phone, address)
  VALUES (v_shop, v_branch, trim(BOTH '-' FROM lower(regexp_replace(v_branch, '[^a-zA-Z0-9]+', '-', 'g'))), p ->> 'phone', p ->> 'address');

  INSERT INTO public.categories (shop_id, name, template_key, sku_prefix)
  SELECT v_shop, t.name, t.key, CASE WHEN t.key = 'clothing' THEN 'CL' END
  FROM public.business_templates t WHERE t.key = ANY (v_types);

  INSERT INTO public.add_ons (shop_id, name, basis, amount, template_keys)
  SELECT DISTINCT ON (a ->> 'name') v_shop, a ->> 'name', a ->> 'basis', (a ->> 'amount')::numeric, ARRAY[t.key]
  FROM public.business_templates t, jsonb_array_elements(t.default_add_ons) a
  WHERE t.key = ANY (v_types);

  RETURN v_shop;
END $$;

CREATE OR REPLACE FUNCTION public.pause_overdue_shops()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_days integer;
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_count integer;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    PERFORM public._require_zypher();
  END IF;
  SELECT auto_pause_after_days INTO v_days FROM public.platform_settings WHERE id = 1;
  IF v_days IS NULL THEN
    RETURN 0;
  END IF;
  WITH paused AS (
    UPDATE public.shops SET status = 'suspended'
    WHERE status = 'active' AND monthly_fee > 0
      AND (trial_ends IS NULL OR trial_ends < v_today)
      AND (paid_until IS NULL OR paid_until < v_today - v_days)
    RETURNING id, paid_until
  )
  INSERT INTO public.audit_log (shop_id, performed_by, via, action, table_name, record_id, reason, new_data)
  SELECT id, auth.uid(), CASE WHEN auth.uid() IS NULL THEN 'sql' ELSE 'app' END, 'update', 'shops', id,
         'Paused automatically: payment overdue more than ' || v_days || ' days',
         jsonb_build_object('status', 'suspended', 'paid_until', paid_until)
  FROM paused;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

-- ------------------------------------------------------------------------------
-- 5. settings keys, unblocking customers
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_my_shop(p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid;
  v_bad text;
BEGIN
  PERFORM public._require_role(ARRAY['super_admin', 'owner']);
  v_shop := public.current_shop_id();
  IF jsonb_typeof(p -> 'settings') = 'object' THEN
    SELECT k INTO v_bad FROM jsonb_object_keys(p -> 'settings') k
    WHERE k NOT IN ('grace_minutes', 'check_in_time', 'check_out_time', 'require_licence', 'gst_percent', 'receipt_note',
                    'sac_code', 'plan', 'features')   -- plan and features are Zypher's and are dropped below, as before
    LIMIT 1;
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'Unknown setting: %', v_bad;
    END IF;
  END IF;
  UPDATE public.shops SET
    phone = CASE WHEN p ? 'phone' THEN NULLIF(btrim(p ->> 'phone'), '') ELSE phone END,
    email = CASE WHEN p ? 'email' THEN NULLIF(btrim(p ->> 'email'), '') ELSE email END,
    address = CASE WHEN p ? 'address' THEN NULLIF(btrim(p ->> 'address'), '') ELSE address END,
    gstin = CASE WHEN p ? 'gstin' THEN NULLIF(upper(btrim(p ->> 'gstin')), '') ELSE gstin END,
    logo_url = CASE WHEN p ? 'logo_url' THEN NULLIF(p ->> 'logo_url', '') ELSE logo_url END,
    settings = settings || (COALESCE(p -> 'settings', '{}') - 'plan' - 'features')
  WHERE id = v_shop;
END $$;

CREATE OR REPLACE FUNCTION public.guard_customer_unblock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  IF OLD.is_blocked AND NOT NEW.is_blocked AND auth.uid() IS NOT NULL
     AND COALESCE(public.get_my_role(), '') NOT IN ('super_admin', 'owner', 'manager') THEN
    RAISE EXCEPTION 'Only a manager or the owner can unblock a customer';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_customer_unblock BEFORE UPDATE OF is_blocked ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.guard_customer_unblock();

-- ------------------------------------------------------------------------------
-- 6. price changes are logged
-- ------------------------------------------------------------------------------
CREATE TABLE public.price_changes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     uuid NOT NULL REFERENCES public.shops(id),
  rental_id   uuid NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('discount', 'agreed_price')),
  line_id     uuid,
  previous    numeric(14,2) NOT NULL DEFAULT 0,      -- the list price, or the discount before
  amount      numeric(14,2) NOT NULL,                -- the agreed price, or the discount now
  created_by  uuid REFERENCES public.profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT price_changes_shop_rental_fkey FOREIGN KEY (shop_id, rental_id) REFERENCES public.rentals (shop_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_price_changes_shop_created ON public.price_changes (shop_id, created_at DESC);
CREATE INDEX idx_price_changes_rental ON public.price_changes (shop_id, rental_id);

ALTER TABLE public.price_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_isolation ON public.price_changes AS RESTRICTIVE FOR ALL
  USING (shop_id = (SELECT public.current_shop_id())) WITH CHECK (shop_id = (SELECT public.current_shop_id()));
CREATE POLICY rpc_all ON public.price_changes FOR ALL TO app_rpc USING (true) WITH CHECK (true);
CREATE POLICY price_changes_read ON public.price_changes FOR SELECT
  USING ((SELECT public.get_my_role()) IN ('super_admin', 'owner')
         OR ((SELECT public.get_my_role()) = 'manager' AND EXISTS (SELECT 1 FROM public.rentals r WHERE r.id = rental_id)));
REVOKE ALL ON public.price_changes FROM authenticated;
GRANT SELECT ON public.price_changes TO authenticated;

CREATE OR REPLACE FUNCTION public.log_discount_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  INSERT INTO public.price_changes (shop_id, rental_id, kind, previous, amount, created_by)
  VALUES (NEW.shop_id, NEW.id, 'discount', COALESCE(OLD.discount, 0), NEW.discount, auth.uid());
  RETURN NEW;
END $$;
CREATE TRIGGER trg_log_discount AFTER UPDATE OF discount ON public.rentals
  FOR EACH ROW WHEN (NEW.discount IS DISTINCT FROM OLD.discount) EXECUTE FUNCTION public.log_discount_change();

CREATE OR REPLACE FUNCTION public.log_agreed_price()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  IF NEW.is_override AND (TG_OP = 'INSERT' OR OLD.amount IS DISTINCT FROM NEW.amount OR NOT OLD.is_override) THEN
    INSERT INTO public.price_changes (shop_id, rental_id, kind, line_id, previous, amount, created_by)
    VALUES (NEW.shop_id, NEW.rental_id, 'agreed_price', NEW.id, round(NEW.rate * NEW.time_units * NEW.qty, 2), NEW.amount, auth.uid());
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_log_agreed_price AFTER INSERT OR UPDATE OF amount, is_override ON public.rental_lines
  FOR EACH ROW EXECUTE FUNCTION public.log_agreed_price();

-- ------------------------------------------------------------------------------
-- 7. indexes
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_customer_measurements_customer ON public.customer_measurements (shop_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_appointments_rental ON public.appointments (rental_id);
CREATE INDEX IF NOT EXISTS idx_appointments_customer ON public.appointments (customer_id);
CREATE INDEX IF NOT EXISTS idx_staff_invites_shop ON public.staff_invites (shop_id);

ALTER FUNCTION public._unit_kept_late(uuid) OWNER TO app_rpc;
ALTER FUNCTION public.log_discount_change() OWNER TO app_rpc;
ALTER FUNCTION public.log_agreed_price() OWNER TO app_rpc;
ALTER FUNCTION public.guard_customer_unblock() OWNER TO app_rpc;
REVOKE ALL ON FUNCTION public._unit_kept_late(uuid), public.log_discount_change(), public.log_agreed_price(), public.guard_customer_unblock() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._unit_kept_late(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
