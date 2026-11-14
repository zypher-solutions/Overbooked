-- Accessories done properly (13 Nov 2026, owner's request):
--   * Linked to products as well as categories: add_ons.product_ids. Checkout suggests an accessory when the cart holds
--     one of its products or one of its categories (neither set = every item). Any active accessory can still be added.
--   * A price agreed for the booking: add_ons in a quote take amount_override, like item lines; it stays as agreed
--     when the booking is extended (rental_add_ons.is_override).
--   * "How many you have" is a real limit. rental_add_ons.pieces is how many of the accessory go out (the quantity
--     staff choose; rental_add_ons.quantity stays the billed count, e.g. pieces x days). At any moment of a booking, the
--     pieces out on reserved and picked-up bookings may not exceed the count; a booking that would go over is refused
--     ("Only 4 Ties are free for these dates"). Checked by deferred constraint triggers when the change is saved, so it
--     holds for new bookings, changed bookings, extensions and reopened bookings alike, and a lock per accessory stops
--     two counters taking the last pieces at the same moment. An accessory with no count is not limited.
--     Picked-up bookings hold their pieces until they are returned, even when late.
--   * add_on_free(): how many of each counted accessory are free for some dates (the checkout shows it).
-- Stock is per shop: accessories are not kept per branch.

-- ==============================================================================
-- Columns
-- ==============================================================================
ALTER TABLE public.add_ons ADD COLUMN product_ids uuid[] NOT NULL DEFAULT '{}';

ALTER TABLE public.rental_add_ons
  ADD COLUMN pieces integer CHECK (pieces IS NULL OR pieces > 0),
  ADD COLUMN is_override boolean NOT NULL DEFAULT false;

-- pieces of the accessories already booked: once per booking, or the billed count spread over the booking's days
UPDATE public.rental_add_ons ra
SET pieces = CASE WHEN ra.basis = 'per_rental' THEN GREATEST(1, round(ra.quantity))::integer
                  ELSE GREATEST(1, round(ra.quantity / GREATEST(1, ceil(public.rental_hours(r.start_at, r.end_at) / 24.0))))::integer END
FROM public.rentals r WHERE r.id = ra.rental_id;
UPDATE public.rental_add_ons SET pieces = 1 WHERE pieces IS NULL;
ALTER TABLE public.rental_add_ons ALTER COLUMN pieces SET NOT NULL, ALTER COLUMN pieces SET DEFAULT 1;

CREATE INDEX idx_rental_add_ons_add_on ON public.rental_add_ons (shop_id, add_on_id);

-- ==============================================================================
-- Quote: accessories with an agreed price and their pieces
-- ==============================================================================
-- 005's _quote prices the items; this wrapper prices the accessories (005's loop, plus amount_override and pieces).
-- p.add_ons = [{add_on_id, quantity?, amount_override?}]   quantity = how many pieces (default 1)
ALTER FUNCTION public._quote(jsonb) RENAME TO _quote_core;

