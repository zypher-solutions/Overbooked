-- Overbooked v2 — the life of a rental. The only way rentals and their money change.
--   create_rental        reserve units, price it, take advance and deposit         -> reserved
--   start_rental         pickup / check-in: checks, licence, payment              -> active
--   return_suggestions   late and extra-km charges the system calculates (staff confirm)
--   complete_rental      return / check-out: checks, charges, deposit, payment    -> completed
--   add_rental_charge    a charge later on (challan, toll, damage found later)
--   record_rental_payment  money in or out at any time
--   extend_rental        a later end, re-priced; units checked for clashes
--   cancel_rental        before pickup (or no-show): fee kept from the advance, the rest refunded
-- Double booking is refused by the unit_reservations exclusion constraint whatever the path.

CREATE OR REPLACE FUNCTION public._period(p_start timestamptz, p_end timestamptz, p_variation_id uuid)
RETURNS tstzrange LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT tstzrange(p_start, p_end + turnaround, '[)') FROM public.product_variations WHERE id = p_variation_id;
$$;

CREATE OR REPLACE FUNCTION public._shop_tz()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT timezone FROM public.shops WHERE id = public.current_shop_id();
$$;

CREATE OR REPLACE FUNCTION public._money(p jsonb, p_key text)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT round(COALESCE((p -> p_key ->> 'amount')::numeric, 0), 2);
$$;

