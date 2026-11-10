-- Activity log: who did what, when, and where, written in plain words for the shop owner (Admin > Activity log).
--
--   * One row per action a person takes: a booking made, a payment taken, a product changed, a login turned off...
--     Page views, searches, the cart, price quotes and totals the system keeps up to date itself are NOT logged.
--   * Written only by the database (triggers on the shop's tables, and three functions below), so every screen,
--     every database function and anything added later is covered. Nobody can change or delete a row from the app.
--   * One save is one entry: the rows one action touches in a single transaction are merged (a product saved with
--     five new pieces is "Changed product X: Pieces added 5", not six entries). Edits that end where they started vanish.
--   * Each entry keeps the values before and after ("changes") and, for a deletion, the whole deleted record
--     ("snapshot"), so lost data can be typed back in.
--   * Only the shop's owner reads it (not managers, staff or a Zypher support login).
--   * Rows are kept; nothing cleans them up. A future purge (shop offboarding) sets app.activity_purge = 'on' first.
--
-- A new feature that changes shop data must log here too: see "Activity log" in CLAUDE.md.

-- ==============================================================================
-- The table
-- ==============================================================================
CREATE TABLE public.activity_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shop_id       uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  branch_id     uuid,                                   -- the branch it happened in, when there is one
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  actor_id      uuid,                                   -- who did it
  actor_name    text NOT NULL,                          -- their name and role at the time (kept if they leave)
  actor_role    text NOT NULL,
  area          text NOT NULL CHECK (area IN ('bookings', 'money', 'customers', 'products', 'appointments',
                                              'staff', 'branches', 'settings', 'account')),
  action        text NOT NULL,                          -- a fixed key, e.g. booking_cancelled
  level         smallint NOT NULL CHECK (level BETWEEN 0 AND 3), -- 0 created, 1 changed, 2 a named event, 3 deleted
  important     boolean NOT NULL DEFAULT false,         -- deletions, cancellations, money corrections, staff changes
  summary       text NOT NULL,                          -- the sentence the owner reads
  record_type   text,                                   -- booking, payment, product, customer...
  record_id     uuid,
  record_label  text,                                   -- what the owner calls it: ZR-2026-0004, a product name...
  reason        text,
  changes       jsonb,                                  -- {"Label": {"from": "..", "to": ".."}} or {"Label": {"count": n}}
  snapshot      jsonb,                                  -- the whole record, for deletions
  txid          bigint NOT NULL DEFAULT txid_current()  -- groups one save into one entry
);
CREATE INDEX idx_activity_log_shop ON public.activity_log (shop_id, occurred_at DESC, id DESC);
CREATE INDEX idx_activity_log_actor ON public.activity_log (shop_id, actor_id, occurred_at DESC);
CREATE INDEX idx_activity_log_area ON public.activity_log (shop_id, area, occurred_at DESC);
CREATE INDEX idx_activity_log_merge ON public.activity_log (txid, record_type, record_id);

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY activity_owner_read ON public.activity_log FOR SELECT TO authenticated
  USING (shop_id = (SELECT public.current_shop_id())
         AND (SELECT public.get_my_role()) = 'owner'
         AND NOT (SELECT public.is_support()));
REVOKE ALL ON public.activity_log FROM PUBLIC, anon, authenticated, app_rpc;
GRANT SELECT ON public.activity_log TO authenticated, service_role;

-- a row can only change inside the save that wrote it (merging); after that it is fixed for good
CREATE OR REPLACE FUNCTION public._act_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
BEGIN
  IF OLD.txid = txid_current() OR current_setting('app.activity_purge', true) = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'The activity log cannot be changed or deleted';
END $$;
CREATE TRIGGER trg_activity_guard BEFORE UPDATE OR DELETE ON public.activity_log
  FOR EACH ROW EXECUTE FUNCTION public._act_guard();

-- ==============================================================================
-- Wording helpers
-- ==============================================================================
-- ₹1,23,456.50 (Indian grouping, like the app)
CREATE OR REPLACE FUNCTION public._act_inr(n numeric)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_catalog AS $$
DECLARE
  v numeric;
  s text;
  frac int;
BEGIN
  IF n IS NULL THEN RETURN NULL; END IF;
  v := abs(round(n, 2));
  s := trunc(v)::bigint::text;
  IF length(s) > 3 THEN
    s := regexp_replace(left(s, length(s) - 3), '(\d)(?=(\d\d)+$)', '\1,', 'g') || ',' || right(s, 3);
  END IF;
  frac := ((v - trunc(v)) * 100)::int;
  RETURN CASE WHEN n < 0 THEN '-' ELSE '' END || '₹' || s || CASE WHEN frac > 0 THEN '.' || lpad(frac::text, 2, '0') ELSE '' END;
END $$;

