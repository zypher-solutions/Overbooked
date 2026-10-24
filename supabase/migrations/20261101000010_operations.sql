-- Overbooked v2 — day-to-day operations: editing a booking, sets, reminders, Zypher company details,
-- automatic pause of long-overdue shops, measurement fields.

-- ==============================================================================
-- Reserving the units of one booked line (shared by create_rental and update_rental).
-- Chosen units are checked; otherwise preferred units (the ones a booking already had) come first.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public._reserve_line(p_rental_id uuid, p_line_id uuid, p_line jsonb, p_branch uuid,
                                                p_start timestamptz, p_end timestamptz, p_prefer uuid[] DEFAULT '{}')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_need RECORD;
  v_chosen uuid[];
  v_found integer;
  v_unit uuid;
  v_shop uuid := public.current_shop_id();
BEGIN
  -- what to reserve: the variation itself, or the pieces of a set
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
    ELSE
      v_chosen := ARRAY(
        SELECT a.unit_id FROM public.available_units(p_branch, v_need.variation_id, p_start, p_end) a
        ORDER BY (a.unit_id = ANY (p_prefer)) DESC, a.code
        LIMIT v_need.qty);
      IF cardinality(v_chosen) < v_need.qty THEN
        RAISE EXCEPTION 'Only % of % available for % on these dates', cardinality(v_chosen), v_need.qty, p_line ->> 'description';
      END IF;
    END IF;

    FOREACH v_unit IN ARRAY v_chosen LOOP
      INSERT INTO public.unit_reservations (shop_id, rental_id, line_id, unit_id, period)
      VALUES (v_shop, p_rental_id, p_line_id, v_unit, public._period(p_start, p_end, v_need.variation_id));
    END LOOP;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public._insert_lines(p_rental_id uuid, p_quote jsonb, p_branch uuid, p_start timestamptz,
                                                p_end timestamptz, p_prefer uuid[] DEFAULT '{}')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_line jsonb;
  v_line_id uuid;
  v_shop uuid := public.current_shop_id();
BEGIN
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_quote -> 'lines') LOOP
    INSERT INTO public.rental_lines (shop_id, rental_id, product_id, variation_id, kind, description, sku, image_url,
                                     qty, rate_type, rate, time_units, amount, is_override)
    VALUES (v_shop, p_rental_id, (v_line ->> 'product_id')::uuid, (v_line ->> 'variation_id')::uuid, v_line ->> 'kind',
            v_line ->> 'description', v_line ->> 'sku', v_line ->> 'image_url', (v_line ->> 'qty')::integer,
            v_line ->> 'rate_type', (v_line ->> 'rate')::numeric, (v_line ->> 'time_units')::numeric,
            (v_line ->> 'amount')::numeric, (v_line ->> 'is_override')::boolean)
    RETURNING id INTO v_line_id;
    IF (v_line ->> 'reserve')::boolean THEN
      PERFORM public._reserve_line(p_rental_id, v_line_id, v_line, p_branch, p_start, p_end, p_prefer);
    END IF;
  END LOOP;

  INSERT INTO public.rental_add_ons (shop_id, rental_id, add_on_id, name, basis, quantity, unit_amount, amount)
  SELECT v_shop, p_rental_id, (a ->> 'add_on_id')::uuid, a ->> 'name', a ->> 'basis',
         (a ->> 'quantity')::numeric, (a ->> 'unit_amount')::numeric, (a ->> 'amount')::numeric
  FROM jsonb_array_elements(p_quote -> 'add_ons') a;
END $$;