CREATE OR REPLACE FUNCTION public._insert_payment(p_rental_id uuid, p_kind text, p_amount numeric, p_method text, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  IF p_amount IS NULL OR p_amount = 0 THEN
    RETURN;
  END IF;
  IF p_amount < 0 THEN
    RAISE EXCEPTION 'Amounts cannot be negative';
  END IF;
  IF p_amount <> round(p_amount, 2) THEN
    RAISE EXCEPTION 'Amounts are in rupees and paise (2 decimals)';
  END IF;
  IF p_kind <> 'deposit_applied' AND (p_method IS NULL OR p_method NOT IN ('cash', 'upi', 'card', 'bank_transfer')) THEN
    RAISE EXCEPTION 'Choose how the money was paid (cash, UPI, card or bank transfer)';
  END IF;
  INSERT INTO public.payments (shop_id, rental_id, kind, amount, method, note, recorded_by)
  VALUES (public.current_shop_id(), p_rental_id, p_kind, p_amount,
          CASE WHEN p_kind = 'deposit_applied' THEN NULL ELSE p_method END, p_note, auth.uid());
EXCEPTION WHEN check_violation THEN
  IF SQLERRM LIKE '%rentals_paid_within_total%' THEN
    RAISE EXCEPTION 'That is more than the balance due';
  ELSIF SQLERRM LIKE '%rentals_deposit_balance%' THEN
    RAISE EXCEPTION 'That is more than the deposit held';
  END IF;
  RAISE;
END $$;

-- ==============================================================================
-- create_rental
-- p = quote input + {customer: {id} | {full_name, phone, email, address, id_type, id_number,
--     licence_number, licence_expiry}, discount, deposit_agreed, notes,
--     advance: {amount, method}, deposit: {amount, method}}
-- each line may carry unit_ids (chosen units); otherwise free units are picked
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.create_rental(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid;
  v_tz text;
  v_branch uuid := (p ->> 'branch_id')::uuid;
  v_start timestamptz := (p ->> 'start_at')::timestamptz;
  v_end timestamptz := (p ->> 'end_at')::timestamptz;
  v_quote jsonb;
  v_customer uuid;
  v_cust RECORD;
  v_rental uuid;
  v_token text;
  v_line jsonb;
  v_line_id uuid;
  v_need RECORD;
  v_unit uuid;
  v_chosen uuid[];
  v_found integer;
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
    v_customer := v_cust.id;
  ELSE
    INSERT INTO public.customers (shop_id, full_name, phone, email, address, id_type, id_number, licence_number, licence_expiry)
    VALUES (v_shop, btrim(p -> 'customer' ->> 'full_name'), regexp_replace(COALESCE(p -> 'customer' ->> 'phone', ''), '[\s-]', '', 'g'),
            NULLIF(btrim(p -> 'customer' ->> 'email'), ''), NULLIF(btrim(p -> 'customer' ->> 'address'), ''),
            NULLIF(p -> 'customer' ->> 'id_type', ''), NULLIF(btrim(p -> 'customer' ->> 'id_number'), ''),
            NULLIF(btrim(p -> 'customer' ->> 'licence_number'), ''), NULLIF(p -> 'customer' ->> 'licence_expiry', '')::date)
    RETURNING * INTO v_cust;
    v_customer := v_cust.id;
  END IF;
  IF v_cust.is_blocked THEN
    RAISE EXCEPTION 'This customer is blocked: %', COALESCE(v_cust.blocked_reason, 'no reason given');
  END IF;

  INSERT INTO public.rentals (shop_id, branch_id, customer_id, token, start_at, end_at, adults, children,
                              with_driver, whole_property, deposit_agreed, notes, created_by)
  VALUES (v_shop, v_branch, v_customer, '', v_start, v_end,
          COALESCE((p ->> 'adults')::integer, 1), COALESCE((p ->> 'children')::integer, 0),
          COALESCE((p ->> 'with_driver')::boolean, false), COALESCE((p ->> 'whole_property')::boolean, false),
          round(COALESCE((p ->> 'deposit_agreed')::numeric, 0), 2), NULLIF(btrim(p ->> 'notes'), ''), auth.uid())
  RETURNING id, token INTO v_rental, v_token;

  FOR v_line IN SELECT value FROM jsonb_array_elements(v_quote -> 'lines') LOOP
    INSERT INTO public.rental_lines (shop_id, rental_id, product_id, variation_id, kind, description, sku, image_url,
                                     qty, rate_type, rate, time_units, amount, is_override)
    VALUES (v_shop, v_rental, (v_line ->> 'product_id')::uuid, (v_line ->> 'variation_id')::uuid, v_line ->> 'kind',
            v_line ->> 'description', v_line ->> 'sku', v_line ->> 'image_url', (v_line ->> 'qty')::integer,
            v_line ->> 'rate_type', (v_line ->> 'rate')::numeric, (v_line ->> 'time_units')::numeric,
            (v_line ->> 'amount')::numeric, (v_line ->> 'is_override')::boolean)
    RETURNING id INTO v_line_id;

    IF NOT (v_line ->> 'reserve')::boolean THEN
      CONTINUE;
    END IF;

    -- what to reserve: the variation itself, or the pieces of a set
    FOR v_need IN
      SELECT si.variation_id, si.qty * (v_line ->> 'qty')::integer AS qty
      FROM public.set_items si JOIN public.products pr ON pr.id = si.set_product_id
      WHERE si.set_product_id = (v_line ->> 'product_id')::uuid AND pr.is_set
      UNION ALL
      SELECT (v_line ->> 'variation_id')::uuid, (v_line ->> 'qty')::integer
      WHERE NOT EXISTS (SELECT 1 FROM public.products WHERE id = (v_line ->> 'product_id')::uuid AND is_set)
    LOOP
      v_chosen := ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(v_line -> 'unit_ids') = 'array'
                                                              THEN v_line -> 'unit_ids' ELSE '[]' END)::uuid);
      IF cardinality(v_chosen) > 0 THEN
        IF cardinality(v_chosen) <> v_need.qty OR (SELECT count(DISTINCT x) FROM unnest(v_chosen) x) <> v_need.qty THEN
          RAISE EXCEPTION 'Choose exactly % different unit(s) for %', v_need.qty, v_line ->> 'description';
        END IF;
        SELECT count(*) INTO v_found FROM public.units
        WHERE id = ANY (v_chosen) AND variation_id = v_need.variation_id AND branch_id = v_branch AND status = 'available';
        IF v_found <> v_need.qty THEN
          RAISE EXCEPTION 'A chosen unit for % is not available in this branch', v_line ->> 'description';
        END IF;
      ELSE
        v_chosen := ARRAY(SELECT a.unit_id FROM public.available_units(v_branch, v_need.variation_id, v_start, v_end) a
                          LIMIT v_need.qty);
        IF cardinality(v_chosen) < v_need.qty THEN
          RAISE EXCEPTION 'Only % of % available for % on these dates', cardinality(v_chosen), v_need.qty, v_line ->> 'description';
        END IF;
      END IF;

      FOREACH v_unit IN ARRAY v_chosen LOOP
        INSERT INTO public.unit_reservations (shop_id, rental_id, line_id, unit_id, period)
        VALUES (v_shop, v_rental, v_line_id, v_unit, public._period(v_start, v_end, v_need.variation_id));
      END LOOP;
    END LOOP;
  END LOOP;

  INSERT INTO public.rental_add_ons (shop_id, rental_id, add_on_id, name, basis, quantity, unit_amount, amount)
  SELECT v_shop, v_rental, (a ->> 'add_on_id')::uuid, a ->> 'name', a ->> 'basis',
         (a ->> 'quantity')::numeric, (a ->> 'unit_amount')::numeric, (a ->> 'amount')::numeric
  FROM jsonb_array_elements(v_quote -> 'add_ons') a;

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
-- start_rental: pickup / check-in
-- p = {id_verified, checks: [{unit_id, condition, odometer, fuel_level, notes, photo_paths}],
--      payment: {amount, method}, deposit: {amount, method}}
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.start_rental(p_rental_id uuid, p jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_r RECORD;
  v_res RECORD;
  v_check jsonb;
  v_has_vehicle boolean;
  v_need_licence boolean;
  v_cust RECORD;
  v_tz text := public._shop_tz();
  v_now timestamptz := now();
BEGIN
  PERFORM public._require_role();
  SELECT * INTO v_r FROM public.rentals WHERE id = p_rental_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental not found';
  END IF;
  PERFORM public._require_branch(v_r.branch_id);
  IF v_r.status <> 'reserved' THEN
    RAISE EXCEPTION 'Only a reserved rental can be picked up (this one is %)', v_r.status;
  END IF;

  v_has_vehicle := EXISTS (SELECT 1 FROM public.rental_lines WHERE rental_id = p_rental_id AND kind = 'vehicle');
  IF v_has_vehicle THEN
    SELECT COALESCE((settings ->> 'require_licence')::boolean, true) INTO v_need_licence FROM public.shops WHERE id = v_r.shop_id;
    SELECT * INTO v_cust FROM public.customers WHERE id = v_r.customer_id;
    IF v_need_licence AND (v_cust.licence_number IS NULL
         OR (v_cust.licence_expiry IS NOT NULL AND v_cust.licence_expiry < (v_now AT TIME ZONE v_tz)::date)) THEN
      RAISE EXCEPTION 'A valid driving licence must be on the customer record before handing over a vehicle';
    END IF;
    IF v_need_licence AND NOT COALESCE((p ->> 'id_verified')::boolean, false) THEN
      RAISE EXCEPTION 'Confirm that the licence and ID were checked before handing over a vehicle';
    END IF;
  END IF;

  FOR v_res IN
    SELECT ur.*, u.status AS unit_status, u.code, rl.kind
    FROM public.unit_reservations ur
    JOIN public.units u ON u.id = ur.unit_id
    JOIN public.rental_lines rl ON rl.id = ur.line_id
    WHERE ur.rental_id = p_rental_id AND ur.state = 'held'
  LOOP
    IF v_res.unit_status <> 'available' THEN
      RAISE EXCEPTION 'Unit % is % and cannot be handed over. Swap it first.', v_res.code, v_res.unit_status;
    END IF;
    SELECT value INTO v_check FROM jsonb_array_elements(COALESCE(p -> 'checks', '[]'))
    WHERE value ->> 'unit_id' = v_res.unit_id::text;
    IF v_res.kind = 'vehicle' AND (v_check IS NULL OR v_check ->> 'odometer' IS NULL OR v_check ->> 'fuel_level' IS NULL) THEN
      RAISE EXCEPTION 'Record the odometer and fuel level of % at pickup', v_res.code;
    END IF;
    IF v_check IS NOT NULL THEN
      INSERT INTO public.rental_checks (shop_id, rental_id, unit_id, phase, condition, odometer, fuel_level, notes, photo_paths, checked_by)
      VALUES (v_r.shop_id, p_rental_id, v_res.unit_id, 'pickup', v_check ->> 'condition', (v_check ->> 'odometer')::integer,
              (v_check ->> 'fuel_level')::smallint, v_check ->> 'notes',
              COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_check -> 'photo_paths')), '{}'), auth.uid());
      IF v_check ->> 'odometer' IS NOT NULL THEN
        UPDATE public.units SET odometer = (v_check ->> 'odometer')::integer WHERE id = v_res.unit_id;
      END IF;
    END IF;
    -- picked up early: the unit is held from now
    UPDATE public.unit_reservations
    SET state = 'out', period = tstzrange(LEAST(lower(period), v_now), upper(period), '[)')
    WHERE id = v_res.id;
    v_check := NULL;
  END LOOP;

  UPDATE public.rentals SET status = 'active', actual_start_at = v_now,
         id_verified_at = CASE WHEN COALESCE((p ->> 'id_verified')::boolean, false) THEN v_now END,
         id_verified_by = CASE WHEN COALESCE((p ->> 'id_verified')::boolean, false) THEN auth.uid() END
  WHERE id = p_rental_id;

  PERFORM public._insert_payment(p_rental_id, 'payment', public._money(p, 'payment'), p -> 'payment' ->> 'method', 'At pickup');
  PERFORM public._insert_payment(p_rental_id, 'deposit', public._money(p, 'deposit'), p -> 'deposit' ->> 'method', 'Security deposit');

  RETURN (SELECT jsonb_build_object('status', status, 'total', total, 'paid', paid, 'balance', total - paid,
                                    'deposit_held', deposit_received - deposit_refunded - deposit_applied)
          FROM public.rentals WHERE id = p_rental_id);
