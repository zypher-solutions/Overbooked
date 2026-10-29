-- Overbooked v2 — cleaning days per booking (bridal and groom shops, like TRENDZ's "Maintenance Buffer").
-- A booking may carry its own cleaning days; the unit is held that long after the return date.
-- Without it (NULL) the product's own turnaround applies, as before. Existing functions keep working:
-- the old signatures stay and call the new ones with NULL.

ALTER TABLE public.rentals ADD COLUMN cleaning_days integer CHECK (cleaning_days IS NULL OR cleaning_days BETWEEN 0 AND 365);

-- ------------------------------------------------------------------------------
-- period of a reservation incl. cleaning
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._period(p_start timestamptz, p_end timestamptz, p_variation_id uuid, p_cleaning_days integer)
RETURNS tstzrange LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT tstzrange(p_start, p_end + COALESCE(make_interval(days => p_cleaning_days), turnaround), '[)')
  FROM public.product_variations WHERE id = p_variation_id;
$$;

-- ------------------------------------------------------------------------------
-- units free for a period (cleaning days optional)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.available_units(p_branch_id uuid, p_variation_id uuid, p_start timestamptz, p_end timestamptz, p_cleaning_days integer)
RETURNS TABLE (unit_id uuid, code text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT u.id, u.code
  FROM public.units u
  JOIN public.product_variations v ON v.id = u.variation_id
  WHERE u.branch_id = p_branch_id AND u.variation_id = p_variation_id AND u.status = 'available'
    AND NOT EXISTS (
      SELECT 1 FROM public.unit_reservations ur
      WHERE ur.unit_id = u.id AND ur.state <> 'released'
        AND ur.period && tstzrange(p_start, p_end + COALESCE(make_interval(days => p_cleaning_days), v.turnaround), '[)'))
  ORDER BY u.code;
$$;
CREATE OR REPLACE FUNCTION public.available_units(p_branch_id uuid, p_variation_id uuid, p_start timestamptz, p_end timestamptz)
RETURNS TABLE (unit_id uuid, code text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT * FROM public.available_units(p_branch_id, p_variation_id, p_start, p_end, NULL::integer);
$$;

CREATE OR REPLACE FUNCTION public.find_available_units(p_branch_id uuid, p_variation_id uuid, p_start timestamptz, p_end timestamptz, p_cleaning_days integer)
RETURNS TABLE (unit_id uuid, code text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  PERFORM public._require_role();
  PERFORM public._require_branch(p_branch_id);
  RETURN QUERY SELECT * FROM public.available_units(p_branch_id, p_variation_id, p_start, p_end, p_cleaning_days);
END $$;

-- ------------------------------------------------------------------------------
-- free counts of a branch (cleaning days optional)
-- ------------------------------------------------------------------------------
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
           count(u.id) FILTER (WHERE NOT EXISTS (
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


CREATE OR REPLACE FUNCTION public.branch_availability(p_branch_id uuid, p_start timestamptz, p_end timestamptz)
RETURNS TABLE (variation_id uuid, free integer, total integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  RETURN QUERY SELECT * FROM public.branch_availability(p_branch_id, p_start, p_end, NULL::integer);
END $$;

-- ------------------------------------------------------------------------------
-- reserving units: use the booking's own cleaning days
-- ------------------------------------------------------------------------------
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


-- ------------------------------------------------------------------------------
-- create / change a booking: store the cleaning days (before the units are reserved)
-- ------------------------------------------------------------------------------
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
  IF NULLIF(btrim(p ->> 'cleaning_days'), '')::integer < 0 THEN
    RAISE EXCEPTION 'Cleaning days cannot be negative';
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
                              with_driver, whole_property, deposit_agreed, notes, created_by, cleaning_days)
  VALUES (v_shop, v_branch, v_cust.id, '', v_start, v_end,
          COALESCE((p ->> 'adults')::integer, 1), COALESCE((p ->> 'children')::integer, 0),
          COALESCE((p ->> 'with_driver')::boolean, false), COALESCE((p ->> 'whole_property')::boolean, false),
          round(COALESCE((p ->> 'deposit_agreed')::numeric, 0), 2), NULLIF(btrim(p ->> 'notes'), ''), auth.uid(), NULLIF(btrim(p ->> 'cleaning_days'), '')::integer)
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
  UPDATE public.rentals SET discount = 0,
    cleaning_days = CASE WHEN p ? 'cleaning_days' THEN NULLIF(btrim(p ->> 'cleaning_days'), '')::integer ELSE cleaning_days END
  WHERE id = p_rental_id;
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


-- ------------------------------------------------------------------------------
-- return and extend: the unit is free again after the booking cleaning days
-- ------------------------------------------------------------------------------
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
             period = tstzrange(lower(period), GREATEST(v_returned, lower(period) + interval '1 minute') + COALESCE(make_interval(days => v_r.cleaning_days), v_res.turnaround), '[)')
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
  SET period = tstzrange(lower(ur.period), p_new_end + COALESCE(make_interval(days => v_r.cleaning_days), v.turnaround), '[)')
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


-- ------------------------------------------------------------------------------
-- ownership and grants of the new signatures (same as their older twins)
-- ------------------------------------------------------------------------------
ALTER FUNCTION public._period(timestamptz, timestamptz, uuid, integer) OWNER TO app_rpc;
ALTER FUNCTION public.available_units(uuid, uuid, timestamptz, timestamptz, integer) OWNER TO app_rpc;
ALTER FUNCTION public.find_available_units(uuid, uuid, timestamptz, timestamptz, integer) OWNER TO app_rpc;
ALTER FUNCTION public.branch_availability(uuid, timestamptz, timestamptz, integer) OWNER TO app_rpc;

REVOKE EXECUTE ON FUNCTION public._period(timestamptz, timestamptz, uuid, integer),
  public.available_units(uuid, uuid, timestamptz, timestamptz, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.find_available_units(uuid, uuid, timestamptz, timestamptz, integer),
  public.branch_availability(uuid, timestamptz, timestamptz, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_available_units(uuid, uuid, timestamptz, timestamptz, integer),
  public.branch_availability(uuid, timestamptz, timestamptz, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