-- create_rental, now using the shared helpers (same behaviour as before)
CREATE OR REPLACE FUNCTION public.create_rental(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid;
  v_tz text;
  v_branch uuid := (p ->> 'branch_id')::uuid;
  v_start timestamptz := (p ->> 'start_at')::timestamptz;
  v_end timestamptz := (p ->> 'end_at')::timestamptz;
  v_quote jsonb;
  v_cust RECORD;
  v_rental uuid;
  v_token text;
  v_discount numeric := round(COALESCE((p ->> 'discount')::numeric, 0), 2);
  v_total numeric;
BEGIN
  PERFORM public._require_role();
  PERFORM public._require_branch(v_branch);
  v_shop := public.current_shop_id();
  v_tz := public._shop_tz();

  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id = v_branch AND is_active) THEN
    RAISE EXCEPTION 'Choose an active branch';
  END IF;
  IF (v_start AT TIME ZONE v_tz)::date < (now() AT TIME ZONE v_tz)::date THEN
    RAISE EXCEPTION 'The start cannot be in the past';
  END IF;
  IF v_discount < 0 THEN
    RAISE EXCEPTION 'The discount cannot be negative';
  END IF;

  v_quote := public._quote(p);

  -- customer: an existing one, or a new one
  IF p -> 'customer' ? 'id' THEN
    SELECT * INTO v_cust FROM public.customers WHERE id = (p -> 'customer' ->> 'id')::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Customer not found';
    END IF;
  ELSE
    INSERT INTO public.customers (shop_id, full_name, phone, email, address, id_type, id_number, licence_number, licence_expiry)
    VALUES (v_shop, btrim(p -> 'customer' ->> 'full_name'), regexp_replace(COALESCE(p -> 'customer' ->> 'phone', ''), '[\s-]', '', 'g'),
            NULLIF(btrim(p -> 'customer' ->> 'email'), ''), NULLIF(btrim(p -> 'customer' ->> 'address'), ''),
            NULLIF(p -> 'customer' ->> 'id_type', ''), NULLIF(btrim(p -> 'customer' ->> 'id_number'), ''),
            NULLIF(btrim(p -> 'customer' ->> 'licence_number'), ''), NULLIF(p -> 'customer' ->> 'licence_expiry', '')::date)
    RETURNING * INTO v_cust;
  END IF;
  IF v_cust.is_blocked THEN
    RAISE EXCEPTION 'This customer is blocked: %', COALESCE(v_cust.blocked_reason, 'no reason given');
  END IF;

  INSERT INTO public.rentals (shop_id, branch_id, customer_id, token, start_at, end_at, adults, children,
                              with_driver, whole_property, deposit_agreed, notes, created_by)
  VALUES (v_shop, v_branch, v_cust.id, '', v_start, v_end,
          COALESCE((p ->> 'adults')::integer, 1), COALESCE((p ->> 'children')::integer, 0),
          COALESCE((p ->> 'with_driver')::boolean, false), COALESCE((p ->> 'whole_property')::boolean, false),
          round(COALESCE((p ->> 'deposit_agreed')::numeric, 0), 2), NULLIF(btrim(p ->> 'notes'), ''), auth.uid())
  RETURNING id, token INTO v_rental, v_token;

  PERFORM public._insert_lines(v_rental, v_quote, v_branch, v_start, v_end);

  IF v_discount > (v_quote ->> 'total_before_discount')::numeric THEN
    RAISE EXCEPTION 'The discount (%) cannot be more than the total (%)', v_discount, v_quote ->> 'total_before_discount';
  END IF;
  UPDATE public.rentals SET discount = v_discount WHERE id = v_rental;

  PERFORM public._insert_payment(v_rental, 'payment', public._money(p, 'advance'), p -> 'advance' ->> 'method', 'Advance');
  PERFORM public._insert_payment(v_rental, 'deposit', public._money(p, 'deposit'), p -> 'deposit' ->> 'method', 'Security deposit');

  SELECT total INTO v_total FROM public.rentals WHERE id = v_rental;
  RETURN jsonb_build_object('rental_id', v_rental, 'token', v_token, 'total', v_total);
EXCEPTION WHEN exclusion_violation THEN
  RAISE EXCEPTION 'One of the units was just booked by someone else for these dates. Choose another.';
END $$;

