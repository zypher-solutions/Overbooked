-- STATUS: APPLIED (live). Restored from qa/proposed-sql/003_rental_token_race.sql so the repo matches the live DB.
-- Finding FIN-12 (live-only function, not in any migration).
-- Live trigger set_rental_token (BEFORE INSERT on rentals) calls generate_rental_token(), which overwrites
-- the token that pickup_booking_atomic generated ('RN-XXXX') with TRZ-<year>-<n> using MAX()+1 and no lock.
-- Two pickups at the same moment read the same MAX and the second insert fails on the UNIQUE constraint,
-- surfacing as a duplicate-key error to the staff member. Also uses UTC for the year and has no search_path.
-- Fix: serialise the number allocation. Same token format, same trigger, no data change.

CREATE OR REPLACE FUNCTION public.generate_rental_token()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $function$
DECLARE
  year_part TEXT := TO_CHAR(NOW() AT TIME ZONE 'Asia/Kolkata', 'YYYY');
  seq       INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('trendz-rental-token:' || year_part, 0));

  SELECT COALESCE(MAX(CAST(SPLIT_PART(token, '-', 3) AS INT)), 0) + 1
    INTO seq
    FROM public.rentals
   WHERE token ~ ('^TRZ-' || year_part || '-[0-9]+$');

  NEW.token := 'TRZ-' || year_part || '-' || LPAD(seq::TEXT, 4, '0');
  RETURN NEW;
END;
$function$;

-- Test after applying (Phase 3, QA- data): fire 5 pickups in parallel; all must succeed with 5 distinct tokens.
