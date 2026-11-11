-- Late returns (launch pack 1, part B; docs/LAUNCH_PACK_1_PLAN.md).
--   * New shop settings for late fees on clothes. Their defaults are today's rule (catalogue day rate x days late,
--     calendar days, no cut-off time, no cap), so a shop that changes nothing charges exactly what it charged before.
--   * Each new booking keeps a copy of the rules in force (`rentals.late_terms`), so changing the setting never reprices
--     an existing booking. Bookings made before this migration have none and keep the old formula unchanged.
--   * A product may have its own late fee per piece per day (`products.late_fee_per_day`, set by set_product_late_fee).
--   * A booking can be put "on hold" with a note when its piece is still out late with another customer; a held booking
--     cannot be handed over until the hold is removed. late_clashes() lists the pieces kept late and the booking next in line.
-- Additive only: hourly, nightly and vehicle late charges, the km charges, support logins and every other function are
-- unchanged. update_my_shop keeps its role check; only its list of allowed keys grows.

ALTER TABLE public.rentals
  ADD COLUMN late_terms jsonb,
  ADD COLUMN handover_hold_note text CHECK (handover_hold_note IS NULL OR length(handover_hold_note) BETWEEN 1 AND 200),
  ADD COLUMN handover_hold_at timestamptz,
  ADD COLUMN handover_hold_by uuid;
ALTER TABLE public.products
  ADD COLUMN late_fee_per_day numeric(14,2) CHECK (late_fee_per_day IS NULL OR late_fee_per_day >= 0);

