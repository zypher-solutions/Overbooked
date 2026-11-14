-- Cleaning & repairs: the job's dates decide when a returned piece can be booked again (041 left two gaps).
--   * Finished early: a returned piece is held by its booking until the return + the booking's cleaning days. Finishing
--     the job made by that return (Done, or cancelled) now ends that hold at once, so a piece cleaned a day early can be
--     booked from that moment instead of from the planned date.
--   * Late or moved: a cleaning job made by a return held nothing in 041 (the booking's cleaning days covered it), so a
--     piece still at the cleaner after those days, or one whose due date was moved later, showed as free. It now holds the
--     piece until the start of its due date. In the usual case that ends before the booking's own hold does, so nothing
--     changes; only a job that runs past the cleaning days or is moved later keeps the piece out longer. Once its due date
--     has passed it holds nothing more (an open job nobody closed does not lock the piece for good).
--   * Unchanged: repair, alteration and hand-made jobs; early and late returns and early hand overs (006, 012, 037 already
--     move the booking's dates); a job marked "Back in the shop" still holds until it is finished.

-- is the piece away for service at any time in [p_start, p_end)?
CREATE OR REPLACE FUNCTION public._job_holds(p_unit uuid, p_start timestamptz, p_end timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.service_jobs j JOIN public.shops s ON s.id = j.shop_id
    WHERE j.unit_id = p_unit AND j.status IN ('todo', 'away', 'back')
      AND tstzrange(j.created_at,
                    CASE WHEN j.type = 'cleaning' AND j.rental_id IS NOT NULL
                      -- made by a return: until its due date starts (never before it was made)
                      THEN GREATEST(j.created_at, (j.due_on::timestamp AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata')))
                      -- any other job: until its due date ends, or tomorrow while it is overdue
                      ELSE GREATEST(((j.due_on + 1)::timestamp AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata')), now() + interval '1 day')
                    END,
                    '[)') && tstzrange(p_start, p_end, '[)'));
$$;

-- bookings that need the piece while its job holds it (for a swap); the same window as _job_holds
CREATE OR REPLACE FUNCTION public._job_clashes(p_job uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('rental_id', r.id, 'token', r.token, 'start_at', r.start_at) ORDER BY r.start_at), '[]')
  FROM public.service_jobs j
  JOIN public.shops s ON s.id = j.shop_id
  JOIN public.unit_reservations ur ON ur.unit_id = j.unit_id AND ur.state = 'held'
  JOIN public.rentals r ON r.id = ur.rental_id AND r.status = 'reserved' AND r.id IS DISTINCT FROM j.rental_id
  WHERE j.id = p_job
    AND ur.period && tstzrange(now(),
          GREATEST(now(), CASE WHEN j.type = 'cleaning' AND j.rental_id IS NOT NULL
            THEN (j.due_on::timestamp AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata'))
            ELSE GREATEST(((j.due_on + 1)::timestamp AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata')), now() + interval '1 day')
          END), '[)');
$$;

-- finishing a job made by a return ends that booking's hold on the piece now (its cleaning days are over)
CREATE OR REPLACE FUNCTION public._jobs_free_on_finish()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  UPDATE public.unit_reservations
  SET period = tstzrange(lower(period), GREATEST(lower(period) + interval '1 minute', now()), '[)')
  WHERE rental_id = NEW.rental_id AND unit_id = NEW.unit_id AND state = 'returned' AND upper(period) > now();
  RETURN NULL;
END $$;
CREATE TRIGGER trg_jobs_free_on_finish AFTER UPDATE OF status ON public.service_jobs
  FOR EACH ROW WHEN (NEW.rental_id IS NOT NULL AND NEW.status IN ('done', 'cancelled') AND OLD.status IN ('todo', 'away', 'back'))
  EXECUTE FUNCTION public._jobs_free_on_finish();

REVOKE ALL ON FUNCTION public._jobs_free_on_finish() FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
