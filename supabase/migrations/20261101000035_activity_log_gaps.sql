-- Activity log, part 2: the actions 034 did not see.
--
--   * Carts. A cart and its booking draft live only in the browser (until the booking is made), so the database never sees
--     them. The app now reports four cart actions through log_cart_event: a piece added, a piece removed, the cart's
--     customer set or changed, the cart discarded. The function checks the piece belongs to the shop and writes the names
--     itself, so a browser can only report its own cart actions. New area: 'carts' (the owner can filter them out).
--   * The condition and photos recorded at pickup and return (rental_checks): added to the booking's handover/return entry.
--   * A subscription payment Zypher records for the shop (shop_payments): shown to the owner under Settings.
--   * Reordering attributes or their values: one entry per minute per person, not one per row moved.

-- ==============================================================================
-- The log must never stop the work it records: 034's _act_log, now with a safety net. If writing an entry fails
-- (a bug in a sentence, an unexpected empty value), the action still goes through and the database logs a warning.
-- ==============================================================================
ALTER FUNCTION public._act_log(uuid, uuid, text, text, integer, text, uuid, text, text, boolean, jsonb, jsonb, text, uuid, text)
  RENAME TO _act_log_write;
CREATE OR REPLACE FUNCTION public._act_log(
  p_shop uuid, p_branch uuid, p_area text, p_action text, p_level int,
  p_record_type text, p_record_id uuid, p_label text, p_summary text,
  p_important boolean DEFAULT false, p_changes jsonb DEFAULT NULL, p_snapshot jsonb DEFAULT NULL,
  p_reason text DEFAULT NULL, p_actor uuid DEFAULT NULL, p_created_summary text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  PERFORM public._act_log_write(p_shop, p_branch, p_area, p_action, p_level, p_record_type, p_record_id, p_label,
    COALESCE(NULLIF(btrim(p_summary), ''), 'Made a change'), COALESCE(p_important, false), p_changes, p_snapshot,
    p_reason, p_actor, p_created_summary);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'activity log entry skipped (%): %', p_action, SQLERRM;
END $$;

ALTER TABLE public.activity_log DROP CONSTRAINT activity_log_area_check;
ALTER TABLE public.activity_log ADD CONSTRAINT activity_log_area_check
  CHECK (area IN ('bookings', 'money', 'customers', 'products', 'appointments', 'staff', 'branches', 'settings', 'account', 'carts'));

-- ==============================================================================
-- Carts (reported by the app; the only cart actions it may report)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.log_cart_event(
  p_kind text, p_cart int, p_customer text DEFAULT NULL, p_previous text DEFAULT NULL,
  p_variation uuid DEFAULT NULL, p_unit uuid DEFAULT NULL, p_qty int DEFAULT 1, p_items int DEFAULT NULL,
  p_branch uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid := public.current_shop_id();
  v_branch uuid;
  v_item text;
  v_code text;
  v_customer text := NULLIF(left(btrim(p_customer), 80), '');
  v_previous text := NULLIF(left(btrim(p_previous), 80), '');
  v_cart text;
  v_qty int := GREATEST(COALESCE(p_qty, 1), 1);
BEGIN
  IF auth.uid() IS NULL OR v_shop IS NULL THEN RETURN; END IF;
  IF p_kind NOT IN ('item_added', 'item_removed', 'customer_set', 'cart_discarded') THEN
    RAISE EXCEPTION 'Unknown cart event';
  END IF;
  v_cart := CASE WHEN v_customer IS NOT NULL THEN format('the cart for %s', v_customer)
                 ELSE format('cart %s', COALESCE(p_cart, 1)) END;

  IF p_kind IN ('item_added', 'item_removed') THEN
    SELECT p.name || CASE WHEN v.name IS NOT NULL AND v.name <> '' AND v.name <> p.name THEN ' – ' || v.name ELSE '' END
      INTO v_item
    FROM public.product_variations v JOIN public.products p ON p.id = v.product_id
    WHERE v.id = p_variation AND v.shop_id = v_shop;
    IF v_item IS NULL THEN RETURN; END IF;   -- not this shop's item
    SELECT code, branch_id INTO v_code, v_branch FROM public.units WHERE id = p_unit AND shop_id = v_shop;
    v_branch := COALESCE(v_branch, (SELECT id FROM public.branches WHERE id = p_branch AND shop_id = v_shop));
    PERFORM public._act_log(v_shop, v_branch, 'carts', 'cart_' || p_kind, 2, 'cart', NULL, COALESCE(v_customer, 'Cart ' || p_cart),
      format(CASE p_kind WHEN 'item_added' THEN 'Added %s%s%s to %s' ELSE 'Removed %s%s%s from %s' END,
             CASE WHEN v_qty > 1 THEN v_qty || ' × ' ELSE '' END, v_item,
             CASE WHEN v_code IS NOT NULL THEN ' (piece ' || v_code || ')' ELSE '' END, v_cart));
  ELSIF p_kind = 'customer_set' THEN
    IF v_customer IS NULL OR v_customer IS NOT DISTINCT FROM v_previous THEN RETURN; END IF;
    PERFORM public._act_log(v_shop, NULL, 'carts', 'cart_customer_set', 2, 'cart', NULL, v_customer,
      CASE WHEN v_previous IS NULL THEN format('Started cart %s for %s', COALESCE(p_cart, 1), v_customer)
           ELSE format('Changed the customer on cart %s from %s to %s', COALESCE(p_cart, 1), v_previous, v_customer) END);
  ELSE
    PERFORM public._act_log(v_shop, NULL, 'carts', 'cart_discarded', 2, 'cart', NULL, COALESCE(v_customer, 'Cart ' || p_cart),
      format('Discarded %s', v_cart)
      || CASE WHEN COALESCE(p_items, 0) > 0 THEN format(' (%s %s)', p_items, CASE WHEN p_items = 1 THEN 'item' ELSE 'items' END) ELSE '' END);
  END IF;
END $$;

-- ==============================================================================
-- Condition and photos at pickup and return: part of the booking's handover or return entry
-- ==============================================================================
CREATE OR REPLACE FUNCTION public._act_checks()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  r public.rentals%ROWTYPE;
  v_phase text := CASE WHEN NEW.phase = 'pickup' THEN 'pickup' ELSE 'return' END;
  v_code text;
  v_photos int := COALESCE(cardinality(NEW.photo_paths), 0);
BEGIN
  SELECT * INTO r FROM public.rentals WHERE id = NEW.rental_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_code := COALESCE((SELECT code FROM public.units WHERE id = NEW.unit_id), 'item');
  PERFORM public._act_log(r.shop_id, r.branch_id, 'bookings', 'booking_changed', 1, 'booking', r.id, r.token,
    format('Recorded the %s condition on booking %s', v_phase, r.token), COALESCE(NEW.condition IN ('damaged', 'missing', 'lost'), false),
    public._act_change(format('Condition at %s, %s', v_phase, v_code), NULL,
                       concat_ws(', ', public._act_words(NEW.condition), NULLIF(btrim(NEW.notes), ''),
                                 CASE WHEN NEW.odometer IS NOT NULL THEN NEW.odometer || ' km' END,
                                 CASE WHEN NEW.fuel_level IS NOT NULL THEN 'fuel ' || NEW.fuel_level END))
    || CASE WHEN v_photos > 0 THEN public._act_count(format('Photos at %s', v_phase), v_photos) ELSE '{}'::jsonb END,
    NULL, NULL, NEW.checked_by);
  RETURN NULL;
END $$;
CREATE TRIGGER trg_activity AFTER INSERT ON public.rental_checks FOR EACH ROW EXECUTE FUNCTION public._act_checks();

-- ==============================================================================
-- A subscription payment Zypher records for the shop
-- ==============================================================================
CREATE OR REPLACE FUNCTION public._act_shop_payments()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  PERFORM public._act_log(NEW.shop_id, NULL, 'settings', 'subscription_payment', 2, 'shop_payment', NEW.id, NEW.receipt_no,
    format('Zypher recorded a subscription payment of %s', public._act_inr(NEW.amount))
    || CASE WHEN NEW.period_to IS NOT NULL THEN format(', paid until %s', to_char(NEW.period_to, 'FMDD Mon YYYY')) ELSE '' END,
    false, public._act_change('Receipt', NULL, NEW.receipt_no) || public._act_change('Note', NULL, NEW.note),
    NULL, NULL, COALESCE(auth.uid(), NEW.recorded_by));
  RETURN NULL;
END $$;
CREATE TRIGGER trg_activity AFTER INSERT ON public.shop_payments FOR EACH ROW EXECUTE FUNCTION public._act_shop_payments();

-- ==============================================================================
-- Reordering attributes and values (each move saves two rows in two requests: one entry a minute is enough)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public._act_reorder()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_attr text;
  v_key uuid;
  v_sum text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME = 'shop_attributes' THEN
    v_key := NEW.shop_id;
    v_sum := 'Changed the order of the attributes';
  ELSE
    SELECT label INTO v_attr FROM public.shop_attributes WHERE id = NEW.attribute_id;
    v_key := NEW.attribute_id;
    v_sum := format('Changed the order of the values of attribute %s', COALESCE(v_attr, ''));
  END IF;
  IF EXISTS (SELECT 1 FROM public.activity_log
             WHERE shop_id = NEW.shop_id AND actor_id = auth.uid() AND action = 'reordered' AND record_id = v_key
               AND occurred_at > now() - interval '1 minute') THEN
    RETURN NULL;
  END IF;
  PERFORM public._act_log(NEW.shop_id, NULL, 'products', 'reordered', 2, 'order', v_key, v_attr, v_sum);
  RETURN NULL;
END $$;
CREATE TRIGGER trg_activity_order AFTER UPDATE OF sort ON public.shop_attributes
  FOR EACH ROW WHEN (OLD.sort IS DISTINCT FROM NEW.sort) EXECUTE FUNCTION public._act_reorder();
CREATE TRIGGER trg_activity_order AFTER UPDATE OF sort ON public.shop_attribute_values
  FOR EACH ROW WHEN (OLD.sort IS DISTINCT FROM NEW.sort) EXECUTE FUNCTION public._act_reorder();

-- ==============================================================================
-- Who may call what
-- ==============================================================================
REVOKE ALL ON FUNCTION public._act_checks(), public._act_shop_payments(), public._act_reorder(),
  public._act_log(uuid, uuid, text, text, integer, text, uuid, text, text, boolean, jsonb, jsonb, text, uuid, text),
  public._act_log_write(uuid, uuid, text, text, integer, text, uuid, text, text, boolean, jsonb, jsonb, text, uuid, text)
  FROM PUBLIC, anon, authenticated, app_rpc;
REVOKE ALL ON FUNCTION public.log_cart_event(text, int, text, text, uuid, uuid, int, int, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_cart_event(text, int, text, text, uuid, uuid, int, int, uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