CREATE OR REPLACE FUNCTION public._act_tz(p_shop uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT COALESCE((SELECT NULLIF(timezone, '') FROM public.shops WHERE id = p_shop), 'Asia/Kolkata');
$$;

CREATE OR REPLACE FUNCTION public._act_day(p_at timestamptz, p_tz text)
RETURNS text LANGUAGE sql STABLE SET search_path = public, pg_catalog AS $$
  SELECT to_char(p_at AT TIME ZONE p_tz, 'FMDD Mon YYYY');
$$;

CREATE OR REPLACE FUNCTION public._act_when(p_at timestamptz, p_tz text)
RETURNS text LANGUAGE sql STABLE SET search_path = public, pg_catalog AS $$
  SELECT to_char(p_at AT TIME ZONE p_tz, 'FMDD Mon YYYY, FMHH12:MI AM');
$$;

CREATE OR REPLACE FUNCTION public._act_yesno(b boolean)
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN b THEN 'Yes' WHEN NOT b THEN 'No' END $$;

-- "late_penalty" -> "Late penalty"
CREATE OR REPLACE FUNCTION public._act_words(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT initcap(left(replace(p, '_', ' '), 1)) || substr(replace(p, '_', ' '), 2) $$;

CREATE OR REPLACE FUNCTION public._act_role_label(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p WHEN 'owner' THEN 'Owner' WHEN 'manager' THEN 'Manager' WHEN 'staff' THEN 'Staff'
                WHEN 'support' THEN 'Zypher support' WHEN 'super_admin' THEN 'Zypher' ELSE p END;
$$;

CREATE OR REPLACE FUNCTION public._act_branch_name(p uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT name FROM public.branches WHERE id = p;
$$;

-- one changed value; nothing when it did not change
CREATE OR REPLACE FUNCTION public._act_change(p_label text, p_from text, p_to text)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN NULLIF(btrim(p_from), '') IS NOT DISTINCT FROM NULLIF(btrim(p_to), '') THEN '{}'::jsonb
              ELSE jsonb_build_object(p_label, jsonb_build_object('from', COALESCE(NULLIF(btrim(p_from), ''), '—'),
                                                                   'to', COALESCE(NULLIF(btrim(p_to), ''), '—'))) END;
$$;

CREATE OR REPLACE FUNCTION public._act_count(p_label text, p_n int)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$ SELECT jsonb_build_object(p_label, jsonb_build_object('count', p_n)) $$;

-- merges two sets of changes: counts add up, a value keeps its first "from" and its last "to"; unchanged values drop out
CREATE OR REPLACE FUNCTION public._act_merge(a jsonb, b jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_catalog AS $$
DECLARE
  r jsonb := COALESCE(a, '{}');
  k text;
  v jsonb;
BEGIN
  FOR k, v IN SELECT * FROM jsonb_each(COALESCE(b, '{}')) LOOP
    IF v ? 'count' THEN
      r := r || jsonb_build_object(k, jsonb_build_object('count', COALESCE((r -> k ->> 'count')::int, 0) + (v ->> 'count')::int));
    ELSIF r -> k ? 'from' THEN
      r := r || jsonb_build_object(k, jsonb_build_object('from', r -> k -> 'from', 'to', v -> 'to'));
    ELSE
      r := r || jsonb_build_object(k, v);
    END IF;
  END LOOP;
  SELECT COALESCE(jsonb_object_agg(key, value), '{}') INTO r FROM jsonb_each(r)
  WHERE NOT (value ? 'from' AND value -> 'from' = value -> 'to') AND NOT (value ? 'count' AND (value ->> 'count')::int = 0);
  RETURN r;
END $$;

-- ==============================================================================
-- Writing an entry (merging with the entry this same save already wrote for the record)
-- ==============================================================================
-- p_level: 0 created, 1 changed, 2 a named event (handed over, cancelled, payment...), 3 deleted.
-- p_created_summary: when the record was created in this same save, its "created" sentence is refreshed with it
-- (a booking's total is only known once its lines are in).
CREATE OR REPLACE FUNCTION public._act_log(
  p_shop uuid, p_branch uuid, p_area text, p_action text, p_level int,
  p_record_type text, p_record_id uuid, p_label text, p_summary text,
  p_important boolean DEFAULT false, p_changes jsonb DEFAULT NULL, p_snapshot jsonb DEFAULT NULL,
  p_reason text DEFAULT NULL, p_actor uuid DEFAULT NULL, p_created_summary text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_actor uuid := COALESCE(p_actor, auth.uid());
  v_tx bigint := txid_current();
  v_row public.activity_log%ROWTYPE;
  v_changes jsonb;
  v_level int;
  v_reason text := COALESCE(NULLIF(btrim(p_reason), ''), NULLIF(btrim(current_setting('app.audit_reason', true)), ''));
  v_name text;
  v_role text;
BEGIN
  -- work done by the database itself (migrations, nightly jobs) is not a person's action
  IF v_actor IS NULL OR p_shop IS NULL THEN RETURN; END IF;

  IF p_record_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.activity_log
    WHERE txid = v_tx AND record_type = p_record_type AND record_id = p_record_id
    ORDER BY id DESC LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      IF v_row.level = 0 THEN
        -- created and deleted in one save: nothing happened
        IF p_level = 3 THEN DELETE FROM public.activity_log WHERE id = v_row.id; RETURN; END IF;
        -- created in this save: only counts (pieces added...) and the refreshed sentence are kept
        SELECT COALESCE(jsonb_object_agg(key, value), '{}') INTO v_changes FROM jsonb_each(COALESCE(p_changes, '{}')) WHERE value ? 'count';
        UPDATE public.activity_log
        SET summary = COALESCE(p_created_summary, summary),
            changes = NULLIF(public._act_merge(changes, v_changes), '{}')
        WHERE id = v_row.id;
        RETURN;
      END IF;
      v_changes := CASE WHEN p_level = 3 THEN COALESCE(p_changes, '{}') ELSE public._act_merge(v_row.changes, p_changes) END;
      v_level := GREATEST(v_row.level, p_level);
      IF v_level = 1 AND v_changes = '{}' THEN
        DELETE FROM public.activity_log WHERE id = v_row.id;   -- every change was undone in the same save
        RETURN;
      END IF;
      UPDATE public.activity_log
      SET action = CASE WHEN p_level >= v_row.level THEN p_action ELSE action END,
          summary = CASE WHEN p_level >= v_row.level THEN p_summary ELSE summary END,
          level = v_level,
          important = important OR p_important,
          reason = COALESCE(v_reason, reason),
          changes = NULLIF(v_changes, '{}'),
          snapshot = COALESCE(p_snapshot, snapshot)
      WHERE id = v_row.id;
      RETURN;
    END IF;
  END IF;

  v_changes := public._act_merge('{}', p_changes);
  IF p_level = 1 AND v_changes = '{}' THEN RETURN; END IF;

  SELECT full_name, role INTO v_name, v_role FROM public.profiles WHERE id = v_actor;
  INSERT INTO public.activity_log (shop_id, branch_id, actor_id, actor_name, actor_role, area, action, level, important,
                                   summary, record_type, record_id, record_label, reason, changes, snapshot)
  VALUES (p_shop, p_branch, v_actor, COALESCE(NULLIF(btrim(v_name), ''), 'Unknown person'), COALESCE(v_role, 'unknown'),
          p_area, p_action, p_level, p_important OR p_level = 3, p_summary, p_record_type, p_record_id, p_label, v_reason,
          NULLIF(v_changes, '{}'), p_snapshot);
END $$;

-- ==============================================================================
-- Bookings
-- ==============================================================================
CREATE OR REPLACE FUNCTION public._act_rentals()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  r public.rentals%ROWTYPE;
  v_tz text;
  v_cust text;
  v_created text;
  v_ch jsonb := '{}';
  v_sum text;
  v_action text := 'booking_changed';
  v_level int := 1;
  v_imp boolean := false;
  v_reason text;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  v_tz := public._act_tz(r.shop_id);
  v_cust := COALESCE((SELECT full_name FROM public.customers WHERE id = r.customer_id), 'a customer');
  v_created := format('New booking %s for %s, %s to %s', r.token, v_cust, public._act_day(r.start_at, v_tz), public._act_day(r.end_at, v_tz))
               || CASE WHEN r.total > 0 THEN ', total ' || public._act_inr(r.total) ELSE '' END;

  IF TG_OP = 'INSERT' THEN
    PERFORM public._act_log(r.shop_id, r.branch_id, 'bookings', 'booking_created', 0, 'booking', r.id, r.token, v_created,
                            false, public._act_change('Pickup', NULL, public._act_when(r.start_at, v_tz))
                                   || public._act_change('Return', NULL, public._act_when(r.end_at, v_tz))
                                   || public._act_change('Notes', NULL, r.notes));
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM public._act_log(r.shop_id, r.branch_id, 'bookings', 'booking_deleted', 3, 'booking', r.id, r.token,
                            format('Deleted booking %s for %s', r.token, v_cust), true, NULL, to_jsonb(OLD));
    RETURN NULL;
  END IF;

  -- money columns kept up to date by other triggers are not a person's change; only refresh a new booking's sentence
  IF pg_trigger_depth() > 1 THEN
    PERFORM public._act_log(r.shop_id, r.branch_id, 'bookings', 'booking_changed', 1, 'booking', r.id, r.token,
                            format('Changed booking %s for %s', r.token, v_cust), false, NULL, NULL, NULL, NULL, v_created);
    RETURN NULL;
  END IF;

  v_ch := public._act_change('Pickup', public._act_when(OLD.start_at, v_tz), public._act_when(NEW.start_at, v_tz))
       || public._act_change('Return', public._act_when(OLD.end_at, v_tz), public._act_when(NEW.end_at, v_tz))
       || public._act_change('Discount', public._act_inr(OLD.discount), public._act_inr(NEW.discount))
       || public._act_change('Deposit agreed', public._act_inr(OLD.deposit_agreed), public._act_inr(NEW.deposit_agreed))
       || public._act_change('Customer', (SELECT full_name FROM public.customers WHERE id = OLD.customer_id), v_cust)
       || public._act_change('Branch', public._act_branch_name(OLD.branch_id), public._act_branch_name(NEW.branch_id))
       || public._act_change('Cleaning days', OLD.cleaning_days::text, NEW.cleaning_days::text)
       || public._act_change('Adults', OLD.adults::text, NEW.adults::text)
       || public._act_change('Children', OLD.children::text, NEW.children::text)
       || public._act_change('Notes', OLD.notes, NEW.notes);
  IF OLD.id_verified_at IS NULL AND NEW.id_verified_at IS NOT NULL THEN
    v_ch := v_ch || public._act_change('ID checked', 'No', 'Yes');
  END IF;
  v_sum := CASE WHEN v_ch ? 'Discount' AND v_ch - 'Discount' = '{}' THEN format('Changed the discount on booking %s for %s', r.token, v_cust)
                WHEN v_ch ? 'Notes' AND v_ch - 'Notes' = '{}' THEN format('Updated the notes on booking %s for %s', r.token, v_cust)
                ELSE format('Changed booking %s for %s', r.token, v_cust) END;
  v_imp := v_ch ? 'Discount';

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    v_level := 2;
    CASE NEW.status
      WHEN 'active' THEN
        v_action := 'booking_handed_over';
        v_sum := format('Handed over booking %s to %s', r.token, v_cust);
      WHEN 'completed' THEN
        v_action := 'booking_returned';
        v_sum := format('Recorded the return of booking %s from %s', r.token, v_cust);
      WHEN 'cancelled' THEN
        v_action := 'booking_cancelled';
        v_imp := true;
        v_reason := NEW.cancel_reason;
        v_sum := format('Cancelled booking %s for %s', r.token, v_cust)
                 || CASE WHEN NEW.cancellation_fee > 0 THEN ', cancellation fee ' || public._act_inr(NEW.cancellation_fee) ELSE '' END;
      WHEN 'no_show' THEN
        v_action := 'booking_no_show';
        v_imp := true;
        v_reason := NEW.cancel_reason;
        v_sum := format('Marked booking %s for %s as a no-show', r.token, v_cust);
      ELSE
        v_level := 1;
        v_ch := v_ch || public._act_change('Status', public._act_words(OLD.status), public._act_words(NEW.status));
    END CASE;
  ELSIF NEW.invoice_no IS NOT NULL AND OLD.invoice_no IS NULL THEN
    v_level := 2;
    v_action := 'invoice_issued';
    v_sum := format('Issued tax invoice %s for booking %s (%s)', NEW.invoice_no, r.token, v_cust);
  ELSIF NEW.end_at > OLD.end_at AND NEW.start_at = OLD.start_at AND OLD.status = 'active' THEN
    v_level := 2;
    v_action := 'booking_extended';
    v_sum := format('Extended booking %s for %s to %s', r.token, v_cust, public._act_when(NEW.end_at, v_tz));
  END IF;

  PERFORM public._act_log(r.shop_id, r.branch_id, 'bookings', v_action, v_level, 'booking', r.id, r.token, v_sum,
                          v_imp, v_ch, NULL, v_reason, NULL, v_created);
  RETURN NULL;
END $$;

-- the items of a booking, as one sorted line ("Gold lehenga ₹4,000; Dupatta ×2 ₹600")
CREATE OR REPLACE FUNCTION public._act_item_text(p_name text, p_qty numeric, p_amount numeric)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT p_name || CASE WHEN p_qty > 1 THEN ' ×' || CASE WHEN p_qty = trunc(p_qty) THEN trunc(p_qty)::bigint::text ELSE p_qty::text END ELSE '' END
         || ' ' || public._act_inr(p_amount);
$$;

CREATE OR REPLACE FUNCTION public._act_arr_minus(a text[], b text[])
RETURNS text[] LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  x text;
  pos int;
BEGIN
  FOREACH x IN ARRAY COALESCE(b, '{}') LOOP
    pos := array_position(a, x);
    IF pos IS NOT NULL THEN a := a[1:pos - 1] || a[pos + 1:]; END IF;
  END LOOP;
  RETURN a;
END $$;

CREATE OR REPLACE FUNCTION public._act_arr_text(a text[])
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT string_agg(x, '; ' ORDER BY x) FROM unnest(a) x $$;

-- rental_lines and rental_add_ons, once per statement: "Items" before and after
CREATE OR REPLACE FUNCTION public._act_rental_items()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_ids uuid[];
  v_rid uuid;
  v_now text[];
  v_added text[] := '{}';
  v_removed text[] := '{}';
  r public.rentals%ROWTYPE;
  v_cust text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    EXECUTE 'SELECT array_agg(DISTINCT rental_id) FROM old_rows' INTO v_ids;
  ELSE
    EXECUTE 'SELECT array_agg(DISTINCT rental_id) FROM new_rows' INTO v_ids;
  END IF;

  FOREACH v_rid IN ARRAY COALESCE(v_ids, '{}') LOOP
    SELECT * INTO r FROM public.rentals WHERE id = v_rid;
    CONTINUE WHEN NOT FOUND;   -- the booking itself is being deleted

    SELECT COALESCE(array_agg(t), '{}') INTO v_now FROM (
      SELECT public._act_item_text(description, qty, amount) t FROM public.rental_lines WHERE rental_id = v_rid
      UNION ALL
      SELECT public._act_item_text(name, quantity, amount) FROM public.rental_add_ons WHERE rental_id = v_rid) x;

    IF TG_TABLE_NAME = 'rental_lines' THEN
      IF TG_OP <> 'DELETE' THEN
        EXECUTE 'SELECT COALESCE(array_agg(public._act_item_text(description, qty, amount)), ''{}'') FROM new_rows WHERE rental_id = $1'
          INTO v_added USING v_rid;
      END IF;
      IF TG_OP <> 'INSERT' THEN
        EXECUTE 'SELECT COALESCE(array_agg(public._act_item_text(description, qty, amount)), ''{}'') FROM old_rows WHERE rental_id = $1'
          INTO v_removed USING v_rid;
      END IF;
    ELSE
      IF TG_OP <> 'DELETE' THEN
        EXECUTE 'SELECT COALESCE(array_agg(public._act_item_text(name, quantity, amount)), ''{}'') FROM new_rows WHERE rental_id = $1'
          INTO v_added USING v_rid;
      END IF;
      IF TG_OP <> 'INSERT' THEN
        EXECUTE 'SELECT COALESCE(array_agg(public._act_item_text(name, quantity, amount)), ''{}'') FROM old_rows WHERE rental_id = $1'
          INTO v_removed USING v_rid;
      END IF;
    END IF;

    v_cust := COALESCE((SELECT full_name FROM public.customers WHERE id = r.customer_id), 'a customer');
    PERFORM public._act_log(r.shop_id, r.branch_id, 'bookings', 'booking_changed', 1, 'booking', r.id, r.token,
                            format('Changed booking %s for %s', r.token, v_cust),
                            -- a price corrected by the owner, with a reason
                            TG_OP = 'UPDATE' AND NULLIF(btrim(current_setting('app.audit_reason', true)), '') IS NOT NULL,
                            public._act_change('Items', public._act_arr_text(public._act_arr_minus(v_now, v_added) || v_removed),
                                               public._act_arr_text(v_now)));
  END LOOP;
  RETURN NULL;
END $$;

-- a different piece given out for a booking
CREATE OR REPLACE FUNCTION public._act_reservations()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  r public.rentals%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.rentals WHERE id = NEW.rental_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM public._act_log(r.shop_id, r.branch_id, 'bookings', 'piece_swapped', 2, 'booking', r.id, r.token,
                          format('Swapped a piece on booking %s', r.token), false,
                          public._act_change('Piece', (SELECT code FROM public.units WHERE id = OLD.unit_id),
                                                      (SELECT code FROM public.units WHERE id = NEW.unit_id)));
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public._act_reminders()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  r public.rentals%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.rentals WHERE id = NEW.rental_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM public._act_log(r.shop_id, r.branch_id, 'bookings', 'reminder_sent', 2, 'reminder', NEW.id, r.token,
    format('Sent the %s for booking %s to %s',
           CASE NEW.kind WHEN 'confirmation' THEN 'booking confirmation' WHEN 'pickup_reminder' THEN 'pickup reminder'
                         WHEN 'return_reminder' THEN 'return reminder' WHEN 'receipt' THEN 'receipt'
                         WHEN 'overdue' THEN 'overdue reminder' ELSE public._act_words(NEW.kind) END,
           r.token, COALESCE((SELECT full_name FROM public.customers WHERE id = r.customer_id), 'the customer')),
    false, NULL, NULL, NULL, NEW.sent_by);
  RETURN NULL;
END $$;

-- ==============================================================================
-- Money
-- ==============================================================================
CREATE OR REPLACE FUNCTION public._act_method(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p WHEN 'cash' THEN 'Cash' WHEN 'upi' THEN 'UPI' WHEN 'card' THEN 'Card' WHEN 'bank_transfer' THEN 'Bank transfer' ELSE p END;
$$;

CREATE OR REPLACE FUNCTION public._act_pay_kind(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p WHEN 'payment' THEN 'payment' WHEN 'refund' THEN 'refund' WHEN 'deposit' THEN 'security deposit'
                WHEN 'deposit_refund' THEN 'deposit return' WHEN 'deposit_applied' THEN 'deposit used toward the bill' ELSE p END;
$$;

CREATE OR REPLACE FUNCTION public._act_payments()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  p public.payments%ROWTYPE;
  r public.rentals%ROWTYPE;
  v_tz text;
  v_amt text;
  v_sum text;
BEGIN
  IF TG_OP = 'DELETE' THEN p := OLD; ELSE p := NEW; END IF;
  SELECT * INTO r FROM public.rentals WHERE id = p.rental_id;
  v_tz := public._act_tz(p.shop_id);
  v_amt := public._act_inr(p.amount);

  IF TG_OP = 'INSERT' THEN
    v_sum := CASE p.kind
      WHEN 'payment' THEN format('Received a payment of %s (%s) for booking %s', v_amt, public._act_method(p.method), r.token)
      WHEN 'refund' THEN format('Refunded %s (%s) on booking %s', v_amt, public._act_method(p.method), r.token)
      WHEN 'deposit' THEN format('Received a security deposit of %s (%s) for booking %s', v_amt, public._act_method(p.method), r.token)
      WHEN 'deposit_refund' THEN format('Returned %s of the security deposit (%s) on booking %s', v_amt, public._act_method(p.method), r.token)
      WHEN 'deposit_applied' THEN format('Used %s of the security deposit toward the bill of booking %s', v_amt, r.token)
      ELSE format('Recorded %s on booking %s', v_amt, r.token) END;
    PERFORM public._act_log(p.shop_id, r.branch_id, 'money', 'payment_' || p.kind, 2, 'payment', p.id, r.token, v_sum,
                            false, public._act_change('Note', NULL, p.note), NULL, NULL, p.recorded_by);
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM public._act_log(p.shop_id, r.branch_id, 'money', 'payment_changed', 2, 'payment', p.id, r.token,
      format('Corrected a %s on booking %s', public._act_pay_kind(p.kind), r.token), true,
      public._act_change('Amount', public._act_inr(OLD.amount), public._act_inr(NEW.amount))
      || public._act_change('Type', public._act_words(public._act_pay_kind(OLD.kind)), public._act_words(public._act_pay_kind(NEW.kind)))
      || public._act_change('Paid by', public._act_method(OLD.method), public._act_method(NEW.method))
      || public._act_change('Date', public._act_when(OLD.paid_at, v_tz), public._act_when(NEW.paid_at, v_tz))
      || public._act_change('Note', OLD.note, NEW.note));
  ELSE
    PERFORM public._act_log(p.shop_id, r.branch_id, 'money', 'payment_deleted', 3, 'payment', p.id, r.token,
      format('Deleted a %s of %s (%s) from booking %s', public._act_pay_kind(p.kind), v_amt, public._act_method(p.method), COALESCE(r.token, '—')),
      true, NULL, to_jsonb(OLD));
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public._act_charge_label(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p WHEN 'late' THEN 'late fee' WHEN 'extra_km' THEN 'extra km' WHEN 'fuel' THEN 'fuel' WHEN 'damage' THEN 'damage'
                WHEN 'lost' THEN 'lost item' WHEN 'cleaning' THEN 'cleaning' WHEN 'toll' THEN 'toll' WHEN 'parking' THEN 'parking'
                WHEN 'challan' THEN 'traffic fine' WHEN 'alteration' THEN 'alteration' WHEN 'extra_person' THEN 'extra guest'
                ELSE 'other' END;
$$;

CREATE OR REPLACE FUNCTION public._act_charges()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  c public.rental_charges%ROWTYPE;
  r public.rentals%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN c := OLD; ELSE c := NEW; END IF;
  SELECT * INTO r FROM public.rentals WHERE id = c.rental_id;
  IF TG_OP = 'INSERT' THEN
    PERFORM public._act_log(c.shop_id, r.branch_id, 'money', 'charge_added', 2, 'charge', c.id, r.token,
      format('Added a %s charge of %s to booking %s', public._act_charge_label(c.type), public._act_inr(c.amount), r.token),
      false, public._act_change('Note', NULL, c.note), NULL, NULL, c.created_by);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public._act_log(c.shop_id, r.branch_id, 'money', 'charge_removed', 3, 'charge', c.id, r.token,
      format('Removed the %s charge of %s from booking %s', public._act_charge_label(c.type), public._act_inr(c.amount), COALESCE(r.token, '—')),
      true, NULL, to_jsonb(OLD));
  ELSE
    PERFORM public._act_log(c.shop_id, r.branch_id, 'money', 'charge_changed', 1, 'charge', c.id, r.token,
      format('Changed the %s charge on booking %s', public._act_charge_label(c.type), r.token), true,
      public._act_change('Amount', public._act_inr(OLD.amount), public._act_inr(NEW.amount))
      || public._act_change('Note', OLD.note, NEW.note));
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public._act_expenses()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  e public.expenses%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN e := OLD; ELSE e := NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM public._act_log(e.shop_id, e.branch_id, 'money', 'expense_added', 0, 'expense', e.id, e.category,
      format('Added an expense of %s (%s)', public._act_inr(e.amount), e.category), false,
      public._act_change('Date', NULL, to_char(e.spent_on, 'FMDD Mon YYYY')) || public._act_change('Note', NULL, e.note),
      NULL, NULL, COALESCE(auth.uid(), e.created_by));
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM public._act_log(e.shop_id, e.branch_id, 'money', 'expense_changed', 2, 'expense', e.id, e.category,
      format('Corrected an expense of %s (%s)', public._act_inr(e.amount), e.category), true,
      public._act_change('Amount', public._act_inr(OLD.amount), public._act_inr(NEW.amount))
      || public._act_change('Date', to_char(OLD.spent_on, 'FMDD Mon YYYY'), to_char(NEW.spent_on, 'FMDD Mon YYYY'))
      || public._act_change('Category', OLD.category, NEW.category)
      || public._act_change('Branch', public._act_branch_name(OLD.branch_id), public._act_branch_name(NEW.branch_id))
      || public._act_change('Note', OLD.note, NEW.note));
  ELSE
    PERFORM public._act_log(e.shop_id, e.branch_id, 'money', 'expense_deleted', 3, 'expense', e.id, e.category,
      format('Deleted an expense of %s (%s)', public._act_inr(e.amount), e.category), true, NULL, to_jsonb(OLD));
  END IF;
  RETURN NULL;
END $$;

-- ==============================================================================
-- Customers
-- ==============================================================================
CREATE OR REPLACE FUNCTION public._act_mask(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN NULLIF(btrim(p), '') IS NULL THEN NULL ELSE '••••' || right(btrim(p), 4) END;
$$;

CREATE OR REPLACE FUNCTION public._act_customers()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_ch jsonb;
  v_action text := 'customer_changed';
  v_level int := 1;
  v_imp boolean := false;
  v_sum text;
  v_reason text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public._act_log(NEW.shop_id, NULL, 'customers', 'customer_added', 0, 'customer', NEW.id, NEW.full_name,
      format('Added customer %s', NEW.full_name) || COALESCE(' (' || NULLIF(NEW.phone, '') || ')', ''));
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM public._act_log(OLD.shop_id, NULL, 'customers', 'customer_deleted', 3, 'customer', OLD.id, OLD.full_name,
      format('Deleted customer %s', OLD.full_name), true, NULL, to_jsonb(OLD));
    RETURN NULL;
  END IF;

  v_ch := public._act_change('Name', OLD.full_name, NEW.full_name)
       || public._act_change('Phone', OLD.phone, NEW.phone)
       || public._act_change('Email', OLD.email, NEW.email)
       || public._act_change('Address', OLD.address, NEW.address)
       || public._act_change('ID type', public._act_words(OLD.id_type), public._act_words(NEW.id_type))
       || public._act_change('ID number', public._act_mask(OLD.id_number), public._act_mask(NEW.id_number))
       || public._act_change('Licence number', public._act_mask(OLD.licence_number), public._act_mask(NEW.licence_number))
       || public._act_change('Licence expiry', to_char(OLD.licence_expiry, 'FMDD Mon YYYY'), to_char(NEW.licence_expiry, 'FMDD Mon YYYY'))
       || public._act_change('Notes', OLD.notes, NEW.notes);
  v_sum := format('Updated the details of customer %s', NEW.full_name);
  IF NEW.is_blocked IS DISTINCT FROM OLD.is_blocked THEN
    v_level := 2;
    v_imp := true;
    IF NEW.is_blocked THEN
      v_action := 'customer_blocked';
      v_sum := format('Blocked customer %s', NEW.full_name);
      v_reason := NEW.blocked_reason;
    ELSE
      v_action := 'customer_unblocked';
      v_sum := format('Unblocked customer %s', NEW.full_name);
    END IF;
  END IF;
  PERFORM public._act_log(NEW.shop_id, NULL, 'customers', v_action, v_level, 'customer', NEW.id, NEW.full_name, v_sum,
                          v_imp, v_ch, NULL, v_reason);
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public._act_measurements()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  m public.customer_measurements%ROWTYPE;
  v_cust text;
  v_ch jsonb := '{}';
  k text;
BEGIN
  IF TG_OP = 'DELETE' THEN m := OLD; ELSE m := NEW; END IF;
  v_cust := COALESCE((SELECT full_name FROM public.customers WHERE id = m.customer_id), 'a customer');
  IF TG_OP = 'INSERT' THEN
    PERFORM public._act_log(m.shop_id, NULL, 'customers', 'measurements_added', 0, 'measurement', m.id, v_cust,
      format('Saved measurements "%s" for %s', COALESCE(m.label, 'Measurements'), v_cust));
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public._act_log(m.shop_id, NULL, 'customers', 'measurements_deleted', 3, 'measurement', m.id, v_cust,
      format('Deleted measurements "%s" of %s', COALESCE(m.label, 'Measurements'), v_cust), true, NULL, to_jsonb(OLD));
  ELSE
    FOR k IN SELECT jsonb_object_keys(COALESCE(OLD.measurements, '{}')) UNION SELECT jsonb_object_keys(COALESCE(NEW.measurements, '{}')) LOOP
      v_ch := v_ch || public._act_change(public._act_words(k), OLD.measurements ->> k, NEW.measurements ->> k);
    END LOOP;
    v_ch := v_ch || public._act_change('Name', OLD.label, NEW.label) || public._act_change('Notes', OLD.notes, NEW.notes);
    PERFORM public._act_log(m.shop_id, NULL, 'customers', 'measurements_changed', 1, 'measurement', m.id, v_cust,
      format('Changed measurements "%s" of %s', COALESCE(m.label, 'Measurements'), v_cust), false, v_ch);
  END IF;
  RETURN NULL;
END $$;

-- ==============================================================================
-- Products (a product, its variations, prices, pieces and set contents make one entry per save)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public._act_product_log(p_product uuid, p_changes jsonb, p_important boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  p public.products%ROWTYPE;
BEGIN
  SELECT * INTO p FROM public.products WHERE id = p_product;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM public._act_log(p.shop_id, NULL, 'products', 'product_changed', 1, 'product', p.id, p.name,
                          format('Changed product %s', p.name), p_important, p_changes);
END $$;

CREATE OR REPLACE FUNCTION public._act_products()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_ch jsonb;
  v_action text := 'product_changed';
  v_level int := 1;
  v_sum text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public._act_log(NEW.shop_id, NULL, 'products', 'product_added', 0, 'product', NEW.id, NEW.name,
      format('Added product %s', NEW.name) || COALESCE(' (' || NULLIF(NEW.sku, '') || ')', ''));
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM public._act_log(OLD.shop_id, NULL, 'products', 'product_deleted', 3, 'product', OLD.id, OLD.name,
      format('Deleted product %s', OLD.name) || COALESCE(' (' || NULLIF(OLD.sku, '') || ')', ''), true, NULL, to_jsonb(OLD));
    RETURN NULL;
  END IF;

  v_ch := public._act_change('Name', OLD.name, NEW.name)
       || public._act_change('SKU', OLD.sku, NEW.sku)
       || public._act_change('Category', (SELECT name FROM public.categories WHERE id = OLD.category_id),
                                         (SELECT name FROM public.categories WHERE id = NEW.category_id))
       || public._act_change('Description', left(OLD.description, 120), left(NEW.description, 120))
       || public._act_change('Photo', CASE WHEN OLD.image_url IS DISTINCT FROM NEW.image_url THEN CASE WHEN OLD.image_url IS NULL THEN NULL ELSE 'Old photo' END END,
                                      CASE WHEN OLD.image_url IS DISTINCT FROM NEW.image_url THEN CASE WHEN NEW.image_url IS NULL THEN 'Removed' ELSE 'New photo' END END)
       || public._act_change('Purchase price', public._act_inr(OLD.purchase_price), public._act_inr(NEW.purchase_price))
       || public._act_change('Replacement value', public._act_inr(OLD.replacement_value), public._act_inr(NEW.replacement_value))
       || public._act_change('MRP', public._act_inr(OLD.mrp), public._act_inr(NEW.mrp))
       || public._act_change('Security deposit', public._act_inr(OLD.security_deposit), public._act_inr(NEW.security_deposit))
       || public._act_change('Sold as a set', public._act_yesno(OLD.is_set), public._act_yesno(NEW.is_set));
  v_sum := format('Changed product %s', NEW.name);
  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    v_level := 2;
    v_action := CASE WHEN NEW.is_active THEN 'product_reactivated' ELSE 'product_deactivated' END;
    v_sum := format(CASE WHEN NEW.is_active THEN 'Brought back product %s' ELSE 'Took product %s off the shelf (deactivated)' END, NEW.name);
  END IF;
  PERFORM public._act_log(NEW.shop_id, NULL, 'products', v_action, v_level, 'product', NEW.id, NEW.name, v_sum, false, v_ch);
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public._act_variations()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public._act_product_log(NEW.product_id, public._act_count('Variations added', 1));
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public._act_product_log(OLD.product_id, public._act_count('Variations removed', 1), true);
  ELSE
    PERFORM public._act_product_log(NEW.product_id,
      public._act_change(format('Variation "%s"', OLD.name), OLD.name, NEW.name)
      || public._act_change(format('SKU of "%s"', NEW.name), OLD.sku, NEW.sku)
      || CASE WHEN OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN public._act_count('Variations archived', 1)
              WHEN OLD.archived_at IS NOT NULL AND NEW.archived_at IS NULL THEN public._act_count('Variations restored', 1)
              ELSE '{}'::jsonb END);
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public._act_rate_label(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p WHEN 'hour' THEN 'rate per hour' WHEN 'day' THEN 'rate per day' WHEN 'night' THEN 'rate per night'
                WHEN 'extra_km' THEN 'extra km rate' WHEN 'extra_hour' THEN 'extra hour rate' WHEN 'extra_person' THEN 'extra guest rate'
                WHEN 'driver_day' THEN 'driver per day' WHEN 'late_penalty' THEN 'late fee per day' ELSE replace(p, '_', ' ') END;
$$;

CREATE OR REPLACE FUNCTION public._act_rates()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_var uuid;
  v_type text;
  v_product uuid;
  v_name text;
BEGIN
  IF TG_OP = 'DELETE' THEN v_var := OLD.variation_id; v_type := OLD.rate_type; ELSE v_var := NEW.variation_id; v_type := NEW.rate_type; END IF;
  SELECT product_id, name INTO v_product, v_name FROM public.product_variations WHERE id = v_var;
  IF v_product IS NULL THEN RETURN NULL; END IF;
  PERFORM public._act_product_log(v_product,
    public._act_change(format('%s, %s', v_name, public._act_rate_label(v_type)),
                       CASE WHEN TG_OP <> 'INSERT' THEN public._act_inr(OLD.amount) END,
                       CASE WHEN TG_OP <> 'DELETE' THEN public._act_inr(NEW.amount) END));
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public._act_unit_status(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p WHEN 'available' THEN 'Available' WHEN 'maintenance' THEN 'In cleaning or repair' WHEN 'lost' THEN 'Lost'
                WHEN 'retired' THEN 'Retired' ELSE p END;
$$;

CREATE OR REPLACE FUNCTION public._act_units()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_pname text;
  v_ch jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public._act_product_log(NEW.product_id, public._act_count('Pieces added', 1));
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM public._act_product_log(OLD.product_id, public._act_count('Pieces removed', 1), true);
    RETURN NULL;
  END IF;

  v_pname := (SELECT name FROM public.products WHERE id = NEW.product_id);
  v_ch := public._act_change('Piece code', OLD.code, NEW.code)
       || public._act_change('Branch', public._act_branch_name(OLD.branch_id), public._act_branch_name(NEW.branch_id));
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public._act_log(NEW.shop_id, NEW.branch_id, 'products', 'piece_' || NEW.status, 2, 'piece', NEW.id, NEW.code,
      CASE NEW.status
        WHEN 'available' THEN format('Marked piece %s (%s) as available again', NEW.code, v_pname)
        WHEN 'maintenance' THEN format('Sent piece %s (%s) for cleaning or repair', NEW.code, v_pname)
        WHEN 'lost' THEN format('Marked piece %s (%s) as lost', NEW.code, v_pname)
        WHEN 'retired' THEN format('Retired piece %s (%s)', NEW.code, v_pname)
        ELSE format('Changed the status of piece %s (%s)', NEW.code, v_pname) END,
      NEW.status IN ('lost', 'retired'),
      v_ch || public._act_change('Status', public._act_unit_status(OLD.status), public._act_unit_status(NEW.status)),
      NULL, NEW.status_reason);
  ELSE
    PERFORM public._act_log(NEW.shop_id, NEW.branch_id, 'products', 'piece_changed', 1, 'piece', NEW.id, NEW.code,
      format('Changed piece %s (%s)', NEW.code, v_pname), false, v_ch);
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public._act_set_items()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  PERFORM public._act_product_log(CASE WHEN TG_OP = 'DELETE' THEN OLD.set_product_id ELSE NEW.set_product_id END,
                                  public._act_change('Set contents', NULL, 'Updated'));
  RETURN NULL;
END $$;

-- categories, extras (add-ons), attributes and their values: name-level changes
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
-- Appointments
-- ==============================================================================
CREATE OR REPLACE FUNCTION public._act_appointments()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  a public.appointments%ROWTYPE;
  v_tz text;
  v_cust text;
  v_type text;
  v_ch jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN a := OLD; ELSE a := NEW; END IF;
  v_tz := public._act_tz(a.shop_id);
  v_cust := COALESCE((SELECT full_name FROM public.customers WHERE id = a.customer_id), 'a customer');
  v_type := CASE WHEN a.type = 'other' THEN '' ELSE a.type || ' ' END;
  IF TG_OP = 'INSERT' THEN
    PERFORM public._act_log(a.shop_id, a.branch_id, 'appointments', 'appointment_booked', 0, 'appointment', a.id, v_cust,
      format('Booked a %sappointment for %s on %s', v_type, v_cust, public._act_when(a.scheduled_at, v_tz)), false,
      public._act_change('Notes', NULL, a.notes), NULL, NULL, COALESCE(auth.uid(), a.created_by));
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public._act_log(a.shop_id, a.branch_id, 'appointments', 'appointment_deleted', 3, 'appointment', a.id, v_cust,
      format('Deleted the %sappointment of %s on %s', v_type, v_cust, public._act_when(a.scheduled_at, v_tz)), true, NULL, to_jsonb(OLD));
  ELSE
    v_ch := public._act_change('Date and time', public._act_when(OLD.scheduled_at, v_tz), public._act_when(NEW.scheduled_at, v_tz))
         || public._act_change('Type', public._act_words(OLD.type), public._act_words(NEW.type))
         || public._act_change('Notes', OLD.notes, NEW.notes);
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      PERFORM public._act_log(a.shop_id, a.branch_id, 'appointments', 'appointment_' || NEW.status, 2, 'appointment', a.id, v_cust,
        CASE NEW.status
          WHEN 'done' THEN format('Marked the %sappointment of %s as done', v_type, v_cust)
          WHEN 'missed' THEN format('Marked the %sappointment of %s as missed', v_type, v_cust)
          WHEN 'cancelled' THEN format('Cancelled the %sappointment of %s', v_type, v_cust)
          ELSE format('Reopened the %sappointment of %s', v_type, v_cust) END,
        NEW.status = 'cancelled', v_ch);
    ELSE
      PERFORM public._act_log(a.shop_id, a.branch_id, 'appointments', 'appointment_changed', 1, 'appointment', a.id, v_cust,
        format('Changed the %sappointment of %s', v_type, v_cust), false, v_ch);
    END IF;
  END IF;
  RETURN NULL;
END $$;

-- ==============================================================================
-- Staff, branches, shop settings, support access
-- ==============================================================================
CREATE OR REPLACE FUNCTION public._act_branches()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_action text := 'branch_changed';
  v_level int := 1;
  v_sum text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public._act_log(NEW.shop_id, NEW.id, 'branches', 'branch_added', 0, 'branch', NEW.id, NEW.name, format('Added branch %s', NEW.name));
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM public._act_log(OLD.shop_id, OLD.id, 'branches', 'branch_deleted', 3, 'branch', OLD.id, OLD.name,
      format('Deleted branch %s', OLD.name), true, NULL, to_jsonb(OLD));
    RETURN NULL;
  END IF;
  v_sum := format('Changed the details of branch %s', NEW.name);
  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    v_level := 2;
    v_action := CASE WHEN NEW.is_active THEN 'branch_reopened' ELSE 'branch_closed' END;
    v_sum := format(CASE WHEN NEW.is_active THEN 'Reopened branch %s' ELSE 'Closed branch %s' END, NEW.name);
  END IF;
  PERFORM public._act_log(NEW.shop_id, NEW.id, 'branches', v_action, v_level, 'branch', NEW.id, NEW.name, v_sum,
    v_level = 2,
    public._act_change('Name', OLD.name, NEW.name) || public._act_change('Address', OLD.address, NEW.address)
    || public._act_change('Phone', OLD.phone, NEW.phone) || public._act_change('Email', OLD.email, NEW.email));
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public._act_profiles()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_ch jsonb;
  v_action text := 'person_changed';
  v_level int := 1;
  v_sum text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public._act_log(OLD.shop_id, OLD.branch_id, 'staff', 'person_removed', 3, 'person', OLD.id, OLD.full_name,
      format('Removed %s (%s) from the shop', OLD.full_name, public._act_role_label(OLD.role)), true, NULL, to_jsonb(OLD));
    RETURN NULL;
  END IF;
  v_ch := public._act_change('Name', OLD.full_name, NEW.full_name)
       || public._act_change('Branch', COALESCE(public._act_branch_name(OLD.branch_id), 'All branches'),
                                       COALESCE(public._act_branch_name(NEW.branch_id), 'All branches'));
  v_sum := format('Changed the details of %s', NEW.full_name);
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    v_level := 2;
    v_action := 'role_changed';
    v_sum := format('Changed the role of %s from %s to %s', NEW.full_name, public._act_role_label(OLD.role), public._act_role_label(NEW.role));
  ELSIF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    v_level := 2;
    v_action := CASE WHEN NEW.is_active THEN 'login_turned_on' ELSE 'login_turned_off' END;
    v_sum := format(CASE WHEN NEW.is_active THEN 'Turned on the login of %s' ELSE 'Turned off the login of %s' END, NEW.full_name);
  END IF;
  PERFORM public._act_log(COALESCE(NEW.shop_id, OLD.shop_id), NEW.branch_id, 'staff', v_action, v_level, 'person', NEW.id, NEW.full_name,
                          v_sum, v_level = 2 OR v_ch ? 'Branch', v_ch);
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public._act_shops()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_ch jsonb;
  k text;
  o jsonb := COALESCE(OLD.settings, '{}');
  n jsonb := COALESCE(NEW.settings, '{}');
BEGIN
  v_ch := public._act_change('Shop name', OLD.name, NEW.name)
       || public._act_change('Phone', OLD.phone, NEW.phone)
       || public._act_change('Email', OLD.email, NEW.email)
       || public._act_change('Address', OLD.address, NEW.address)
       || public._act_change('GSTIN', OLD.gstin, NEW.gstin)
       || public._act_change('Logo', CASE WHEN OLD.logo_url IS DISTINCT FROM NEW.logo_url THEN CASE WHEN OLD.logo_url IS NULL THEN NULL ELSE 'Old logo' END END,
                                     CASE WHEN OLD.logo_url IS DISTINCT FROM NEW.logo_url THEN CASE WHEN NEW.logo_url IS NULL THEN 'Removed' ELSE 'New logo' END END)
       || public._act_change('Time zone', OLD.timezone, NEW.timezone)
       || public._act_change('Booking number prefix', OLD.token_prefix, NEW.token_prefix)
       || public._act_change('Business types', array_to_string(OLD.business_types, ', '), array_to_string(NEW.business_types, ', '))
       || public._act_change('Plan', public._act_words(OLD.plan), public._act_words(NEW.plan))
       || public._act_change('Shop status', public._act_words(OLD.status), public._act_words(NEW.status));
  FOR k IN SELECT jsonb_object_keys(o) UNION SELECT jsonb_object_keys(n) LOOP
    CONTINUE WHEN k = 'features';
    v_ch := v_ch || public._act_change(public._act_words(k), left(o ->> k, 120), left(n ->> k, 120));
  END LOOP;
  FOR k IN SELECT jsonb_object_keys(COALESCE(o -> 'features', '{}')) UNION SELECT jsonb_object_keys(COALESCE(n -> 'features', '{}')) LOOP
    v_ch := v_ch || public._act_change('Feature: ' || public._act_words(k),
                                       CASE (o -> 'features' ->> k) WHEN 'true' THEN 'On' WHEN 'false' THEN 'Off' ELSE o -> 'features' ->> k END,
                                       CASE (n -> 'features' ->> k) WHEN 'true' THEN 'On' WHEN 'false' THEN 'Off' ELSE n -> 'features' ->> k END);
  END LOOP;
  PERFORM public._act_log(NEW.id, NULL, 'settings', 'settings_changed', 1, 'shop', NEW.id, NEW.name, 'Changed the shop settings',
                          v_ch ? 'Shop status' OR v_ch ? 'Plan', v_ch);
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public._act_support_access()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public._act_log(NEW.shop_id, NULL, 'settings', 'support_access_on', 2, 'support_access', NEW.shop_id, 'Zypher support',
      'Allowed Zypher support to open this shop', true, NULL, NULL, NULL, COALESCE(auth.uid(), NEW.granted_by));
  ELSE
    PERFORM public._act_log(OLD.shop_id, NULL, 'settings', 'support_access_off', 2, 'support_access', OLD.shop_id, 'Zypher support',
      'Turned off Zypher support access to this shop', true);
  END IF;
  RETURN NULL;
END $$;

-- ==============================================================================
-- The triggers
-- ==============================================================================
CREATE TRIGGER trg_activity AFTER INSERT OR UPDATE OR DELETE ON public.rentals FOR EACH ROW EXECUTE FUNCTION public._act_rentals();
CREATE TRIGGER trg_activity AFTER INSERT OR UPDATE OR DELETE ON public.payments FOR EACH ROW EXECUTE FUNCTION public._act_payments();
CREATE TRIGGER trg_activity AFTER INSERT OR UPDATE OR DELETE ON public.rental_charges FOR EACH ROW EXECUTE FUNCTION public._act_charges();
CREATE TRIGGER trg_activity AFTER INSERT OR UPDATE OR DELETE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public._act_expenses();
CREATE TRIGGER trg_activity AFTER INSERT ON public.rental_reminders FOR EACH ROW EXECUTE FUNCTION public._act_reminders();
CREATE TRIGGER trg_activity AFTER UPDATE OF unit_id ON public.unit_reservations
  FOR EACH ROW WHEN (OLD.unit_id IS DISTINCT FROM NEW.unit_id) EXECUTE FUNCTION public._act_reservations();
CREATE TRIGGER trg_activity AFTER INSERT OR UPDATE OR DELETE ON public.customers FOR EACH ROW EXECUTE FUNCTION public._act_customers();
CREATE TRIGGER trg_activity AFTER INSERT OR UPDATE OR DELETE ON public.customer_measurements FOR EACH ROW EXECUTE FUNCTION public._act_measurements();
CREATE TRIGGER trg_activity AFTER INSERT OR UPDATE OR DELETE ON public.products FOR EACH ROW EXECUTE FUNCTION public._act_products();
CREATE TRIGGER trg_activity AFTER INSERT OR UPDATE OR DELETE ON public.product_variations FOR EACH ROW EXECUTE FUNCTION public._act_variations();
CREATE TRIGGER trg_activity AFTER INSERT OR UPDATE OR DELETE ON public.variation_rates FOR EACH ROW EXECUTE FUNCTION public._act_rates();
CREATE TRIGGER trg_activity AFTER INSERT OR UPDATE OR DELETE ON public.units FOR EACH ROW EXECUTE FUNCTION public._act_units();
CREATE TRIGGER trg_activity AFTER INSERT OR UPDATE OR DELETE ON public.set_items FOR EACH ROW EXECUTE FUNCTION public._act_set_items();
CREATE TRIGGER trg_activity AFTER INSERT OR UPDATE OR DELETE ON public.appointments FOR EACH ROW EXECUTE FUNCTION public._act_appointments();
CREATE TRIGGER trg_activity AFTER INSERT OR UPDATE OR DELETE ON public.branches FOR EACH ROW EXECUTE FUNCTION public._act_branches();
CREATE TRIGGER trg_activity AFTER UPDATE OF role, is_active, branch_id, full_name OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public._act_profiles();
CREATE TRIGGER trg_activity AFTER UPDATE ON public.shops FOR EACH ROW EXECUTE FUNCTION public._act_shops();
CREATE TRIGGER trg_activity AFTER INSERT OR DELETE ON public.support_access FOR EACH ROW EXECUTE FUNCTION public._act_support_access();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['categories', 'add_ons', 'shop_attributes', 'shop_attribute_values'] LOOP
    EXECUTE format('CREATE TRIGGER trg_activity AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public._act_catalog_setup()', t);
  END LOOP;
  -- the items of a booking: once per statement, so "before" and "after" cover every row the statement touched
  FOREACH t IN ARRAY ARRAY['rental_lines', 'rental_add_ons'] LOOP
    EXECUTE format('CREATE TRIGGER trg_activity_ins AFTER INSERT ON public.%I REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public._act_rental_items()', t);
    EXECUTE format('CREATE TRIGGER trg_activity_upd AFTER UPDATE ON public.%I REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public._act_rental_items()', t);
    EXECUTE format('CREATE TRIGGER trg_activity_del AFTER DELETE ON public.%I REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public._act_rental_items()', t);
  END LOOP;
END $$;

-- ==============================================================================
-- Things only the app knows: invites and login links (from log_setup_event), sign-ins and password changes
-- ==============================================================================
-- 033's version, plus the shop's activity log
CREATE OR REPLACE FUNCTION public.log_setup_event(p_shop_id uuid, p_action text, p_detail jsonb DEFAULT '{}')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_person text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT public.is_platform_admin() THEN
    IF p_shop_id IS NULL THEN RAISE EXCEPTION 'Only Zypher can do this'; END IF;
    PERFORM public._require_setup_shop(p_shop_id);
  END IF;
  INSERT INTO public.audit_log (shop_id, performed_by, via, action, table_name, new_data)
  VALUES (p_shop_id, auth.uid(), 'app', 'setup_' || left(regexp_replace(p_action, '[^a-z_]', '', 'g'), 40), 'profiles', p_detail);

  IF p_shop_id IS NOT NULL THEN
    v_person := (SELECT full_name FROM public.profiles WHERE id = NULLIF(p_detail ->> 'user_id', '')::uuid);
    IF p_action = 'invite_created' THEN
      PERFORM public._act_log(p_shop_id, NULL, 'staff', 'staff_invited', 2, NULL, NULL, p_detail ->> 'email',
        format('Invited %s to join as %s', p_detail ->> 'email', public._act_role_label(p_detail ->> 'role')), true);
    ELSIF p_action = 'login_email_sent' THEN
      PERFORM public._act_log(p_shop_id, NULL, 'staff', 'login_email_sent', 2, NULL, NULL, v_person,
        format('Emailed a password reset link to %s', COALESCE(v_person, 'a person')), true);
    ELSIF p_action = 'login_link_created' THEN
      PERFORM public._act_log(p_shop_id, NULL, 'staff', 'login_link_created', 2, NULL, NULL, v_person,
        format('Made a new sign-in link for %s', COALESCE(v_person, 'a person')), true);
    END IF;
  END IF;
END $$;

-- called by the app after a sign-in or a password change (only these two, only about the caller themselves)
CREATE OR REPLACE FUNCTION public.log_account_event(p_kind text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid := public.current_shop_id();
  v_branch uuid;
BEGIN
  IF auth.uid() IS NULL OR v_shop IS NULL THEN RETURN; END IF;   -- Zypher staff have no shop log
  IF p_kind NOT IN ('signed_in', 'password_changed') THEN RAISE EXCEPTION 'Unknown account event'; END IF;
  -- one sign-in entry is enough when the sign-in screen and the two-step screen both report it
  IF p_kind = 'signed_in' AND EXISTS (
    SELECT 1 FROM public.activity_log WHERE shop_id = v_shop AND actor_id = auth.uid() AND action = 'signed_in'
      AND occurred_at > now() - interval '2 minutes') THEN
    RETURN;
  END IF;
  SELECT branch_id INTO v_branch FROM public.profiles WHERE id = auth.uid();
  PERFORM public._act_log(v_shop, v_branch, 'account', p_kind, 2, NULL, NULL, NULL,
    CASE p_kind WHEN 'signed_in' THEN 'Signed in' ELSE 'Set a new password' END);
END $$;

-- the people who appear in the log (the page's "person" filter), owner only through the table's rule
CREATE OR REPLACE FUNCTION public.activity_people()
RETURNS TABLE (actor_id uuid, actor_name text, actor_role text) LANGUAGE sql STABLE SET search_path = public, pg_catalog AS $$
  SELECT DISTINCT ON (l.actor_id) l.actor_id, l.actor_name, l.actor_role
  FROM public.activity_log l
  WHERE l.shop_id = public.current_shop_id()
  ORDER BY l.actor_id, l.occurred_at DESC;
$$;

-- ==============================================================================
-- Who may call what: the helpers and triggers are internal; the app may only call the two functions it needs
-- ==============================================================================
DO $$
DECLARE f text;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE '\_act\_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, app_rpc', f);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.log_account_event(text), public.activity_people() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_account_event(text), public.activity_people() TO authenticated;
NOTIFY pgrst, 'reload schema';