EXCEPTION WHEN exclusion_violation THEN
  RAISE EXCEPTION 'A unit cannot be picked up early: it is still booked by someone else until the planned start';
END $$;

-- ==============================================================================
-- return_suggestions: what the system calculates at return (staff confirm or change it)
-- p_odometers = [{unit_id, odometer}]
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.return_suggestions(p_rental_id uuid, p_returned_at timestamptz DEFAULT now(), p_odometers jsonb DEFAULT '[]')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_r RECORD;
  v_tz text := public._shop_tz();
  v_grace interval;
  v_charges jsonb := '[]';
  v_line RECORD;
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
    IF v_line.kind = 'wearable' THEN
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
    IF p_returned_at > v_r.end_at + (CASE WHEN v_line.kind = 'wearable' THEN interval '0' ELSE v_grace END)
       AND (v_line.kind <> 'wearable' OR (p_returned_at AT TIME ZONE v_tz)::date > (v_r.end_at AT TIME ZONE v_tz)::date) THEN
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

-- ==============================================================================
-- complete_rental: return / check-out
-- p = {returned_at, checks: [{unit_id, condition, odometer, fuel_level, notes, photo_paths}],
--      charges: [{type, amount, note}], deposit_applied, deposit_refund: {amount, method}, payment: {amount, method}}
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.complete_rental(p_rental_id uuid, p jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_r RECORD;
  v_res RECORD;
  v_check jsonb;
  v_charge jsonb;
  v_returned timestamptz := COALESCE((p ->> 'returned_at')::timestamptz, now());
  v_out integer;
  v_warnings jsonb := '[]';
  v_condition text;
BEGIN
  PERFORM public._require_role();
  SELECT * INTO v_r FROM public.rentals WHERE id = p_rental_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental not found';
  END IF;
  PERFORM public._require_branch(v_r.branch_id);
  IF v_r.status <> 'active' THEN
    RAISE EXCEPTION 'Only a rental that is out can be returned (this one is %)', v_r.status;
  END IF;
  IF v_returned < v_r.actual_start_at THEN
    RAISE EXCEPTION 'The return cannot be before the pickup';
  END IF;
  IF v_returned > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'The return time cannot be in the future';
  END IF;

  FOR v_res IN
    SELECT ur.*, u.code, rl.kind, v.turnaround
    FROM public.unit_reservations ur
    JOIN public.units u ON u.id = ur.unit_id
    JOIN public.rental_lines rl ON rl.id = ur.line_id
    JOIN public.product_variations v ON v.id = u.variation_id
    WHERE ur.rental_id = p_rental_id AND ur.state = 'out'
  LOOP
    SELECT value INTO v_check FROM jsonb_array_elements(COALESCE(p -> 'checks', '[]'))
    WHERE value ->> 'unit_id' = v_res.unit_id::text;
    IF v_check IS NULL OR v_check ->> 'condition' IS NULL THEN
      RAISE EXCEPTION 'Record the condition of % at return', v_res.code;
    END IF;
    v_condition := v_check ->> 'condition';
    IF v_res.kind = 'vehicle' THEN
      IF v_check ->> 'odometer' IS NULL OR v_check ->> 'fuel_level' IS NULL THEN
        RAISE EXCEPTION 'Record the odometer and fuel level of % at return', v_res.code;
      END IF;
      SELECT odometer INTO v_out FROM public.rental_checks WHERE rental_id = p_rental_id AND unit_id = v_res.unit_id AND phase = 'pickup';
      IF v_out IS NOT NULL AND (v_check ->> 'odometer')::integer < v_out THEN
        RAISE EXCEPTION 'Odometer of % at return is lower than at pickup', v_res.code;
      END IF;
    END IF;

    INSERT INTO public.rental_checks (shop_id, rental_id, unit_id, phase, condition, odometer, fuel_level, notes, photo_paths, checked_by)
    VALUES (v_r.shop_id, p_rental_id, v_res.unit_id, 'return', v_condition, (v_check ->> 'odometer')::integer,
            (v_check ->> 'fuel_level')::smallint, v_check ->> 'notes',
            COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_check -> 'photo_paths')), '{}'), auth.uid());

    UPDATE public.units SET
      status = CASE v_condition WHEN 'lost' THEN 'lost' WHEN 'damaged' THEN 'maintenance' ELSE status END,
      status_reason = CASE v_condition WHEN 'lost' THEN 'Lost on ' || v_r.token WHEN 'damaged' THEN 'Damaged on ' || v_r.token ELSE status_reason END,
      odometer = COALESCE((v_check ->> 'odometer')::integer, odometer)
    WHERE id = v_res.unit_id;

    -- the unit is free again after the actual return + turnaround
    BEGIN
      UPDATE public.unit_reservations SET state = 'returned',
             period = tstzrange(lower(period), GREATEST(v_returned, lower(period) + interval '1 minute') + v_res.turnaround, '[)')
      WHERE id = v_res.id;
    EXCEPTION WHEN exclusion_violation THEN
      -- late return runs into the next booking: keep the record, flag the clash for staff
      UPDATE public.unit_reservations SET state = 'returned' WHERE id = v_res.id;
      v_warnings := v_warnings || to_jsonb('Unit ' || v_res.code || ' came back late and overlaps its next booking');
    END;
    v_check := NULL;
  END LOOP;

  FOR v_charge IN SELECT value FROM jsonb_array_elements(COALESCE(p -> 'charges', '[]')) LOOP
    IF round(COALESCE((v_charge ->> 'amount')::numeric, 0), 2) > 0 THEN
      INSERT INTO public.rental_charges (shop_id, rental_id, type, amount, note, created_by)
      VALUES (v_r.shop_id, p_rental_id, v_charge ->> 'type', round((v_charge ->> 'amount')::numeric, 2),
              NULLIF(btrim(v_charge ->> 'note'), ''), auth.uid());
    END IF;
  END LOOP;

  UPDATE public.rentals SET status = 'completed', actual_end_at = v_returned WHERE id = p_rental_id;

  PERFORM public._insert_payment(p_rental_id, 'deposit_applied', round(COALESCE((p ->> 'deposit_applied')::numeric, 0), 2), NULL, 'Deposit kept towards charges');
  PERFORM public._insert_payment(p_rental_id, 'payment', public._money(p, 'payment'), p -> 'payment' ->> 'method', 'At return');
  PERFORM public._insert_payment(p_rental_id, 'deposit_refund', public._money(p, 'deposit_refund'), p -> 'deposit_refund' ->> 'method', 'Deposit returned');

  RETURN (SELECT jsonb_build_object('status', status, 'total', total, 'paid', paid, 'balance', total - paid,
                                    'deposit_held', deposit_received - deposit_refunded - deposit_applied,
                                    'warnings', v_warnings)
          FROM public.rentals WHERE id = p_rental_id);