-- ==============================================================================
-- update_rental: change a booking before pickup (dates, items, guests, driver, extras, discount,
-- deposit agreed, notes). Same input as the booking form; the units it already had are kept where possible.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.update_rental(p_rental_id uuid, p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_r RECORD;
  v_tz text := public._shop_tz();
  v_start timestamptz := (p ->> 'start_at')::timestamptz;
  v_end timestamptz := (p ->> 'end_at')::timestamptz;
  v_input jsonb;
  v_quote jsonb;
  v_prefer uuid[];
  v_old_lines uuid[];
  v_old_add_ons uuid[];
  v_discount numeric;
BEGIN
  PERFORM public._require_role();
  SELECT * INTO v_r FROM public.rentals WHERE id = p_rental_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental not found';
  END IF;
  PERFORM public._require_branch(v_r.branch_id);
  IF v_r.status <> 'reserved' THEN
    RAISE EXCEPTION 'Only a booking that has not been picked up can be changed. Use extend or add a charge instead.';
  END IF;
  IF (v_start AT TIME ZONE v_tz)::date < (now() AT TIME ZONE v_tz)::date AND v_start <> v_r.start_at THEN
    RAISE EXCEPTION 'The start cannot be in the past';
  END IF;
  v_discount := round(COALESCE((p ->> 'discount')::numeric, v_r.discount), 2);
  IF v_discount < 0 THEN
    RAISE EXCEPTION 'The discount cannot be negative';
  END IF;

  -- the replaced lines land in the audit log with this reason
  PERFORM set_config('app.audit_reason', 'Booking changed before pickup', true);
  v_input := p || jsonb_build_object('branch_id', v_r.branch_id);
  v_quote := public._quote(v_input);

  SELECT array_agg(unit_id) INTO v_prefer FROM public.unit_reservations WHERE rental_id = p_rental_id AND state = 'held';
  SELECT array_agg(id) INTO v_old_lines FROM public.rental_lines WHERE rental_id = p_rental_id;
  SELECT array_agg(id) INTO v_old_add_ons FROM public.rental_add_ons WHERE rental_id = p_rental_id;

  -- order matters: the money checks hold at every step (paid <= total, discount <= subtotal)
  UPDATE public.rentals SET discount = 0 WHERE id = p_rental_id;
  DELETE FROM public.unit_reservations WHERE rental_id = p_rental_id;
  PERFORM public._insert_lines(p_rental_id, v_quote, v_r.branch_id, v_start, v_end, COALESCE(v_prefer, '{}'));
  BEGIN
    DELETE FROM public.rental_add_ons WHERE id = ANY (COALESCE(v_old_add_ons, '{}'));
    DELETE FROM public.rental_lines WHERE id = ANY (COALESCE(v_old_lines, '{}'));
    IF v_discount > (v_quote ->> 'total_before_discount')::numeric THEN
      RAISE EXCEPTION 'The discount (%) cannot be more than the total (%)', v_discount, v_quote ->> 'total_before_discount';
    END IF;
    UPDATE public.rentals SET discount = v_discount, start_at = v_start, end_at = v_end,
      adults = COALESCE((p ->> 'adults')::integer, adults), children = COALESCE((p ->> 'children')::integer, children),
      with_driver = COALESCE((p ->> 'with_driver')::boolean, with_driver),
      whole_property = COALESCE((p ->> 'whole_property')::boolean, whole_property),
      deposit_agreed = round(COALESCE((p ->> 'deposit_agreed')::numeric, deposit_agreed), 2),
      notes = CASE WHEN p ? 'notes' THEN NULLIF(btrim(p ->> 'notes'), '') ELSE notes END
    WHERE id = p_rental_id;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'The new total would be less than what was already paid. Record a refund first, then change the booking.';
  END;

  RETURN (SELECT jsonb_build_object('total', total, 'paid', paid, 'balance', total - paid) FROM public.rentals WHERE id = p_rental_id);
EXCEPTION WHEN exclusion_violation THEN
  RAISE EXCEPTION 'One of the units is booked by someone else for the new dates. Choose others.';
END $$;

-- ==============================================================================
-- Sets: free when every piece is free (whole sets only)
-- ==============================================================================
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
  WITH plain AS (
    SELECT v.id AS vid,
           count(u.id) FILTER (WHERE NOT EXISTS (
             SELECT 1 FROM public.unit_reservations ur
             WHERE ur.unit_id = u.id AND ur.state <> 'released'
               AND ur.period && tstzrange(p_start, p_end + v.turnaround, '[)')))::integer AS free,
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

-- save_product with sets: p.is_set and p.set_items = [{variation_id, qty}] (the "sets" feature must be on)
CREATE OR REPLACE FUNCTION public.save_set_items(p_product_id uuid, p_items jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid;
BEGIN
  PERFORM public._require_role(ARRAY['super_admin', 'owner', 'manager']);
  v_shop := public.current_shop_id();
  IF NOT public.shop_feature(v_shop, 'sets') THEN
    RAISE EXCEPTION 'Sets are not switched on for this shop';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id) THEN
    RAISE EXCEPTION 'Product not found';
  END IF;
  IF jsonb_array_length(COALESCE(p_items, '[]')) = 0 THEN
    RAISE EXCEPTION 'A set needs at least one piece';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) x
             JOIN public.product_variations v ON v.id = (x ->> 'variation_id')::uuid
             JOIN public.products pr ON pr.id = v.product_id
             WHERE pr.is_set OR pr.id = p_product_id) THEN
    RAISE EXCEPTION 'A set cannot contain itself or another set';
  END IF;
  IF EXISTS (SELECT 1 FROM public.unit_reservations ur JOIN public.rental_lines rl ON rl.id = ur.line_id
             WHERE rl.product_id = p_product_id AND ur.state IN ('held', 'out')) THEN
    RAISE EXCEPTION 'This set is booked; change its pieces after those bookings';
  END IF;
  UPDATE public.products SET is_set = true WHERE id = p_product_id;
  DELETE FROM public.set_items WHERE set_product_id = p_product_id;
  INSERT INTO public.set_items (shop_id, set_product_id, variation_id, qty)
  SELECT v_shop, p_product_id, (x ->> 'variation_id')::uuid, GREATEST(1, COALESCE((x ->> 'qty')::integer, 1))
  FROM jsonb_array_elements(p_items) x;
