-- Cleaning & repairs (launch pack 1, part E; docs/LAUNCH_PACK_1_PLAN.md).
--   * A service job per piece (`service_jobs`): cleaning, alteration, repair or other; To do -> Away -> Ready (back) -> Done,
--     or cancelled. One open job per piece. Finishing a job with a cost adds the expense; "cannot be repaired" retires the
--     piece; finishing a job puts a piece the return or the alteration dialog had set "in service" back to available.
--   * Time-boxed hold: a repair, alteration or hand-made job keeps the piece out of new bookings from when it was made until
--     its due date (or until today, while it is overdue), not for every future date. A cleaning job made by a return sits
--     inside the booking's cleaning days, which already hold the piece, so it holds nothing more.
--   * At a return every piece gets a cleaning job (setting auto_cleaning, on by default) and a damaged piece a repair job.
-- Additive: with no open jobs every availability function returns exactly what it did. Pieces already "in service"
-- (units.status = maintenance) are left as they are. Support logins are unchanged.

CREATE TABLE public.service_jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     uuid NOT NULL REFERENCES public.shops(id),
  branch_id   uuid NOT NULL,
  unit_id     uuid NOT NULL,
  rental_id   uuid,
  type        text NOT NULL CHECK (type IN ('cleaning', 'alteration', 'repair', 'other')),
  status      text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'away', 'back', 'done', 'cancelled')),
  reason      text CHECK (reason IS NULL OR length(reason) <= 300),
  vendor      text CHECK (vendor IS NULL OR length(vendor) <= 80),
  due_on      date NOT NULL,
  sent_on     date,
  back_on     date,
  done_on     date,
  cost        numeric(14,2) CHECK (cost IS NULL OR cost >= 0),
  outcome     text CHECK (outcome IS NULL OR outcome IN ('ok', 'unrepairable')),
  expense_id  uuid,
  created_by  uuid REFERENCES public.profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_jobs_shop_unit_fkey FOREIGN KEY (shop_id, unit_id) REFERENCES public.units (shop_id, id) ON DELETE CASCADE,
  CONSTRAINT service_jobs_shop_branch_fkey FOREIGN KEY (shop_id, branch_id) REFERENCES public.branches (shop_id, id),
  CONSTRAINT service_jobs_shop_rental_fkey FOREIGN KEY (shop_id, rental_id) REFERENCES public.rentals (shop_id, id) ON DELETE SET NULL (rental_id)
);
-- a piece has at most one open job
CREATE UNIQUE INDEX service_jobs_one_open ON public.service_jobs (unit_id) WHERE status IN ('todo', 'away', 'back');
CREATE INDEX idx_service_jobs_shop_status ON public.service_jobs (shop_id, status, due_on);
ALTER TABLE public.service_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_isolation ON public.service_jobs AS RESTRICTIVE FOR ALL
  USING (shop_id = (SELECT public.current_shop_id())) WITH CHECK (shop_id = (SELECT public.current_shop_id()));
-- like appointments: the owner sees every branch, everyone else their own
CREATE POLICY service_jobs_read ON public.service_jobs FOR SELECT
  USING ((SELECT public.get_my_role()) IN ('super_admin', 'owner') OR branch_id = (SELECT public.get_my_branch()));
REVOKE ALL ON public.service_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.service_jobs TO authenticated;
GRANT ALL ON public.service_jobs TO service_role;

