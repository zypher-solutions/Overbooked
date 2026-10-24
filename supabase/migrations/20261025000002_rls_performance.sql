-- Security rules: evaluate the helper checks once per query instead of once per row.
-- Load test (one busy shop-year, 1 CPU / 1 GB): a screen load was 24x slower with the rules on, because
-- get_my_role(), get_my_branch(), current_shop_id() ... ran for every row. Wrapped as (SELECT fn()),
-- Postgres computes each once and reuses it (Supabase's documented RLS performance advice).
-- Same rules, same results; only how often the checks run changes.
DO $$
DECLARE
  p RECORD;
  fn text;
  q text;
  c text;
  stmt text;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname IN ('public', 'storage')
      AND (schemaname = 'public' OR policyname LIKE 'product_images_%')
  LOOP
    q := p.qual;
    c := p.with_check;
    FOREACH fn IN ARRAY ARRAY['get_my_role()', 'get_my_branch()', 'current_shop_id()', 'my_home_shop_id()', 'is_platform_admin()',
                              'public.get_my_role()', 'public.get_my_branch()', 'public.current_shop_id()',
                              'public.my_home_shop_id()', 'public.is_platform_admin()']
    LOOP
      -- skip calls that are already wrapped
      q := replace(replace(q, '( SELECT ' || fn, '<<W>>'), fn, '( SELECT ' || fn || ')');
      q := replace(q, '<<W>>', '( SELECT ' || fn);
      c := replace(replace(c, '( SELECT ' || fn, '<<W>>'), fn, '( SELECT ' || fn || ')');
      c := replace(c, '<<W>>', '( SELECT ' || fn);
    END LOOP;

    IF q IS DISTINCT FROM p.qual OR c IS DISTINCT FROM p.with_check THEN
      stmt := format('ALTER POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
      IF q IS NOT NULL THEN stmt := stmt || format(' USING (%s)', q); END IF;
      IF c IS NOT NULL THEN stmt := stmt || format(' WITH CHECK (%s)', c); END IF;
      EXECUTE stmt;
    END IF;
  END LOOP;
END $$;

-- the app sorts and filters rentals and bookings by these within a shop
CREATE INDEX IF NOT EXISTS idx_rentals_shop_created ON public.rentals (shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rentals_shop_status ON public.rentals (shop_id, status);
CREATE INDEX IF NOT EXISTS idx_rentals_shop_rent_date ON public.rentals (shop_id, rent_date);
CREATE INDEX IF NOT EXISTS idx_bookings_shop_status_date ON public.bookings (shop_id, status, booking_date);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_shop_date ON public.ledger_entries (shop_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_inventory_items_shop_variation ON public.inventory_items (shop_id, variation_id, branch_id);

NOTIFY pgrst, 'reload schema';