CREATE OR REPLACE FUNCTION public._quote(p jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_q jsonb := public._quote_core(p - 'add_ons');
  v_has_room boolean;
  v_nights numeric := (v_q ->> 'nights')::numeric;
  v_hours numeric := (v_q ->> 'hours')::numeric;
  v_units numeric;
  v_line jsonb;
  v_ao RECORD;
  v_pieces integer;
  v_qty numeric;
  v_amount numeric;
  v_add_ons jsonb := '[]';
  v_total numeric := 0;
BEGIN
  SELECT bool_or(l ->> 'kind' = 'room'), COALESCE(sum((l ->> 'qty')::numeric) FILTER (WHERE (l ->> 'reserve')::boolean), 0)
    INTO v_has_room, v_units
  FROM jsonb_array_elements(v_q -> 'lines') l;
  v_has_room := COALESCE(v_has_room, false);

  FOR v_line IN SELECT value FROM jsonb_array_elements(COALESCE(p -> 'add_ons', '[]')) LOOP
    SELECT * INTO v_ao FROM public.add_ons WHERE id = (v_line ->> 'add_on_id')::uuid AND is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Add-on not found';
    END IF;
    v_pieces := COALESCE(round((v_line ->> 'quantity')::numeric), 1)::integer;
    IF v_pieces <= 0 THEN
      CONTINUE;
    END IF;
    v_qty := v_pieces
      * CASE v_ao.basis
          WHEN 'per_rental' THEN 1
          WHEN 'per_day' THEN CASE WHEN v_has_room THEN v_nights ELSE ceil(v_hours / 24.0) END
          WHEN 'per_unit_day' THEN v_units * CASE WHEN v_has_room THEN v_nights ELSE ceil(v_hours / 24.0) END
          WHEN 'per_person_night' THEN (COALESCE((p ->> 'adults')::integer, 1) + COALESCE((p ->> 'children')::integer, 0)) * v_nights
        END;
    IF v_qty <= 0 THEN
      CONTINUE;
    END IF;
    v_amount := round(v_qty * v_ao.amount, 2);
    IF NULLIF(btrim(v_line ->> 'amount_override'), '') IS NOT NULL THEN
      v_amount := round((v_line ->> 'amount_override')::numeric, 2);
      IF v_amount < 0 OR v_amount > 10000000 THEN
        RAISE EXCEPTION 'The price of % cannot be negative', v_ao.name;
      END IF;
    END IF;
    v_add_ons := v_add_ons || jsonb_build_object('add_on_id', v_ao.id, 'name', v_ao.name, 'basis', v_ao.basis,
      'quantity', v_qty, 'pieces', v_pieces, 'unit_amount', v_ao.amount, 'amount', v_amount,
      'is_override', NULLIF(btrim(v_line ->> 'amount_override'), '') IS NOT NULL);
    v_total := v_total + v_amount;
  END LOOP;

  RETURN v_q || jsonb_build_object('add_ons', v_add_ons, 'add_ons_total', v_total,
    'total_before_discount', (v_q ->> 'items_total')::numeric + v_total);
END $$;

-- 010's version, saving pieces and the agreed price of each accessory
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

  INSERT INTO public.rental_add_ons (shop_id, rental_id, add_on_id, name, basis, quantity, pieces, unit_amount, amount, is_override)
  SELECT v_shop, p_rental_id, (a ->> 'add_on_id')::uuid, a ->> 'name', a ->> 'basis',
         (a ->> 'quantity')::numeric, COALESCE((a ->> 'pieces')::integer, 1), (a ->> 'unit_amount')::numeric,
         (a ->> 'amount')::numeric, COALESCE((a ->> 'is_override')::boolean, false)
  FROM jsonb_array_elements(p_quote -> 'add_ons') a;
END $$;

-- 012's version: an accessory with an agreed price keeps it when the booking is extended
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

  -- time-based add-ons follow the new length (the billed count; an agreed price stays as agreed)
  FOR v_ao IN SELECT * FROM public.rental_add_ons WHERE rental_id = p_rental_id AND basis <> 'per_rental' LOOP
    v_qty := v_ao.quantity / GREATEST(1, CASE WHEN EXISTS (SELECT 1 FROM public.rental_lines WHERE rental_id = p_rental_id AND kind = 'room')
                                             THEN public.rental_days(v_r.start_at, v_r.end_at, v_tz)
                                             ELSE ceil(public.rental_hours(v_r.start_at, v_r.end_at) / 24.0) END)
             * CASE WHEN EXISTS (SELECT 1 FROM public.rental_lines WHERE rental_id = p_rental_id AND kind = 'room')
                    THEN public.rental_days(v_r.start_at, p_new_end, v_tz) ELSE ceil(v_hours / 24.0) END;
    UPDATE public.rental_add_ons SET quantity = v_qty,
      amount = CASE WHEN is_override THEN amount ELSE round(v_qty * unit_amount, 2) END
    WHERE id = v_ao.id;
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

-- ==============================================================================
-- Stock
-- ==============================================================================
-- the most pieces of an accessory out at any one moment between p_start and p_end, on reserved and picked-up
-- bookings other than p_exclude (a picked-up booking holds its pieces until it is returned, even when late)
CREATE OR REPLACE FUNCTION public._add_on_in_use(p_add_on uuid, p_start timestamptz, p_end timestamptz, p_exclude uuid DEFAULT NULL)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  WITH b AS (
    SELECT r.start_at AS s, CASE WHEN r.status = 'active' THEN GREATEST(r.end_at, now()) ELSE r.end_at END AS e, ra.pieces
    FROM public.rental_add_ons ra JOIN public.rentals r ON r.id = ra.rental_id
    WHERE ra.add_on_id = p_add_on AND r.status IN ('reserved', 'active') AND r.id IS DISTINCT FROM p_exclude
  ), near AS (
    SELECT * FROM b WHERE b.s < p_end AND b.e > p_start
  ), pts AS (
    SELECT p_start AS t UNION SELECT s FROM near WHERE s > p_start
  )
  SELECT COALESCE(max((SELECT sum(n.pieces) FROM near n WHERE n.s <= pts.t AND n.e > pts.t)), 0)::integer FROM pts;
$$;

-- refuse a booking that takes more of a counted accessory than is free in its dates
CREATE OR REPLACE FUNCTION public._check_add_on_stock(p_rental uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_r RECORD;
  v_a RECORD;
  v_end timestamptz;
  v_used integer;
  v_free integer;
BEGIN
  SELECT * INTO v_r FROM public.rentals WHERE id = p_rental;
  IF NOT FOUND OR v_r.status NOT IN ('reserved', 'active') THEN
    RETURN;
  END IF;
  v_end := CASE WHEN v_r.status = 'active' THEN GREATEST(v_r.end_at, now()) ELSE v_r.end_at END;
  FOR v_a IN
    SELECT a.id, a.name, a.quantity, sum(ra.pieces)::integer AS mine
    FROM public.rental_add_ons ra JOIN public.add_ons a ON a.id = ra.add_on_id
    WHERE ra.rental_id = p_rental AND a.quantity IS NOT NULL
    GROUP BY a.id, a.name, a.quantity
    ORDER BY a.id
  LOOP
    -- one booking at a time per accessory, so two counters cannot both take the last pieces
    PERFORM pg_advisory_xact_lock(hashtextextended('add_on_stock:' || v_a.id::text, 0));
    v_used := public._add_on_in_use(v_a.id, v_r.start_at, v_end, p_rental);
    IF v_used + v_a.mine > v_a.quantity THEN
      v_free := GREATEST(v_a.quantity - v_used, 0);
      RAISE EXCEPTION 'Only % % % free for these dates (% asked). Lower the number or change the dates.',
        v_free, v_a.name, CASE WHEN v_free = 1 THEN 'is' ELSE 'are' END, v_a.mine
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public._trg_add_on_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  PERFORM public._check_add_on_stock(CASE WHEN TG_TABLE_NAME = 'rentals' THEN NEW.id ELSE NEW.rental_id END);
  RETURN NULL;
END $$;

-- checked when the change is saved (deferred), so a booking changed in several steps is judged as a whole
CREATE CONSTRAINT TRIGGER trg_add_on_stock AFTER INSERT OR UPDATE OF pieces, add_on_id ON public.rental_add_ons
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public._trg_add_on_stock();
CREATE CONSTRAINT TRIGGER trg_add_on_stock AFTER UPDATE OF start_at, end_at, status ON public.rentals
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (NEW.status IN ('reserved', 'active'))
  EXECUTE FUNCTION public._trg_add_on_stock();

-- how many of each counted accessory are free for some dates (p_rental_id: the booking being changed, left out)
CREATE OR REPLACE FUNCTION public.add_on_free(p_start timestamptz, p_end timestamptz, p_rental_id uuid DEFAULT NULL)
RETURNS TABLE (add_on_id uuid, quantity integer, free integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  PERFORM public._require_role();
  IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN
    RAISE EXCEPTION 'The end must be after the start';
  END IF;
  RETURN QUERY
  SELECT a.id, a.quantity, GREATEST(a.quantity - public._add_on_in_use(a.id, p_start, p_end, p_rental_id), 0)
  FROM public.add_ons a
  WHERE a.shop_id = public.current_shop_id() AND a.is_active AND a.quantity IS NOT NULL;
END $$;

-- ==============================================================================
-- Activity log: what an accessory is suggested with (034's _act_catalog_setup, plus the links)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public._act_add_on_links(p_categories jsonb, p_products jsonb)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT COALESCE(NULLIF(left(concat_ws(', ',
    (SELECT string_agg(c.name, ', ' ORDER BY c.name) FROM public.categories c
     WHERE c.id::text IN (SELECT jsonb_array_elements_text(COALESCE(p_categories, '[]')))),
    (SELECT string_agg(pr.name, ', ' ORDER BY pr.name) FROM public.products pr
     WHERE pr.id::text IN (SELECT jsonb_array_elements_text(COALESCE(p_products, '[]'))))), 200), ''), 'Everything');