END $$;

-- ==============================================================================
-- Reminders sent by hand (WhatsApp from the counter phone), so nobody sends one twice
-- ==============================================================================
CREATE TABLE public.rental_reminders (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id    uuid NOT NULL REFERENCES public.shops(id),
  rental_id  uuid NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('confirmation', 'pickup_reminder', 'return_reminder', 'receipt', 'overdue')),
  sent_at    timestamptz NOT NULL DEFAULT now(),
  sent_by    uuid REFERENCES public.profiles(id),
  CONSTRAINT rental_reminders_shop_rental_fkey FOREIGN KEY (shop_id, rental_id) REFERENCES public.rentals (shop_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_rental_reminders_rental ON public.rental_reminders (shop_id, rental_id);
ALTER TABLE public.rental_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_isolation ON public.rental_reminders AS RESTRICTIVE FOR ALL
  USING (shop_id = (SELECT public.current_shop_id())) WITH CHECK (shop_id = (SELECT public.current_shop_id()));
CREATE POLICY rpc_all ON public.rental_reminders FOR ALL TO app_rpc USING (true) WITH CHECK (true);
CREATE POLICY rental_child_read ON public.rental_reminders FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.rentals r WHERE r.id = rental_id));
GRANT SELECT ON public.rental_reminders TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_reminder_sent(p_rental_id uuid, p_kind text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_branch uuid;
BEGIN
  PERFORM public._require_role();
  SELECT branch_id INTO v_branch FROM public.rentals WHERE id = p_rental_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rental not found'; END IF;
  PERFORM public._require_branch(v_branch);
  INSERT INTO public.rental_reminders (shop_id, rental_id, kind, sent_by)
  VALUES (public.current_shop_id(), p_rental_id, p_kind, auth.uid());
END $$;

-- ==============================================================================
-- Zypher's own details (receipts to shops, bank details shown to owners) and billing rules
-- ==============================================================================
CREATE TABLE public.platform_settings (
  id                      integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  company_name            text NOT NULL DEFAULT 'Zypher',
  address                 text,
  gstin                   text,
  phone                   text,
  email                   text,
  bank_details            text,           -- shown to owners: account, IFSC, UPI id
  auto_pause_after_days   integer CHECK (auto_pause_after_days IS NULL OR auto_pause_after_days >= 0),  -- NULL = never
  updated_at              timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.platform_settings (id) VALUES (1);
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
-- signed-in people read it (owners see where to pay); only Zypher changes it
CREATE POLICY platform_settings_read ON public.platform_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY platform_settings_admin ON public.platform_settings FOR UPDATE
  USING ((SELECT public.is_platform_admin())) WITH CHECK ((SELECT public.is_platform_admin()));
GRANT SELECT, UPDATE ON public.platform_settings TO authenticated;

-- shops more than N days past their paid-until date are paused; runs nightly, and Zypher can run it by hand
CREATE OR REPLACE FUNCTION public.pause_overdue_shops()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_days integer;
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_count integer;
BEGIN
  -- the nightly job runs without a user; a person calling it must be Zypher
  IF auth.uid() IS NOT NULL THEN
    PERFORM public._require_zypher();
  END IF;
  SELECT auto_pause_after_days INTO v_days FROM public.platform_settings WHERE id = 1;
  IF v_days IS NULL THEN
    RETURN 0;
  END IF;
  WITH paused AS (
    UPDATE public.shops SET status = 'suspended'
    WHERE status = 'active' AND monthly_fee > 0 AND (paid_until IS NULL OR paid_until < v_today - v_days)
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

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule('pause-overdue-shops', '30 19 * * *', 'SELECT public.pause_overdue_shops()');  -- 1 am India time
  END IF;
END $$;

-- ==============================================================================
-- Measurements (optional feature): the fields each wear type asks for
-- ==============================================================================
ALTER TABLE public.business_templates ADD COLUMN measurement_fields jsonb NOT NULL DEFAULT '[]';
UPDATE public.business_templates SET measurement_fields =
  '["Bust", "Waist", "Hip", "Shoulder", "Sleeve length", "Arm hole", "Blouse length", "Full length", "Neck (front)", "Neck (back)"]'
WHERE key = 'bridal';
UPDATE public.business_templates SET measurement_fields =
  '["Chest", "Waist", "Hip", "Shoulder", "Sleeve length", "Neck", "Top length", "Inseam", "Trouser length", "Shoe size"]'
WHERE key = 'groom';

-- ==============================================================================
-- Ownership and grants
-- ==============================================================================
ALTER FUNCTION public._reserve_line(uuid, uuid, jsonb, uuid, timestamptz, timestamptz, uuid[]) OWNER TO app_rpc;
ALTER FUNCTION public._insert_lines(uuid, jsonb, uuid, timestamptz, timestamptz, uuid[]) OWNER TO app_rpc;
ALTER FUNCTION public.update_rental(uuid, jsonb) OWNER TO app_rpc;
ALTER FUNCTION public.save_set_items(uuid, jsonb) OWNER TO app_rpc;
ALTER FUNCTION public.mark_reminder_sent(uuid, text) OWNER TO app_rpc;

REVOKE EXECUTE ON FUNCTION public._reserve_line(uuid, uuid, jsonb, uuid, timestamptz, timestamptz, uuid[]),
  public._insert_lines(uuid, jsonb, uuid, timestamptz, timestamptz, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_rental(uuid, jsonb), public.save_set_items(uuid, jsonb),
  public.mark_reminder_sent(uuid, text), public.pause_overdue_shops() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_rental(uuid, jsonb), public.save_set_items(uuid, jsonb),
  public.mark_reminder_sent(uuid, text), public.pause_overdue_shops() TO authenticated;

NOTIFY pgrst, 'reload schema';