-- ------------------------------------------------------------------------------
-- the hold
-- ------------------------------------------------------------------------------
-- is the piece away for service at any time in [p_start, p_end)?
CREATE OR REPLACE FUNCTION public._job_holds(p_unit uuid, p_start timestamptz, p_end timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.service_jobs j JOIN public.shops s ON s.id = j.shop_id
    WHERE j.unit_id = p_unit AND j.status IN ('todo', 'away', 'back')
      AND NOT (j.type = 'cleaning' AND j.rental_id IS NOT NULL)
      AND tstzrange(j.created_at,
                    GREATEST(((j.due_on + 1)::timestamp AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata')), now() + interval '1 day'),
                    '[)') && tstzrange(p_start, p_end, '[)'));
$$;

-- bookings that need the piece while its job holds it (for a swap)
CREATE OR REPLACE FUNCTION public._job_clashes(p_job uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('rental_id', r.id, 'token', r.token, 'start_at', r.start_at) ORDER BY r.start_at), '[]')
  FROM public.service_jobs j
  JOIN public.shops s ON s.id = j.shop_id
  JOIN public.unit_reservations ur ON ur.unit_id = j.unit_id AND ur.state = 'held'
  JOIN public.rentals r ON r.id = ur.rental_id AND r.status = 'reserved' AND r.id IS DISTINCT FROM j.rental_id
  WHERE j.id = p_job
    AND ur.period && tstzrange(now(), GREATEST(((j.due_on + 1)::timestamp AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata')), now() + interval '1 day'), '[)');
$$;

-- 022's version, plus the hold
CREATE OR REPLACE FUNCTION public.available_units(p_branch_id uuid, p_variation_id uuid, p_start timestamptz, p_end timestamptz, p_cleaning_days integer)
RETURNS TABLE (unit_id uuid, code text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT u.id, u.code
  FROM public.units u
  JOIN public.product_variations v ON v.id = u.variation_id
  WHERE u.branch_id = p_branch_id AND u.variation_id = p_variation_id AND u.status = 'available'
    AND NOT public._unit_kept_late(u.id)
    AND NOT public._job_holds(u.id, p_start, p_end + COALESCE(make_interval(days => p_cleaning_days), v.turnaround))
    AND NOT EXISTS (
      SELECT 1 FROM public.unit_reservations ur
      WHERE ur.unit_id = u.id AND ur.state <> 'released'
        AND ur.period && tstzrange(p_start, p_end + COALESCE(make_interval(days => p_cleaning_days), v.turnaround), '[)'))
  ORDER BY u.code;
$$;

-- 022's version, plus the hold
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
           count(u.id) FILTER (WHERE NOT public._unit_kept_late(u.id)
             AND NOT public._job_holds(u.id, p_start, p_end + COALESCE(make_interval(days => p_cleaning_days), v.turnaround))
             AND NOT EXISTS (
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

-- 022's version; a piece chosen by hand must not be away for service on those dates either
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
      IF EXISTS (SELECT 1 FROM unnest(v_chosen) x WHERE public._job_holds(x, p_start, p_end)) THEN
        RAISE EXCEPTION 'A chosen piece for % is away for cleaning or repair on these dates', p_line ->> 'description';
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

-- 022's version, plus the hold
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
  IF public._job_holds(p_new_unit_id, lower(v_res.period), upper(v_res.period)) THEN
    RAISE EXCEPTION 'That piece is away for cleaning or repair on these dates';
  END IF;
  UPDATE public.unit_reservations SET unit_id = p_new_unit_id WHERE id = v_res.id;
EXCEPTION WHEN exclusion_violation THEN
  RAISE EXCEPTION 'That unit is booked by someone else for these dates';
END $$;

-- 037's wrapper; a piece away for service now cannot be handed over
CREATE OR REPLACE FUNCTION public.start_rental(p_rental_id uuid, p jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_hold text;
  v_code text;
BEGIN
  PERFORM public._require_role();
  SELECT handover_hold_note INTO v_hold FROM public.rentals WHERE id = p_rental_id;
  IF v_hold IS NOT NULL THEN
    RAISE EXCEPTION 'This hand over is on hold (%). Remove the hold on the booking first', v_hold;
  END IF;
  SELECT u.code INTO v_code FROM public.unit_reservations ur JOIN public.units u ON u.id = ur.unit_id
  WHERE ur.rental_id = p_rental_id AND ur.state = 'held' AND public._job_holds(ur.unit_id, now(), now() + interval '1 minute') LIMIT 1;
  IF v_code IS NOT NULL THEN
    RAISE EXCEPTION 'Piece % is away for cleaning or repair. Swap it, or finish its job on Cleaning & repairs first', v_code;
  END IF;
  RETURN public._start_rental_core(p_rental_id, p);
END $$;

-- ------------------------------------------------------------------------------
-- making and moving jobs
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_service_job(p_unit_id uuid, p_type text, p_reason text, p_due_on date,
                                                     p_vendor text DEFAULT NULL, p_rental_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_u public.units;
  v_id uuid;
BEGIN
  PERFORM public._require_role();
  SELECT * INTO v_u FROM public.units WHERE id = p_unit_id AND shop_id = public.current_shop_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Piece not found';
  END IF;
  PERFORM public._require_branch(v_u.branch_id);
  IF p_type NOT IN ('cleaning', 'alteration', 'repair', 'other') THEN
    RAISE EXCEPTION 'The job is cleaning, alteration, repair or other';
  END IF;
  IF p_due_on IS NULL OR p_due_on < (now() AT TIME ZONE public._shop_tz())::date THEN
    RAISE EXCEPTION 'Choose when it is due back (today or later)';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) > 300 OR length(btrim(COALESCE(p_vendor, ''))) > 80 THEN
    RAISE EXCEPTION 'The reason is at most 300 characters and the vendor at most 80';
  END IF;
  IF p_rental_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.rentals WHERE id = p_rental_id AND shop_id = v_u.shop_id) THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;
  IF EXISTS (SELECT 1 FROM public.service_jobs WHERE unit_id = p_unit_id AND status IN ('todo', 'away', 'back')) THEN
    RAISE EXCEPTION 'Piece % already has an open job on Cleaning & repairs', v_u.code;
  END IF;
  INSERT INTO public.service_jobs (shop_id, branch_id, unit_id, rental_id, type, reason, vendor, due_on, created_by)
  VALUES (v_u.shop_id, v_u.branch_id, p_unit_id, p_rental_id, p_type, NULLIF(btrim(p_reason), ''), NULLIF(btrim(p_vendor), ''), p_due_on, auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'clashes', public._job_clashes(v_id));
END $$;

-- send (out to the cleaner or tailor), back, extend (new due date), done (with outcome and cost), cancel
CREATE OR REPLACE FUNCTION public.update_service_job(p_job_id uuid, p_action text, p jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_j public.service_jobs;
  v_code text;
  v_role text := public._require_role();
  v_today date := (now() AT TIME ZONE public._shop_tz())::date;
  v_due date := NULLIF(p ->> 'due_on', '')::date;
  v_cost numeric := NULLIF(p ->> 'cost', '')::numeric;
  v_outcome text := COALESCE(NULLIF(p ->> 'outcome', ''), 'ok');
  v_expense uuid;
BEGIN
  SELECT * INTO v_j FROM public.service_jobs WHERE id = p_job_id AND shop_id = public.current_shop_id() FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found';
  END IF;
  PERFORM public._require_branch(v_j.branch_id);
  IF v_j.status IN ('done', 'cancelled') THEN
    RAISE EXCEPTION 'This job is closed';
  END IF;
  SELECT code INTO v_code FROM public.units WHERE id = v_j.unit_id;
  IF v_due IS NOT NULL AND v_due < v_today THEN
    RAISE EXCEPTION 'The due date is today or later';
  END IF;
  IF p ? 'vendor' AND length(btrim(COALESCE(p ->> 'vendor', ''))) > 80 THEN
    RAISE EXCEPTION 'The vendor is at most 80 characters';
  END IF;

  IF p_action = 'send' THEN
    IF v_j.status <> 'todo' THEN RAISE EXCEPTION 'Only a job still to do can be sent out'; END IF;
    UPDATE public.service_jobs SET status = 'away', sent_on = v_today, due_on = COALESCE(v_due, due_on),
           vendor = CASE WHEN p ? 'vendor' THEN NULLIF(btrim(p ->> 'vendor'), '') ELSE vendor END, updated_at = now()
    WHERE id = p_job_id;
  ELSIF p_action = 'back' THEN
    IF v_j.status <> 'away' THEN RAISE EXCEPTION 'Only a piece that is away can be marked back'; END IF;
    UPDATE public.service_jobs SET status = 'back', back_on = v_today, updated_at = now() WHERE id = p_job_id;
  ELSIF p_action = 'extend' THEN
    IF v_due IS NULL THEN RAISE EXCEPTION 'Choose the new due date'; END IF;
    UPDATE public.service_jobs SET due_on = v_due, updated_at = now() WHERE id = p_job_id;
  ELSIF p_action = 'done' THEN
    IF v_outcome NOT IN ('ok', 'unrepairable') THEN RAISE EXCEPTION 'The outcome is done or cannot be repaired'; END IF;
    IF (v_outcome = 'unrepairable' OR COALESCE(v_cost, 0) > 0) AND v_role NOT IN ('super_admin', 'owner', 'manager') THEN
      RAISE EXCEPTION 'A cost or "cannot be repaired" needs a manager or the owner';
    END IF;
    IF v_cost IS NOT NULL AND (v_cost < 0 OR v_cost > 10000000 OR v_cost <> round(v_cost, 2)) THEN
      RAISE EXCEPTION 'The cost is 0 to 1,00,00,000 rupees, in rupees and paise';
    END IF;
    IF COALESCE(v_cost, 0) > 0 THEN
      -- the shop's cost shows up in Finance > Expenses without typing it twice
      INSERT INTO public.expenses (shop_id, branch_id, spent_on, category, amount, note, created_by)
      VALUES (v_j.shop_id, v_j.branch_id, v_today,
              CASE v_j.type WHEN 'cleaning' THEN 'Dry-cleaning and laundry' WHEN 'alteration' THEN 'Tailoring and alterations' ELSE 'Repairs' END,
              v_cost, left(v_code || ': ' || COALESCE(v_j.reason, v_j.type) || COALESCE(' (' || v_j.vendor || ')', ''), 300), auth.uid())
      RETURNING id INTO v_expense;
    END IF;
    UPDATE public.service_jobs SET status = 'done', done_on = v_today, outcome = v_outcome, cost = v_cost, expense_id = v_expense,
           back_on = COALESCE(back_on, v_today), updated_at = now()
    WHERE id = p_job_id;
    IF v_outcome = 'unrepairable' THEN
      UPDATE public.units SET status = 'retired', status_reason = left('Cannot be repaired: ' || COALESCE(v_j.reason, v_j.type), 200) WHERE id = v_j.unit_id;
    ELSE
      -- a piece the return (damaged) or the alteration dialog set "in service" is ready again
      UPDATE public.units SET status = 'available', status_reason = NULL WHERE id = v_j.unit_id AND status = 'maintenance';
    END IF;
  ELSIF p_action = 'cancel' THEN
    IF v_role NOT IN ('super_admin', 'owner', 'manager') THEN RAISE EXCEPTION 'Cancelling a job needs a manager or the owner'; END IF;
    UPDATE public.service_jobs SET status = 'cancelled', done_on = v_today, updated_at = now() WHERE id = p_job_id;
  ELSE
    RAISE EXCEPTION 'Unknown action: %', p_action;
  END IF;
  RETURN jsonb_build_object('clashes', CASE WHEN p_action IN ('send', 'extend') THEN public._job_clashes(p_job_id) ELSE '[]'::jsonb END);
END $$;

-- at a return: a cleaning job for every piece of clothing (setting auto_cleaning), a repair job for a damaged piece
CREATE OR REPLACE FUNCTION public._jobs_after_return()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_piece record;
  v_day date := (COALESCE(NEW.actual_end_at, now()) AT TIME ZONE COALESCE((SELECT NULLIF(timezone, '') FROM public.shops WHERE id = NEW.shop_id), 'Asia/Kolkata'))::date;
  v_clean boolean := public._shop_rule(NEW.shop_id, 'auto_cleaning', 'true')::boolean;
BEGIN
  FOR v_piece IN
    SELECT DISTINCT ON (ur.unit_id) ur.unit_id, u.branch_id, rl.kind, c.condition
    FROM public.unit_reservations ur
    JOIN public.units u ON u.id = ur.unit_id
    JOIN public.rental_lines rl ON rl.id = ur.line_id
    LEFT JOIN public.rental_checks c ON c.rental_id = NEW.id AND c.unit_id = ur.unit_id AND c.phase = 'return'
    WHERE ur.rental_id = NEW.id AND ur.state = 'returned'
      AND NOT EXISTS (SELECT 1 FROM public.service_jobs j WHERE j.unit_id = ur.unit_id AND j.status IN ('todo', 'away', 'back'))
  LOOP
    IF v_piece.condition = 'damaged' THEN
      INSERT INTO public.service_jobs (shop_id, branch_id, unit_id, rental_id, type, reason, due_on, created_by)
      VALUES (NEW.shop_id, v_piece.branch_id, v_piece.unit_id, NEW.id, 'repair', 'Damaged on ' || NEW.token, v_day + 3, auth.uid());
    ELSIF v_clean AND v_piece.kind = 'wearable' AND v_piece.condition IS DISTINCT FROM 'lost' THEN
      INSERT INTO public.service_jobs (shop_id, branch_id, unit_id, rental_id, type, reason, due_on, created_by)
      VALUES (NEW.shop_id, v_piece.branch_id, v_piece.unit_id, NEW.id, 'cleaning', 'Returned from ' || NEW.token,
              v_day + GREATEST(COALESCE(NEW.cleaning_days, 1), 1), auth.uid());
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_jobs_after_return AFTER UPDATE OF status ON public.rentals
  FOR EACH ROW WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed') EXECUTE FUNCTION public._jobs_after_return();

-- ------------------------------------------------------------------------------
-- settings: auto_cleaning
-- ------------------------------------------------------------------------------
ALTER FUNCTION public._shop_setting_keys() RENAME TO _shop_setting_keys_040;
CREATE OR REPLACE FUNCTION public._shop_setting_keys()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public, pg_catalog AS $$
  SELECT public._shop_setting_keys_040() || ARRAY['auto_cleaning'];
$$;
ALTER FUNCTION public._settings_check(jsonb) RENAME TO _settings_check_040;
CREATE OR REPLACE FUNCTION public._settings_check(s jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_catalog AS $$
BEGIN
  PERFORM public._settings_check_040(s);
  IF s ? 'auto_cleaning' AND jsonb_typeof(s -> 'auto_cleaning') <> 'boolean' THEN
    RAISE EXCEPTION 'Sending returned pieces to cleaning is on or off';
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- activity log: area "service"
-- ------------------------------------------------------------------------------
ALTER TABLE public.activity_log DROP CONSTRAINT activity_log_area_check;
ALTER TABLE public.activity_log ADD CONSTRAINT activity_log_area_check
  CHECK (area IN ('bookings', 'money', 'customers', 'products', 'appointments', 'staff', 'branches', 'settings', 'account', 'carts', 'service'));

CREATE OR REPLACE FUNCTION public._act_service_jobs()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  j public.service_jobs%ROWTYPE;
  v_code text;
  v_what text;
  v_action text;
  v_sum text;
  v_level int := 2;
  v_imp boolean := false;
BEGIN
  IF TG_OP = 'DELETE' THEN RETURN NULL; END IF;
  j := NEW;
  v_code := COALESCE((SELECT code FROM public.units WHERE id = j.unit_id), 'a piece');
  v_what := CASE j.type WHEN 'cleaning' THEN 'cleaning' WHEN 'alteration' THEN 'alteration' WHEN 'repair' THEN 'repair' ELSE 'service' END;
  IF TG_OP = 'INSERT' THEN
    v_action := 'service_job_added';
    v_level := 0;
    v_sum := format('Added %s %s job for %s, due %s', CASE WHEN j.type = 'alteration' THEN 'an' ELSE 'a' END, v_what, v_code, to_char(j.due_on, 'DD Mon'))
             || COALESCE(': ' || j.reason, '');
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    CASE NEW.status
      WHEN 'away' THEN
        v_action := 'service_job_sent';
        v_sum := format('Sent %s for %s%s, due %s', v_code, v_what, COALESCE(' to ' || j.vendor, ''), to_char(j.due_on, 'DD Mon'));
      WHEN 'back' THEN
        v_action := 'service_job_back';
        v_sum := format('%s is back from %s%s', v_code, v_what, COALESCE(' (' || j.vendor || ')', ''));
      WHEN 'done' THEN
        v_action := CASE WHEN j.outcome = 'unrepairable' THEN 'service_job_unrepairable' ELSE 'service_job_done' END;
        v_imp := j.outcome = 'unrepairable';
        v_sum := CASE WHEN j.outcome = 'unrepairable' THEN format('Marked %s as cannot be repaired; it is retired', v_code)
                      ELSE format('Finished the %s of %s', v_what, v_code) END
                 || CASE WHEN COALESCE(j.cost, 0) > 0 THEN ', cost ' || public._act_inr(j.cost) ELSE '' END;
      ELSE
        v_action := 'service_job_cancelled';
        v_imp := true;
        v_sum := format('Cancelled the %s job of %s', v_what, v_code);
    END CASE;
  ELSIF NEW.due_on IS DISTINCT FROM OLD.due_on THEN
    v_action := 'service_job_changed';
    v_level := 1;
    v_sum := format('Changed the due date of the %s job of %s', v_what, v_code);
  ELSE
    RETURN NULL;
  END IF;
  PERFORM public._act_log(j.shop_id, j.branch_id, 'service', v_action, v_level, 'service_job', j.id, v_code, v_sum, v_imp,
    CASE WHEN TG_OP = 'UPDATE' THEN public._act_change('Due', to_char(OLD.due_on, 'DD Mon YYYY'), to_char(NEW.due_on, 'DD Mon YYYY'))
                                    || public._act_change('Vendor', OLD.vendor, NEW.vendor) END);
  RETURN NULL;
END $$;
CREATE TRIGGER trg_activity AFTER INSERT OR UPDATE ON public.service_jobs FOR EACH ROW EXECUTE FUNCTION public._act_service_jobs();

-- ------------------------------------------------------------------------------
-- who may call what
-- ------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public._job_holds(uuid, timestamptz, timestamptz), public._job_clashes(uuid), public._jobs_after_return(),
  public._shop_setting_keys_040(), public._settings_check_040(jsonb), public._act_service_jobs()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._act_service_jobs() FROM app_rpc;
-- the availability functions and start_rental run as app_rpc
GRANT EXECUTE ON FUNCTION public._job_holds(uuid, timestamptz, timestamptz) TO app_rpc;
REVOKE ALL ON FUNCTION public.create_service_job(uuid, text, text, date, text, uuid), public.update_service_job(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_service_job(uuid, text, text, date, text, uuid), public.update_service_job(uuid, text, jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