$$;

CREATE OR REPLACE FUNCTION public._act_catalog_setup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  o jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  n jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  x jsonb := COALESCE(n, o);
  v_shop uuid := (x ->> 'shop_id')::uuid;
  v_id uuid := (x ->> 'id')::uuid;
  v_kind text;
  v_name text;
  v_ch jsonb := '{}';
  v_level int := 1;
  v_action text;
  v_sum text;
  v_attr text;
BEGIN
  v_kind := CASE TG_TABLE_NAME WHEN 'categories' THEN 'category' WHEN 'add_ons' THEN 'extra'
                               WHEN 'shop_attributes' THEN 'attribute' ELSE 'attribute value' END;
  v_name := COALESCE(x ->> 'name', x ->> 'label', x ->> 'value');

  -- a value belongs to its attribute: values added or removed in one save are one entry
  IF TG_TABLE_NAME = 'shop_attribute_values' THEN
    SELECT label INTO v_attr FROM public.shop_attributes WHERE id = (x ->> 'attribute_id')::uuid;
    IF v_attr IS NULL THEN RETURN NULL; END IF;
    PERFORM public._act_log(v_shop, NULL, 'products', 'attribute_values_changed', 1, 'attribute', (x ->> 'attribute_id')::uuid, v_attr,
      format('Changed the values of attribute %s', v_attr), TG_OP = 'DELETE',
      CASE TG_OP WHEN 'INSERT' THEN public._act_count('Values added', 1)
                 WHEN 'DELETE' THEN public._act_count('Values removed', 1)
                 ELSE public._act_change(format('Value "%s"', o ->> 'value'), o ->> 'value', n ->> 'value') END);
    RETURN NULL;
  END IF;

  -- where an attribute sits in the SKU is the shop's SKU format: one entry for the whole format
  IF TG_TABLE_NAME = 'shop_attributes' AND TG_OP = 'UPDATE' AND (o -> 'sku_position') IS DISTINCT FROM (n -> 'sku_position') THEN
    PERFORM public._act_log(v_shop, NULL, 'products', 'sku_format_changed', 1, 'sku_format', v_shop, 'SKU format',
      'Changed the SKU format', false,
      public._act_change(format('%s position', n ->> 'label'), COALESCE(o ->> 'sku_position', 'Not used'), COALESCE(n ->> 'sku_position', 'Not used')));
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM public._act_log(v_shop, NULL, 'products', replace(v_kind, ' ', '_') || '_added', 0, v_kind, v_id, v_name,
      format('Added %s %s', v_kind, v_name)
      || CASE WHEN TG_TABLE_NAME = 'add_ons' THEN ' (' || public._act_inr((n ->> 'amount')::numeric) || ')' ELSE '' END);
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM public._act_log(v_shop, NULL, 'products', replace(v_kind, ' ', '_') || '_deleted', 3, v_kind, v_id, v_name,
      format('Deleted %s %s', v_kind, v_name), true, NULL, o);
    RETURN NULL;
  END IF;

  v_action := replace(v_kind, ' ', '_') || '_changed';
  v_sum := format('Changed %s %s', v_kind, v_name);
  v_ch := public._act_change('Name', COALESCE(o ->> 'name', o ->> 'label'), COALESCE(n ->> 'name', n ->> 'label'))
       || public._act_change('SKU prefix', o ->> 'sku_prefix', n ->> 'sku_prefix');
  IF TG_TABLE_NAME = 'add_ons' THEN
    v_ch := v_ch || public._act_change('Price', public._act_inr((o ->> 'amount')::numeric), public._act_inr((n ->> 'amount')::numeric))
                 || public._act_change('Charged', public._act_words(o ->> 'basis'), public._act_words(n ->> 'basis'))
                 || public._act_change('Quantity', o ->> 'quantity', n ->> 'quantity');
    IF (o -> 'category_ids') IS DISTINCT FROM (n -> 'category_ids') OR (o -> 'product_ids') IS DISTINCT FROM (n -> 'product_ids') THEN
      v_ch := v_ch || public._act_change('Suggested with', public._act_add_on_links(o -> 'category_ids', o -> 'product_ids'),
                                                            public._act_add_on_links(n -> 'category_ids', n -> 'product_ids'));
    END IF;
    IF (o ->> 'is_active') IS DISTINCT FROM (n ->> 'is_active') THEN
      v_level := 2;
      v_action := CASE WHEN (n ->> 'is_active')::boolean THEN 'extra_turned_on' ELSE 'extra_turned_off' END;
      v_sum := format(CASE WHEN (n ->> 'is_active')::boolean THEN 'Turned on extra %s' ELSE 'Turned off extra %s' END, v_name);
    END IF;
  ELSIF TG_TABLE_NAME = 'shop_attributes' AND (o ->> 'is_archived') IS DISTINCT FROM (n ->> 'is_archived') THEN
    v_level := 2;
    v_action := CASE WHEN (n ->> 'is_archived')::boolean THEN 'attribute_archived' ELSE 'attribute_restored' END;
    v_sum := format(CASE WHEN (n ->> 'is_archived')::boolean THEN 'Archived attribute %s' ELSE 'Restored attribute %s' END, v_name);
  END IF;
  PERFORM public._act_log(v_shop, NULL, 'products', v_action, v_level, v_kind, v_id, v_name, v_sum, false, v_ch);
  RETURN NULL;