-- ------------------------------------------------------------------------------
-- settings
-- ------------------------------------------------------------------------------
-- one shop setting as text, or the default
CREATE OR REPLACE FUNCTION public._shop_rule(p_shop uuid, p_key text, p_default text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT COALESCE((SELECT NULLIF(settings ->> p_key, '') FROM public.shops WHERE id = p_shop), p_default);
$$;

-- the late rules a new booking of this shop gets (defaults = the rule before this migration)
CREATE OR REPLACE FUNCTION public._late_terms(p_shop uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT jsonb_build_object(
    'on',          public._shop_rule(p_shop, 'late_fee_on', 'true')::boolean,
    'mode',        public._shop_rule(p_shop, 'late_fee_mode', 'percent'),
    'percent',     public._shop_rule(p_shop, 'late_fee_percent', '100')::numeric,
    'fixed',       public._shop_rule(p_shop, 'late_fee_fixed', '0')::numeric,
    'basis',       public._shop_rule(p_shop, 'late_fee_basis', 'catalogue'),
    'cutoff',      public._shop_rule(p_shop, 'late_cutoff_time', NULL),
    'count',       public._shop_rule(p_shop, 'late_day_count', 'calendar'),
    'cap',         public._shop_rule(p_shop, 'late_cap', 'none'),
    'cap_percent', public._shop_rule(p_shop, 'late_cap_percent', '100')::numeric);
$$;

CREATE OR REPLACE FUNCTION public._rental_late_terms()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  NEW.late_terms := COALESCE(NEW.late_terms, public._late_terms(NEW.shop_id));
  RETURN NEW;
END $$;
CREATE TRIGGER trg_rental_late_terms BEFORE INSERT ON public.rentals FOR EACH ROW EXECUTE FUNCTION public._rental_late_terms();

-- 022's version; the late-return keys are allowed and checked
CREATE OR REPLACE FUNCTION public.update_my_shop(p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid;
  v_bad text;
  s jsonb := COALESCE(p -> 'settings', '{}');
BEGIN
  PERFORM public._require_role(ARRAY['super_admin', 'owner']);
  v_shop := public.current_shop_id();
  IF jsonb_typeof(p -> 'settings') = 'object' THEN
    SELECT k INTO v_bad FROM jsonb_object_keys(p -> 'settings') k
    WHERE k NOT IN ('grace_minutes', 'check_in_time', 'check_out_time', 'require_licence', 'gst_percent', 'receipt_note',
                    'sac_code', 'plan', 'features',   -- plan and features are Zypher's and are dropped below, as before
                    'late_fee_on', 'late_fee_mode', 'late_fee_percent', 'late_fee_fixed', 'late_fee_basis',
                    'late_cutoff_time', 'late_day_count', 'late_cap', 'late_cap_percent', 'late_clash_action')
    LIMIT 1;
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'Unknown setting: %', v_bad;
    END IF;
    IF s ? 'late_fee_on' AND jsonb_typeof(s -> 'late_fee_on') <> 'boolean' THEN
      RAISE EXCEPTION 'Late fees are on or off';
    END IF;
    IF s ? 'late_fee_mode' AND s ->> 'late_fee_mode' NOT IN ('percent', 'fixed') THEN
      RAISE EXCEPTION 'The late fee is a percentage of the daily price or a fixed amount';
    END IF;
    IF s ? 'late_fee_percent' AND (jsonb_typeof(s -> 'late_fee_percent') <> 'number'
       OR (s ->> 'late_fee_percent')::numeric NOT BETWEEN 0 AND 300) THEN
      RAISE EXCEPTION 'The late fee percentage is 0 to 300';
    END IF;
    IF s ? 'late_cap_percent' AND (jsonb_typeof(s -> 'late_cap_percent') <> 'number'
       OR (s ->> 'late_cap_percent')::numeric NOT BETWEEN 0 AND 300) THEN
      RAISE EXCEPTION 'The maximum late fee is 0 to 300 percent of the rent';
    END IF;
    IF s ? 'late_fee_fixed' AND (jsonb_typeof(s -> 'late_fee_fixed') <> 'number'
       OR (s ->> 'late_fee_fixed')::numeric NOT BETWEEN 0 AND 10000000
       OR (s ->> 'late_fee_fixed')::numeric <> round((s ->> 'late_fee_fixed')::numeric, 2)) THEN
      RAISE EXCEPTION 'The fixed late fee is 0 to 1,00,00,000 rupees, in rupees and paise';
    END IF;
    IF s ? 'late_fee_basis' AND s ->> 'late_fee_basis' NOT IN ('catalogue', 'agreed') THEN
      RAISE EXCEPTION 'The daily price is the catalogue rate or the agreed price';
    END IF;
    IF s ? 'late_cutoff_time' AND COALESCE(s ->> 'late_cutoff_time', '') <> ''
       AND s ->> 'late_cutoff_time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
      RAISE EXCEPTION 'The latest return time is a time like 20:00';
    END IF;
    IF s ? 'late_day_count' AND s ->> 'late_day_count' NOT IN ('calendar', 'blocks') THEN
      RAISE EXCEPTION 'Late days are counted as calendar days or 24-hour blocks';
    END IF;
    IF s ? 'late_cap' AND s ->> 'late_cap' NOT IN ('none', 'rent_percent', 'replacement') THEN
      RAISE EXCEPTION 'The maximum late fee is none, a percentage of the rent, or the replacement value';
    END IF;
    IF s ? 'late_clash_action' AND s ->> 'late_clash_action' NOT IN ('swap', 'hold') THEN
      RAISE EXCEPTION 'A late piece''s next booking is offered a swap or a hold';
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

-- ------------------------------------------------------------------------------
-- late fee of one clothing line under a booking's late terms (NULL terms: not used, the old formula applies)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._wearable_late_fee(p_terms jsonb, p_line public.rental_lines, p_end timestamptz,
                                                     p_returned timestamptz, p_tz text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_days integer;
  v_own numeric;
  v_per_day numeric;
  v_fee numeric;
  v_cap numeric;
  v_capped boolean := false;
  v_cutoff time := NULLIF(p_terms ->> 'cutoff', '')::time;
  v_how text;
BEGIN
  IF p_returned <= p_end THEN
    v_days := 0;
  ELSIF p_terms ->> 'count' = 'blocks' THEN
    v_days := ceil(extract(epoch FROM (p_returned - p_end)) / 86400.0)::integer;
  ELSE
    -- calendar days after the return day, plus the day of return when it is after the shop's latest return time
    v_days := (p_returned AT TIME ZONE p_tz)::date - (p_end AT TIME ZONE p_tz)::date
              + CASE WHEN v_cutoff IS NOT NULL AND (p_returned AT TIME ZONE p_tz)::time > v_cutoff THEN 1 ELSE 0 END;
  END IF;
  IF v_days <= 0 THEN
    RETURN jsonb_build_object('days', 0, 'amount', 0);
  END IF;

  SELECT late_fee_per_day INTO v_own FROM public.products WHERE id = p_line.product_id;
  IF v_own IS NOT NULL THEN
    v_per_day := v_own;
    v_how := 'this product''s late fee';
  ELSIF p_terms ->> 'mode' = 'fixed' THEN
    v_per_day := (p_terms ->> 'fixed')::numeric;
    v_how := 'fixed late fee';
  ELSE
    v_per_day := CASE WHEN p_terms ->> 'basis' = 'agreed' THEN p_line.amount / (p_line.qty * p_line.time_units) ELSE p_line.rate END
                 * (p_terms ->> 'percent')::numeric / 100;
    v_how := rtrim(to_char((p_terms ->> 'percent')::numeric, 'FM990.##'), '.') || '% of the '
             || CASE WHEN p_terms ->> 'basis' = 'agreed' THEN 'agreed' ELSE 'catalogue' END || ' daily price';
  END IF;
  v_per_day := round(v_per_day, 2);
  v_fee := round(p_line.qty * v_per_day * v_days, 2);

  IF p_terms ->> 'cap' = 'rent_percent' THEN
    v_cap := round(p_line.amount * (p_terms ->> 'cap_percent')::numeric / 100, 2);
  ELSIF p_terms ->> 'cap' = 'replacement' THEN
    SELECT NULLIF(round(p_line.qty * replacement_value, 2), 0) INTO v_cap FROM public.products WHERE id = p_line.product_id;
  END IF;
  IF v_cap IS NOT NULL AND v_fee > v_cap THEN
    v_fee := v_cap;
    v_capped := true;
  END IF;

  RETURN jsonb_build_object('days', v_days, 'amount', v_fee,
    'note', v_days || CASE WHEN v_days = 1 THEN ' day' ELSE ' days' END || ' late x ' || public._act_inr(v_per_day)
            || CASE WHEN p_line.qty > 1 THEN ' x ' || p_line.qty || ' pieces' ELSE '' END
            || ' (' || v_how || ')'
            || CASE WHEN v_capped THEN ', capped at ' ELSE ' = ' END || public._act_inr(v_fee) || ' - ' || p_line.description);
END $$;

-- 006's version: clothing lines of a booking with late terms follow them; everything else is unchanged
CREATE OR REPLACE FUNCTION public.return_suggestions(p_rental_id uuid, p_returned_at timestamptz DEFAULT now(), p_odometers jsonb DEFAULT '[]')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_r RECORD;
  v_tz text := public._shop_tz();
  v_grace interval;
  v_charges jsonb := '[]';
  v_line public.rental_lines;
  v_late_hours integer;
  v_late_days integer;
  v_rate numeric;
  v_penalty numeric := 0;
  v_unit RECORD;
  v_out integer;
  v_in integer;
  v_days integer;
  v_allow integer;
  v_extra integer;
  v_fee jsonb;
  v_late boolean;
BEGIN
  PERFORM public._require_role();
  SELECT * INTO v_r FROM public.rentals WHERE id = p_rental_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental not found';
  END IF;
  SELECT make_interval(mins => COALESCE((settings ->> 'grace_minutes')::integer, 60)) INTO v_grace
  FROM public.shops WHERE id = v_r.shop_id;

  FOR v_line IN SELECT * FROM public.rental_lines WHERE rental_id = p_rental_id AND rate_type IN ('day', 'hour', 'hour_day', 'night') LOOP
    v_rate := NULL;
    v_late := NULL;
    IF v_line.kind = 'wearable' AND v_r.late_terms IS NOT NULL THEN
      v_late := false;
      IF (v_r.late_terms ->> 'on')::boolean THEN
        v_fee := public._wearable_late_fee(v_r.late_terms, v_line, v_r.end_at, p_returned_at, v_tz);
        v_late := (v_fee ->> 'days')::integer > 0;
        IF (v_fee ->> 'amount')::numeric > 0 THEN
          v_charges := v_charges || jsonb_build_object('type', 'late', 'amount', (v_fee ->> 'amount')::numeric, 'note', v_fee ->> 'note');
        END IF;
      END IF;
    ELSIF v_line.kind = 'wearable' THEN
      v_late_days := (p_returned_at AT TIME ZONE v_tz)::date - (v_r.end_at AT TIME ZONE v_tz)::date;
      IF v_late_days > 0 THEN
        v_charges := v_charges || jsonb_build_object('type', 'late', 'amount', round(v_line.qty * v_line.rate * v_late_days, 2),
          'note', v_late_days || ' day(s) late - ' || v_line.description);
      END IF;
    ELSIF p_returned_at > v_r.end_at + v_grace THEN
      v_late_hours := ceil(extract(epoch FROM (p_returned_at - v_r.end_at)) / 3600.0)::integer;
      SELECT amount INTO v_rate FROM public.variation_rates WHERE variation_id = v_line.variation_id AND rate_type = 'extra_hour';
      IF v_rate IS NULL AND v_line.kind = 'vehicle' THEN
        SELECT amount INTO v_rate FROM public.variation_rates WHERE variation_id = v_line.variation_id AND rate_type = 'hour';
      END IF;
      IF v_rate IS NULL AND v_line.kind = 'vehicle' THEN
        v_rate := round(v_line.rate / 24.0, 2);
      END IF;
      IF v_rate IS NOT NULL THEN
        v_charges := v_charges || jsonb_build_object('type', 'late', 'amount', round(v_line.qty * v_rate * v_late_hours, 2),
          'note', v_late_hours || ' hour(s) late - ' || v_line.description);
      END IF;
    END IF;
    IF COALESCE(v_late, p_returned_at > v_r.end_at + (CASE WHEN v_line.kind = 'wearable' THEN interval '0' ELSE v_grace END)
       AND (v_line.kind <> 'wearable' OR (p_returned_at AT TIME ZONE v_tz)::date > (v_r.end_at AT TIME ZONE v_tz)::date)) THEN
      SELECT COALESCE(max(amount), 0) INTO v_rate FROM public.variation_rates WHERE variation_id = v_line.variation_id AND rate_type = 'late_penalty';
      v_penalty := GREATEST(v_penalty, v_rate);
    END IF;
  END LOOP;
  IF v_penalty > 0 THEN
    v_charges := v_charges || jsonb_build_object('type', 'late', 'amount', v_penalty, 'note', 'Late return penalty');
  END IF;

  -- km above the allowance, per vehicle
  FOR v_unit IN
    SELECT ur.unit_id, u.code, rl.variation_id, v.km_included_per_day
    FROM public.unit_reservations ur
    JOIN public.units u ON u.id = ur.unit_id
    JOIN public.rental_lines rl ON rl.id = ur.line_id
    JOIN public.product_variations v ON v.id = rl.variation_id
    WHERE ur.rental_id = p_rental_id AND rl.kind = 'vehicle'
  LOOP
    SELECT odometer INTO v_out FROM public.rental_checks WHERE rental_id = p_rental_id AND unit_id = v_unit.unit_id AND phase = 'pickup';
    SELECT (value ->> 'odometer')::integer INTO v_in FROM jsonb_array_elements(p_odometers) WHERE value ->> 'unit_id' = v_unit.unit_id::text;
    CONTINUE WHEN v_out IS NULL OR v_in IS NULL OR v_unit.km_included_per_day IS NULL;
    IF v_in < v_out THEN
      RAISE EXCEPTION 'Odometer of % at return (%) is lower than at pickup (%)', v_unit.code, v_in, v_out;
    END IF;
    v_days := GREATEST(1, ceil(extract(epoch FROM (p_returned_at - COALESCE(v_r.actual_start_at, v_r.start_at))) / 86400.0)::integer);
    v_allow := v_unit.km_included_per_day * v_days;
    v_extra := GREATEST(0, (v_in - v_out) - v_allow);
    SELECT amount INTO v_rate FROM public.variation_rates WHERE variation_id = v_unit.variation_id AND rate_type = 'extra_km';
    IF v_extra > 0 AND COALESCE(v_rate, 0) > 0 THEN
      v_charges := v_charges || jsonb_build_object('type', 'extra_km', 'amount', round(v_extra * v_rate, 2),
        'note', v_unit.code || ': ' || (v_in - v_out) || ' km driven, ' || v_allow || ' km included, ' || v_extra || ' km extra');
    END IF;
  END LOOP;

  RETURN jsonb_build_object('charges', v_charges);
END $$;

-- ------------------------------------------------------------------------------
-- a product's own late fee per piece per day (NULL = the shop's rule)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_product_late_fee(p_product_id uuid, p_amount numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_p public.products;
BEGIN
  PERFORM public._require_role(ARRAY['super_admin', 'owner', 'manager']);
  SELECT * INTO v_p FROM public.products WHERE id = p_product_id AND shop_id = public.current_shop_id() FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found';
  END IF;
  IF p_amount IS NOT NULL AND (p_amount < 0 OR p_amount > 10000000 OR p_amount <> round(p_amount, 2)) THEN
    RAISE EXCEPTION 'The late fee is 0 to 1,00,00,000 rupees, in rupees and paise';
  END IF;
  IF v_p.late_fee_per_day IS NOT DISTINCT FROM p_amount THEN
    RETURN;
  END IF;
  UPDATE public.products SET late_fee_per_day = p_amount WHERE id = p_product_id;
  PERFORM public._act_log(v_p.shop_id, NULL, 'products', 'product_changed', 1, 'product', v_p.id, v_p.name,
    format('Changed the late fee of %s', v_p.name), false,
    public._act_change('Late fee per day', COALESCE(public._act_inr(v_p.late_fee_per_day), 'Shop''s rule'),
                       COALESCE(public._act_inr(p_amount), 'Shop''s rule')));
END $$;

-- ------------------------------------------------------------------------------
-- pieces kept late and the booking next in line for each (row rules apply: each person sees their own branches)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.late_clashes()
RETURNS TABLE (unit_id uuid, unit_code text, late_rental_id uuid, late_token text, due_at timestamptz,
               next_rental_id uuid, next_token text, next_start timestamptz, next_hold_note text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_catalog AS $$
  SELECT u.id, u.code, r.id, r.token, r.end_at, n.id, n.token, n.start_at, n.handover_hold_note
  FROM public.unit_reservations ur
  JOIN public.rentals r ON r.id = ur.rental_id
  JOIN public.units u ON u.id = ur.unit_id
  JOIN LATERAL (
    SELECT r2.id, r2.token, r2.start_at, r2.handover_hold_note
    FROM public.unit_reservations ur2 JOIN public.rentals r2 ON r2.id = ur2.rental_id
    WHERE ur2.unit_id = ur.unit_id AND ur2.state = 'held' AND r2.status = 'reserved' AND r2.id <> r.id
    ORDER BY lower(ur2.period) LIMIT 1) n ON true
  WHERE ur.state = 'out' AND r.status = 'active' AND r.end_at < now() AND r.shop_id = public.current_shop_id()
  ORDER BY n.start_at;
$$;

-- ------------------------------------------------------------------------------
-- hold a booking's hand over (empty note = remove the hold)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_handover_hold(p_rental_id uuid, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_r public.rentals;
  v_note text := NULLIF(btrim(p_note), '');
  v_cust text;
BEGIN
  PERFORM public._require_role();
  SELECT * INTO v_r FROM public.rentals WHERE id = p_rental_id AND shop_id = public.current_shop_id() FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental not found';
  END IF;
  PERFORM public._require_branch(v_r.branch_id);
  IF v_r.status <> 'reserved' THEN
    RAISE EXCEPTION 'Only a booking that has not been handed over can be put on hold';
  END IF;
  IF length(v_note) > 200 THEN
    RAISE EXCEPTION 'The hold note is at most 200 characters';
  END IF;
  IF v_r.handover_hold_note IS NOT DISTINCT FROM v_note THEN
    RETURN;
  END IF;
  UPDATE public.rentals SET handover_hold_note = v_note,
         handover_hold_at = CASE WHEN v_note IS NULL THEN NULL ELSE now() END,
         handover_hold_by = CASE WHEN v_note IS NULL THEN NULL ELSE auth.uid() END
  WHERE id = p_rental_id;
  v_cust := COALESCE((SELECT full_name FROM public.customers WHERE id = v_r.customer_id), 'a customer');
  PERFORM public._act_log(v_r.shop_id, v_r.branch_id, 'bookings',
    CASE WHEN v_note IS NULL THEN 'handover_hold_removed' ELSE 'handover_held' END, 2, 'booking', v_r.id, v_r.token,
    CASE WHEN v_note IS NULL THEN format('Removed the hold on booking %s for %s', v_r.token, v_cust)
         ELSE format('Put the hand over of booking %s for %s on hold', v_r.token, v_cust) END,
    false, NULL, NULL, v_note);
END $$;

-- start_rental refuses a held booking (a wrapper around the existing function, like complete_rental in 022)
ALTER FUNCTION public.start_rental(uuid, jsonb) RENAME TO _start_rental_core;

CREATE OR REPLACE FUNCTION public.start_rental(p_rental_id uuid, p jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_hold text;
BEGIN
  PERFORM public._require_role();
  SELECT handover_hold_note INTO v_hold FROM public.rentals WHERE id = p_rental_id;
  IF v_hold IS NOT NULL THEN
    RAISE EXCEPTION 'This hand over is on hold (%). Remove the hold on the booking first', v_hold;
  END IF;
  RETURN public._start_rental_core(p_rental_id, p);
END $$;

ALTER FUNCTION public.start_rental(uuid, jsonb) OWNER TO app_rpc;
ALTER FUNCTION public._start_rental_core(uuid, jsonb) OWNER TO app_rpc;
REVOKE ALL ON FUNCTION public.start_rental(uuid, jsonb), public._start_rental_core(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_rental(uuid, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public._shop_rule(uuid, text, text), public._late_terms(uuid), public._rental_late_terms(),
  public._wearable_late_fee(jsonb, public.rental_lines, timestamptz, timestamptz, text)
  FROM PUBLIC, anon, authenticated;
-- return_suggestions and create_rental run as app_rpc; these helpers stay with postgres (they use the activity formatters)
GRANT EXECUTE ON FUNCTION public._shop_rule(uuid, text, text), public._late_terms(uuid),
  public._wearable_late_fee(jsonb, public.rental_lines, timestamptz, timestamptz, text) TO app_rpc;
-- set_product_late_fee and set_handover_hold stay with postgres so they can write the activity log (like enter_support, 036);
-- each checks the shop itself
REVOKE ALL ON FUNCTION public.set_product_late_fee(uuid, numeric), public.late_clashes(), public.set_handover_hold(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_product_late_fee(uuid, numeric), public.late_clashes(), public.set_handover_hold(uuid, text)
  TO authenticated;
NOTIFY pgrst, 'reload schema';
