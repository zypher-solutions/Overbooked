-- Overbooked v2 — pricing and availability.
--
-- How time is counted (shop's own time zone):
--   wearable  days   = return date - pickup date, at least 1           × day rate
--   room      nights = check-out date - check-in date, at least 1      × night rate
--   vehicle   hours  = started hours, at least 1
--             day + hour rates: full days × day rate + leftover hours × hour rate (leftover capped at a day)
--             day rate only: started days × day rate;  hour rate only: hours × hour rate
-- Extras: guests above the rooms' base occupancy × extra_person × nights; driver_day × days;
-- add-ons by their basis. Every amount can be negotiated per rental (amount_override).

-- ==============================================================================
-- Caller checks used by every workflow function
-- ==============================================================================
CREATE OR REPLACE FUNCTION public._require_role(p_allowed text[] DEFAULT ARRAY['super_admin', 'owner', 'manager', 'staff'])
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_role text := public.get_my_role();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;
  IF v_role IS NULL OR public.current_shop_id() IS NULL THEN
    RAISE EXCEPTION 'Your account is not active in a shop';
  END IF;
  IF NOT v_role = ANY (p_allowed) THEN
    RAISE EXCEPTION 'Your role (%) cannot do this', v_role;
  END IF;
  RETURN v_role;
END $$;

-- managers and staff work only in their own branch
CREATE OR REPLACE FUNCTION public._require_branch(p_branch_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  IF public.get_my_role() IN ('manager', 'staff') AND p_branch_id IS DISTINCT FROM public.get_my_branch() THEN
    RAISE EXCEPTION 'You can only work with your own branch';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.rental_days(p_start timestamptz, p_end timestamptz, p_tz text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT GREATEST(1, ((p_end AT TIME ZONE p_tz)::date - (p_start AT TIME ZONE p_tz)::date));
$$;

CREATE OR REPLACE FUNCTION public.rental_hours(p_start timestamptz, p_end timestamptz)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT GREATEST(1, ceil(extract(epoch FROM (p_end - p_start)) / 3600.0)::integer);
$$;

-- ==============================================================================
-- Price of one catalog line for a period
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.price_line(
  p_variation_id uuid, p_qty integer, p_start timestamptz, p_end timestamptz, p_tz text,
  OUT kind text, OUT rate_type text, OUT rate numeric, OUT time_units numeric, OUT amount numeric
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_day numeric;
  v_hour numeric;
  v_night numeric;
  v_hours integer;
  v_full_days integer;
  v_left integer;
BEGIN
  SELECT t.kind INTO kind
  FROM public.product_variations v
  JOIN public.products p ON p.id = v.product_id
  JOIN public.categories c ON c.id = p.category_id
  JOIN public.business_templates t ON t.key = c.template_key
  WHERE v.id = p_variation_id;
  IF kind IS NULL THEN
    RAISE EXCEPTION 'Item not found';
  END IF;

  SELECT max(r.amount) FILTER (WHERE r.rate_type = 'day'),
         max(r.amount) FILTER (WHERE r.rate_type = 'hour'),
         max(r.amount) FILTER (WHERE r.rate_type = 'night')
    INTO v_day, v_hour, v_night
  FROM public.variation_rates r WHERE r.variation_id = p_variation_id;

  IF kind = 'wearable' THEN
    IF v_day IS NULL THEN RAISE EXCEPTION 'This item has no day rate'; END IF;
    rate_type := 'day'; rate := v_day;
    time_units := public.rental_days(p_start, p_end, p_tz);
    amount := round(p_qty * v_day * time_units, 2);
  ELSIF kind = 'room' THEN
    IF v_night IS NULL THEN RAISE EXCEPTION 'This room type has no night rate'; END IF;
    rate_type := 'night'; rate := v_night;
    time_units := public.rental_days(p_start, p_end, p_tz);
    amount := round(p_qty * v_night * time_units, 2);
  ELSE  -- vehicle
    v_hours := public.rental_hours(p_start, p_end);
    IF v_day IS NOT NULL AND v_hour IS NOT NULL THEN
      v_full_days := v_hours / 24;
      v_left := v_hours - v_full_days * 24;
      rate_type := 'hour_day'; rate := v_day; time_units := v_hours;
      amount := round(p_qty * (v_full_days * v_day + LEAST(v_left * v_hour, v_day)), 2);
    ELSIF v_day IS NOT NULL THEN
      rate_type := 'day'; rate := v_day; time_units := ceil(v_hours / 24.0);
      amount := round(p_qty * v_day * time_units, 2);
    ELSIF v_hour IS NOT NULL THEN
      rate_type := 'hour'; rate := v_hour; time_units := v_hours;
      amount := round(p_qty * v_hour * v_hours, 2);
    ELSE
      RAISE EXCEPTION 'This vehicle has no hour or day rate';
    END IF;
  END IF;
END $$;

-- ==============================================================================
-- Units free for a period (status available, not held by any live reservation, incl. turnaround)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.available_units(p_branch_id uuid, p_variation_id uuid, p_start timestamptz, p_end timestamptz)
RETURNS TABLE (unit_id uuid, code text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT u.id, u.code
  FROM public.units u
  JOIN public.product_variations v ON v.id = u.variation_id
  WHERE u.branch_id = p_branch_id AND u.variation_id = p_variation_id AND u.status = 'available'
    AND NOT EXISTS (
      SELECT 1 FROM public.unit_reservations ur
      WHERE ur.unit_id = u.id AND ur.state <> 'released'
        AND ur.period && tstzrange(p_start, p_end + v.turnaround, '[)'))
  ORDER BY u.code;
$$;

-- ==============================================================================
-- Quote: every line, extra and add-on of a rental, as the booking form shows it live.
-- p = {branch_id, start_at, end_at, adults, children, with_driver, whole_property,
--      lines: [{variation_id, qty, amount_override?}], add_ons: [{add_on_id, quantity?}]}
-- ==============================================================================
CREATE OR REPLACE FUNCTION public._quote(p jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid := public.current_shop_id();
  v_tz text;
  v_branch uuid := (p ->> 'branch_id')::uuid;
  v_start timestamptz := (p ->> 'start_at')::timestamptz;
  v_end timestamptz := (p ->> 'end_at')::timestamptz;
  v_adults integer := COALESCE((p ->> 'adults')::integer, 1);
  v_children integer := COALESCE((p ->> 'children')::integer, 0);
  v_driver boolean := COALESCE((p ->> 'with_driver')::boolean, false);
  v_input jsonb := COALESCE(p -> 'lines', '[]');
  v_lines jsonb := '[]';
  v_add_ons jsonb := '[]';
  v_line jsonb;
  v_var RECORD;
  v_price RECORD;
  v_qty integer;
  v_amount numeric;
  v_items numeric := 0;
  v_add_total numeric := 0;
  v_days integer;
  v_nights integer;
  v_hours integer;
  v_room_base integer := 0;
  v_room_max integer := 0;
  v_first_room uuid;
  v_extra integer;
  v_rate numeric;
  v_ao RECORD;
  v_ao_qty numeric;
  v_units_total integer := 0;
  v_has_room boolean := false;
BEGIN
  SELECT timezone INTO v_tz FROM public.shops WHERE id = v_shop;
  IF v_start IS NULL OR v_end IS NULL OR v_end <= v_start THEN
    RAISE EXCEPTION 'The end must be after the start';
  END IF;
  IF v_adults < 0 OR v_children < 0 THEN
    RAISE EXCEPTION 'Guest numbers cannot be negative';
  END IF;
  v_days := public.rental_days(v_start, v_end, v_tz);
  v_nights := v_days;
  v_hours := public.rental_hours(v_start, v_end);

  -- whole property: every room type of the branch, with all its rooms
  IF COALESCE((p ->> 'whole_property')::boolean, false) THEN
    IF NOT public.shop_feature(v_shop, 'whole_property') THEN
      RAISE EXCEPTION 'Whole-property booking is not switched on for this shop';
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('variation_id', x.variation_id, 'qty', x.n)), '[]') INTO v_input
    FROM (SELECT u.variation_id, count(*)::integer AS n
          FROM public.units u
          JOIN public.products pr ON pr.id = u.product_id
          JOIN public.categories c ON c.id = pr.category_id
          JOIN public.business_templates t ON t.key = c.template_key
          WHERE u.branch_id = v_branch AND t.kind = 'room' AND u.status = 'available'
          GROUP BY u.variation_id) x;
    IF jsonb_array_length(v_input) = 0 THEN
      RAISE EXCEPTION 'This branch has no rooms';
    END IF;
  END IF;

  IF jsonb_array_length(v_input) = 0 THEN
    RAISE EXCEPTION 'Add at least one item';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(v_input) LOOP
    v_qty := COALESCE((v_line ->> 'qty')::integer, 1);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Quantity must be at least 1';
    END IF;

    SELECT v.id, v.name, v.sku, v.product_id, v.base_occupancy, v.max_occupancy, v.is_enabled,
           pr.name AS product_name, pr.image_url, pr.is_active, pr.is_set
      INTO v_var
    FROM public.product_variations v JOIN public.products pr ON pr.id = v.product_id
    WHERE v.id = (v_line ->> 'variation_id')::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item not found';
    END IF;
    IF NOT v_var.is_active OR NOT v_var.is_enabled THEN
      RAISE EXCEPTION '"%" is inactive and cannot be rented', v_var.product_name;
    END IF;

    SELECT * INTO v_price FROM public.price_line(v_var.id, v_qty, v_start, v_end, v_tz);
    v_amount := v_price.amount;
    IF v_line ? 'amount_override' THEN
      v_amount := round((v_line ->> 'amount_override')::numeric, 2);
      IF v_amount < 0 THEN
        RAISE EXCEPTION 'A price cannot be negative';
      END IF;
    END IF;

    v_lines := v_lines || jsonb_build_object(
      'product_id', v_var.product_id, 'variation_id', v_var.id, 'kind', v_price.kind,
      'description', v_var.product_name || CASE WHEN v_var.name <> v_var.product_name THEN ' - ' || v_var.name ELSE '' END,
      'sku', v_var.sku, 'image_url', v_var.image_url, 'qty', v_qty,
      'rate_type', v_price.rate_type, 'rate', v_price.rate, 'time_units', v_price.time_units,
      'amount', v_amount, 'is_override', v_line ? 'amount_override',
      'unit_ids', COALESCE(v_line -> 'unit_ids', 'null'), 'reserve', true);
    v_items := v_items + v_amount;
    v_units_total := v_units_total + v_qty;

    IF v_price.kind = 'room' THEN
      v_has_room := true;
      v_room_base := v_room_base + COALESCE(v_var.base_occupancy, 2) * v_qty;
      v_room_max := v_room_max + COALESCE(v_var.max_occupancy, v_var.base_occupancy, 2) * v_qty;
      v_first_room := COALESCE(v_first_room, v_var.id);
    END IF;

    -- driver (cars), one per vehicle, per started day
    IF v_driver AND v_price.kind = 'vehicle' THEN
      IF NOT public.shop_feature(v_shop, 'with_driver') THEN
        RAISE EXCEPTION 'Rentals with a driver are not switched on for this shop';
      END IF;
      SELECT amount INTO v_rate FROM public.variation_rates WHERE variation_id = v_var.id AND rate_type = 'driver_day';
      IF v_rate IS NULL THEN
        RAISE EXCEPTION '"%" has no driver rate', v_var.product_name;
      END IF;
      v_amount := round(v_qty * v_rate * ceil(v_hours / 24.0), 2);
      v_lines := v_lines || jsonb_build_object(
        'product_id', v_var.product_id, 'variation_id', v_var.id, 'kind', 'vehicle',
        'description', 'Driver - ' || v_var.product_name, 'sku', v_var.sku, 'image_url', NULL, 'qty', v_qty,
        'rate_type', 'driver_day', 'rate', v_rate, 'time_units', ceil(v_hours / 24.0),
        'amount', v_amount, 'is_override', false, 'unit_ids', 'null', 'reserve', false);
      v_items := v_items + v_amount;
    END IF;
  END LOOP;

  -- guests above what the rooms include
  IF v_has_room THEN
    IF v_adults + v_children > v_room_max THEN
      RAISE EXCEPTION '% guests is more than these rooms allow (%)', v_adults + v_children, v_room_max;
    END IF;
    v_extra := v_adults + v_children - v_room_base;
    IF v_extra > 0 THEN
      SELECT amount INTO v_rate FROM public.variation_rates WHERE variation_id = v_first_room AND rate_type = 'extra_person';
      IF COALESCE(v_rate, 0) > 0 THEN
        SELECT v.product_id, v.sku INTO v_var FROM public.product_variations v WHERE v.id = v_first_room;
        v_amount := round(v_extra * v_rate * v_nights, 2);
        v_lines := v_lines || jsonb_build_object(
          'product_id', v_var.product_id, 'variation_id', v_first_room, 'kind', 'room',
          'description', 'Extra guests', 'sku', v_var.sku, 'image_url', NULL, 'qty', v_extra,
          'rate_type', 'extra_person', 'rate', v_rate, 'time_units', v_nights,
          'amount', v_amount, 'is_override', false, 'unit_ids', 'null', 'reserve', false);
        v_items := v_items + v_amount;
      END IF;
    END IF;
  END IF;

  -- add-ons
  FOR v_line IN SELECT value FROM jsonb_array_elements(COALESCE(p -> 'add_ons', '[]')) LOOP
    SELECT * INTO v_ao FROM public.add_ons WHERE id = (v_line ->> 'add_on_id')::uuid AND is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Add-on not found';
    END IF;
    v_ao_qty := COALESCE((v_line ->> 'quantity')::numeric, 1)
      * CASE v_ao.basis
          WHEN 'per_rental' THEN 1
          WHEN 'per_day' THEN CASE WHEN v_has_room THEN v_nights ELSE ceil(v_hours / 24.0) END
          WHEN 'per_unit_day' THEN v_units_total * CASE WHEN v_has_room THEN v_nights ELSE ceil(v_hours / 24.0) END
          WHEN 'per_person_night' THEN (v_adults + v_children) * v_nights
        END;
    IF v_ao_qty <= 0 THEN
      CONTINUE;
    END IF;
    v_amount := round(v_ao_qty * v_ao.amount, 2);
    v_add_ons := v_add_ons || jsonb_build_object('add_on_id', v_ao.id, 'name', v_ao.name, 'basis', v_ao.basis,
      'quantity', v_ao_qty, 'unit_amount', v_ao.amount, 'amount', v_amount);
    v_add_total := v_add_total + v_amount;
  END LOOP;

  RETURN jsonb_build_object('lines', v_lines, 'add_ons', v_add_ons,
    'items_total', v_items, 'add_ons_total', v_add_total, 'total_before_discount', v_items + v_add_total,
    'days', v_days, 'nights', v_nights, 'hours', v_hours);
END $$;

-- live quote for the booking form
CREATE OR REPLACE FUNCTION public.quote_rental(p jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  PERFORM public._require_role();
  PERFORM public._require_branch((p ->> 'branch_id')::uuid);
  RETURN public._quote(p);
END $$;

-- units of an item free for a period, as the booking form offers them
CREATE OR REPLACE FUNCTION public.find_available_units(p_branch_id uuid, p_variation_id uuid, p_start timestamptz, p_end timestamptz)
RETURNS TABLE (unit_id uuid, code text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  PERFORM public._require_role();
  PERFORM public._require_branch(p_branch_id);
  RETURN QUERY SELECT * FROM public.available_units(p_branch_id, p_variation_id, p_start, p_end);
END $$;