END $$;

-- ==============================================================================
-- Owners and grants
-- ==============================================================================
DO $$
DECLARE f text;
BEGIN
  -- the shop workflow runs as app_rpc, as before
  FOREACH f IN ARRAY ARRAY['_quote(jsonb)', '_insert_lines(uuid, jsonb, uuid, timestamptz, timestamptz, uuid[])',
                           'extend_rental(uuid, timestamptz, jsonb)', 'add_on_free(timestamptz, timestamptz, uuid)']
  LOOP
    EXECUTE format('ALTER FUNCTION public.%s OWNER TO app_rpc', f);
  END LOOP;
END $$;
-- the stock count stays with the table owner: it must see every booking of the accessory, whoever saves, and a
-- deferred check may run without a signed-in shop (the accessory id already belongs to one shop)
REVOKE ALL ON FUNCTION public._quote(jsonb), public._quote_core(jsonb),
  public._insert_lines(uuid, jsonb, uuid, timestamptz, timestamptz, uuid[]),
  public._add_on_in_use(uuid, timestamptz, timestamptz, uuid), public._check_add_on_stock(uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._add_on_in_use(uuid, timestamptz, timestamptz, uuid) TO app_rpc;
REVOKE ALL ON FUNCTION public._trg_add_on_stock(), public._act_catalog_setup(), public._act_add_on_links(jsonb, jsonb)
FROM PUBLIC, anon, authenticated, app_rpc;
REVOKE ALL ON FUNCTION public.extend_rental(uuid, timestamptz, jsonb), public.add_on_free(timestamptz, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.extend_rental(uuid, timestamptz, jsonb), public.add_on_free(timestamptz, timestamptz, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
