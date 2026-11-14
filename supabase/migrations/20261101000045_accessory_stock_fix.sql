-- Fix for 044 (14 Nov 2026): the accessory stock trigger read NEW.rental_id inside one CASE expression, which PL/pgSQL
-- evaluates for rentals rows too, where that field does not exist ('record "new" has no field "rental_id"'). Every saved
-- change to a reserved or picked-up booking's dates or status failed at commit (hand over, extend, change, reopen).
-- Each table now has its own branch, so a field is only read on the table that has it. Nothing else changes.
CREATE OR REPLACE FUNCTION public._trg_add_on_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  IF TG_TABLE_NAME = 'rentals' THEN
    PERFORM public._check_add_on_stock(NEW.id);
  ELSE
    PERFORM public._check_add_on_stock(NEW.rental_id);
  END IF;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public._trg_add_on_stock() FROM PUBLIC, anon, authenticated, app_rpc;