END $$;

-- ==============================================================================
-- add_rental_charge: a charge later on (challan, toll, damage found after return)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.add_rental_charge(p_rental_id uuid, p_type text, p_amount numeric, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_r RECORD;
BEGIN
  PERFORM public._require_role(ARRAY['super_admin', 'owner', 'manager']);
  SELECT * INTO v_r FROM public.rentals WHERE id = p_rental_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental not found';
  END IF;
  PERFORM public._require_branch(v_r.branch_id);
  IF v_r.status IN ('cancelled', 'no_show') THEN
    RAISE EXCEPTION 'A cancelled rental cannot take charges';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount <> round(p_amount, 2) THEN
    RAISE EXCEPTION 'Enter a charge above zero, in rupees and paise';
  END IF;
  INSERT INTO public.rental_charges (shop_id, rental_id, type, amount, note, created_by)
  VALUES (v_r.shop_id, p_rental_id, p_type, p_amount, NULLIF(btrim(p_note), ''), auth.uid());
  RETURN (SELECT jsonb_build_object('total', total, 'paid', paid, 'balance', total - paid) FROM public.rentals WHERE id = p_rental_id);
END $$;

-- ==============================================================================
-- record_rental_payment: payment, deposit, deposit_refund or deposit_applied at any time
-- ==============================================================================
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
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Enter an amount above zero';
  END IF;
  PERFORM public._insert_payment(p_rental_id, p_kind, p_amount, p_method, p_note);
  RETURN (SELECT jsonb_build_object('total', total, 'paid', paid, 'balance', total - paid,
                                    'deposit_held', deposit_received - deposit_refunded - deposit_applied)
          FROM public.rentals WHERE id = p_rental_id);
END $$;

-- ==============================================================================
-- extend_rental: move the end later; lines priced by rate are re-priced, negotiated ones keep their amount
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.extend_rental(p_rental_id uuid, p_new_end timestamptz, p_payment jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_r RECORD;
  v_line RECORD;
  v_price RECORD;
  v_tz text := public._shop_tz();
  v_hours integer;
  v_ao RECORD;
  v_qty numeric;
BEGIN
  PERFORM public._require_role();
  SELECT * INTO v_r FROM public.rentals WHERE id = p_rental_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental not found';
  END IF;
  PERFORM public._require_branch(v_r.branch_id);
  IF v_r.status NOT IN ('reserved', 'active') THEN
    RAISE EXCEPTION 'Only a reserved or active rental can be extended';
  END IF;
  IF p_new_end <= v_r.end_at THEN
    RAISE EXCEPTION 'The new end must be later than the current end';
  END IF;

  v_hours := public.rental_hours(v_r.start_at, p_new_end);
  FOR v_line IN SELECT * FROM public.rental_lines WHERE rental_id = p_rental_id AND NOT is_override LOOP
    IF v_line.rate_type IN ('day', 'hour', 'hour_day', 'night') THEN
      SELECT * INTO v_price FROM public.price_line(v_line.variation_id, v_line.qty, v_r.start_at, p_new_end, v_tz);
      UPDATE public.rental_lines SET time_units = v_price.time_units, amount = v_price.amount WHERE id = v_line.id;
    ELSIF v_line.rate_type IN ('driver_day', 'extra_person') THEN
      UPDATE public.rental_lines SET
        time_units = CASE v_line.rate_type WHEN 'driver_day' THEN ceil(v_hours / 24.0) ELSE public.rental_days(v_r.start_at, p_new_end, v_tz) END,
        amount = round(qty * rate * CASE v_line.rate_type WHEN 'driver_day' THEN ceil(v_hours / 24.0) ELSE public.rental_days(v_r.start_at, p_new_end, v_tz) END, 2)
      WHERE id = v_line.id;
    END IF;
  END LOOP;

  -- time-based add-ons follow the new length
  FOR v_ao IN SELECT * FROM public.rental_add_ons WHERE rental_id = p_rental_id AND basis <> 'per_rental' LOOP
    v_qty := v_ao.quantity / GREATEST(1, CASE WHEN EXISTS (SELECT 1 FROM public.rental_lines WHERE rental_id = p_rental_id AND kind = 'room')
                                             THEN public.rental_days(v_r.start_at, v_r.end_at, v_tz)
                                             ELSE ceil(public.rental_hours(v_r.start_at, v_r.end_at) / 24.0) END)
             * CASE WHEN EXISTS (SELECT 1 FROM public.rental_lines WHERE rental_id = p_rental_id AND kind = 'room')
                    THEN public.rental_days(v_r.start_at, p_new_end, v_tz) ELSE ceil(v_hours / 24.0) END;
    UPDATE public.rental_add_ons SET quantity = v_qty, amount = round(v_qty * unit_amount, 2) WHERE id = v_ao.id;
  END LOOP;

  UPDATE public.unit_reservations ur
  SET period = tstzrange(lower(ur.period), p_new_end + v.turnaround, '[)')
  FROM public.units u JOIN public.product_variations v ON v.id = u.variation_id
  WHERE ur.rental_id = p_rental_id AND ur.state IN ('held', 'out') AND u.id = ur.unit_id;

  UPDATE public.rentals SET end_at = p_new_end WHERE id = p_rental_id;

  IF p_payment IS NOT NULL THEN
    PERFORM public._insert_payment(p_rental_id, 'payment', round(COALESCE((p_payment ->> 'amount')::numeric, 0), 2), p_payment ->> 'method', 'Extension');
  END IF;

  RETURN (SELECT jsonb_build_object('end_at', end_at, 'total', total, 'paid', paid, 'balance', total - paid)
          FROM public.rentals WHERE id = p_rental_id);
EXCEPTION WHEN exclusion_violation THEN
  RAISE EXCEPTION 'Cannot extend: a unit is booked by someone else in the extra time';
END $$;

-- ==============================================================================
-- cancel_rental: before pickup, or a no-show. Fee kept from the money paid; the rest and the deposit refunded.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.cancel_rental(p_rental_id uuid, p_fee numeric DEFAULT 0, p_refund_method text DEFAULT NULL,
                                                p_reason text DEFAULT NULL, p_no_show boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_r RECORD;
  v_fee numeric := round(COALESCE(p_fee, 0), 2);
  v_refund numeric;
  v_deposit numeric;
BEGIN
  PERFORM public._require_role();
  SELECT * INTO v_r FROM public.rentals WHERE id = p_rental_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental not found';
  END IF;
  PERFORM public._require_branch(v_r.branch_id);
  IF v_r.status <> 'reserved' THEN
    RAISE EXCEPTION 'Only a rental that has not been picked up can be cancelled (this one is %)', v_r.status;
  END IF;
  IF p_no_show AND now() < v_r.start_at THEN
    RAISE EXCEPTION 'A no-show can only be marked after the planned start';
  END IF;
  IF v_fee < 0 THEN
    RAISE EXCEPTION 'The cancellation fee cannot be negative';
  END IF;
  IF v_fee > v_r.paid THEN
    RAISE EXCEPTION 'The cancellation fee (%) cannot be more than what was paid (%)', v_fee, v_r.paid;
  END IF;

  v_refund := v_r.paid - v_fee;
  v_deposit := v_r.deposit_received - v_r.deposit_refunded - v_r.deposit_applied;
  IF (v_refund > 0 OR v_deposit > 0) AND p_refund_method IS NULL THEN
    RAISE EXCEPTION 'Choose how the refund is paid';
  END IF;

  -- refund first, so paid never exceeds the new total (the fee)
  IF v_refund > 0 THEN
    INSERT INTO public.payments (shop_id, rental_id, kind, amount, method, note, recorded_by)
    VALUES (v_r.shop_id, p_rental_id, 'refund', v_refund, p_refund_method, 'Cancellation refund', auth.uid());
  END IF;
  PERFORM public._insert_payment(p_rental_id, 'deposit_refund', v_deposit, p_refund_method, 'Deposit returned on cancellation');

  UPDATE public.unit_reservations SET state = 'released' WHERE rental_id = p_rental_id;
  UPDATE public.rentals SET status = CASE WHEN p_no_show THEN 'no_show' ELSE 'cancelled' END,
         cancellation_fee = v_fee, cancelled_at = now(), cancelled_by = auth.uid(),
         cancel_reason = NULLIF(btrim(p_reason), '')
  WHERE id = p_rental_id;

  RETURN jsonb_build_object('status', CASE WHEN p_no_show THEN 'no_show' ELSE 'cancelled' END,
                            'fee', v_fee, 'refunded', v_refund, 'deposit_refunded', v_deposit);
END $$;

-- notes are the only thing changed freely
CREATE OR REPLACE FUNCTION public.update_rental_notes(p_rental_id uuid, p_notes text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_branch uuid;
BEGIN
  PERFORM public._require_role();
  SELECT branch_id INTO v_branch FROM public.rentals WHERE id = p_rental_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental not found';
  END IF;
  PERFORM public._require_branch(v_branch);
  UPDATE public.rentals SET notes = NULLIF(btrim(p_notes), '') WHERE id = p_rental_id;
END $$;
