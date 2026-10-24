-- Multi-shop: every business record belongs to a shop, and a shop never sees another shop's data.
--
-- Isolation has three layers:
--   1. A RESTRICTIVE policy "shop_isolation" on every business table: shop_id = current_shop_id().
--      It is ANDed with the existing role/branch policies, which stay unchanged.
--   2. Composite foreign keys (shop_id, parent_id) -> parent (shop_id, id), so no row can point at
--      another shop's booking, rental, unit, branch or customer.
--   3. The SECURITY DEFINER workflow functions are owned by the role app_rpc, which has NO BYPASSRLS.
--      They keep their elevated table rights through app_rpc's own permissive policies, but the
--      restrictive shop policy still applies to them, so they can only touch the caller's shop.
--
-- Roles: super_admin = Zypher staff (no shop; works inside the shop chosen with switch_shop).
--        owner / manager / staff = people of one shop.

-- ==============================================================================
-- 1. Shops, Zypher's manual billing log, per-shop counters
-- ==============================================================================
CREATE TABLE public.shops (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  slug          text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  token_prefix  text NOT NULL CHECK (token_prefix ~ '^[A-Z]{2,6}$'),
  phone         text,
  address       text,
  logo_url      text,
  plan          text NOT NULL DEFAULT 'starter' CHECK (plan IN ('starter', 'pro', 'business')),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  paid_until    date,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- shops pay Zypher by bank transfer; this is only the record of it
CREATE TABLE public.shop_payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id      uuid NOT NULL REFERENCES public.shops(id),
  amount       numeric(14,2) NOT NULL CHECK (amount > 0),
  paid_on      date NOT NULL,
  method       text NOT NULL DEFAULT 'bank_transfer' CHECK (method IN ('bank_transfer', 'upi', 'cash', 'cheque')),
  period_to    date NOT NULL,
  note         text,
  recorded_by  uuid REFERENCES public.profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_shop_payments_shop_id ON public.shop_payments (shop_id);

-- per-shop numbering for booking (BK-0001) and rental (<PREFIX>-YYYY-NNNN) tokens
CREATE TABLE public.shop_counters (
  shop_id  uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  kind     text NOT NULL,
  period   text NOT NULL DEFAULT '',
  value    bigint NOT NULL,
  PRIMARY KEY (shop_id, kind, period)
);

ALTER TABLE public.profiles
  ADD COLUMN shop_id uuid REFERENCES public.shops(id),
  ADD COLUMN active_shop_id uuid REFERENCES public.shops(id) ON DELETE SET NULL;

-- ==============================================================================
-- 2. Helper functions
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.my_home_shop_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT shop_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin' AND is_active IS TRUE);
$$;

-- the shop every query runs in: Zypher staff -> the shop they switched into; everyone else -> their own
-- shop, only while it is active. NULL = no shop, so every shop policy denies.
CREATE OR REPLACE FUNCTION public.current_shop_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT CASE WHEN p.role = 'super_admin' THEN p.active_shop_id ELSE p.shop_id END
  FROM public.profiles p
  WHERE p.id = auth.uid() AND p.is_active IS TRUE
    AND (p.role = 'super_admin'
         OR EXISTS (SELECT 1 FROM public.shops s WHERE s.id = p.shop_id AND s.status = 'active'));
$$;

-- same rules as before, plus: no role while the user's shop is suspended
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT p.role FROM public.profiles p
  WHERE p.id = auth.uid() AND p.is_active IS TRUE
    AND (p.role = 'super_admin'
         OR (EXISTS (SELECT 1 FROM public.shops s WHERE s.id = p.shop_id AND s.status = 'active')
             AND (p.role = 'owner' OR p.branch_id IS NULL
                  OR EXISTS (SELECT 1 FROM public.branches b WHERE b.id = p.branch_id AND b.is_active))));
$$;

CREATE OR REPLACE FUNCTION public.get_my_branch()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT p.branch_id FROM public.profiles p
  WHERE p.id = auth.uid() AND p.is_active IS TRUE
    AND (p.role = 'super_admin'
         OR (EXISTS (SELECT 1 FROM public.shops s WHERE s.id = p.shop_id AND s.status = 'active')
             AND (p.role = 'owner' OR p.branch_id IS NULL
                  OR EXISTS (SELECT 1 FROM public.branches b WHERE b.id = p.branch_id AND b.is_active))));
$$;

-- ==============================================================================
-- 3. shop_id on every business table (existing rows, if any, go to one "Legacy shop")
-- ==============================================================================
DO $$
DECLARE
  t text;
  v_legacy uuid;
  v_tables text[] := ARRAY['branches', 'customers', 'categories', 'products', 'product_variations',
    'product_stock', 'inventory_items', 'bookings', 'booking_items', 'booking_item_inventory',
    'rentals', 'rental_items', 'rental_item_inventory', 'payments', 'ledger_entries'];
BEGIN
  IF EXISTS (SELECT 1 FROM public.branches) OR EXISTS (SELECT 1 FROM public.products)
     OR EXISTS (SELECT 1 FROM public.rentals) OR EXISTS (SELECT 1 FROM public.bookings) THEN
    INSERT INTO public.shops (name, slug, token_prefix, plan)
    VALUES ('Legacy shop', 'legacy', 'TRZ', 'business')
    RETURNING id INTO v_legacy;
  END IF;

  FOREACH t IN ARRAY v_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN shop_id uuid REFERENCES public.shops(id)', t);
    IF v_legacy IS NOT NULL THEN
      EXECUTE format('UPDATE public.%I SET shop_id = $1', t) USING v_legacy;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN shop_id SET NOT NULL, ALTER COLUMN shop_id SET DEFAULT public.current_shop_id()', t);
    EXECUTE format('CREATE INDEX idx_%s_shop_id ON public.%I (shop_id)', t, t);
  END LOOP;

  IF v_legacy IS NOT NULL THEN
    UPDATE public.profiles SET shop_id = v_legacy WHERE role <> 'super_admin';
    UPDATE public.profiles SET active_shop_id = v_legacy WHERE role = 'super_admin';
    -- continue the legacy numbering instead of restarting it
    INSERT INTO public.shop_counters (shop_id, kind, period, value)
    SELECT v_legacy, 'booking', '', MAX(SUBSTRING(token FROM '^BK-([0-9]+)$')::bigint)
    FROM public.bookings WHERE token ~ '^BK-[0-9]+$' HAVING COUNT(*) > 0;
    INSERT INTO public.shop_counters (shop_id, kind, period, value)
    SELECT v_legacy, 'rental', SPLIT_PART(token, '-', 2), MAX(SPLIT_PART(token, '-', 3)::bigint)
    FROM public.rentals WHERE token ~ '^TRZ-[0-9]{4}-[0-9]+$' GROUP BY SPLIT_PART(token, '-', 2);
  END IF;
END $$;

ALTER TABLE public.audit_log ADD COLUMN shop_id uuid REFERENCES public.shops(id);
ALTER TABLE public.audit_log ALTER COLUMN shop_id SET DEFAULT public.current_shop_id();
CREATE INDEX idx_audit_log_shop_id ON public.audit_log (shop_id);

ALTER TABLE public.profiles ALTER COLUMN shop_id SET DEFAULT NULL;
CREATE INDEX idx_profiles_shop_id ON public.profiles (shop_id);
-- Zypher staff belong to no shop; shop people need a shop before they can be active
ALTER TABLE public.profiles ADD CONSTRAINT profiles_shop_check
  CHECK ((role = 'super_admin' AND shop_id IS NULL) OR (role <> 'super_admin' AND (shop_id IS NOT NULL OR is_active IS FALSE)));

-- ==============================================================================
-- 4. Uniqueness per shop instead of across all shops
-- ==============================================================================
ALTER TABLE public.products           DROP CONSTRAINT products_sku_key;
ALTER TABLE public.product_variations DROP CONSTRAINT product_variations_sku_key;
ALTER TABLE public.inventory_items    DROP CONSTRAINT inventory_items_item_sku_key;
ALTER TABLE public.branches           DROP CONSTRAINT branches_name_key;
ALTER TABLE public.branches           DROP CONSTRAINT branches_slug_key;
ALTER TABLE public.bookings           DROP CONSTRAINT bookings_token_key;
ALTER TABLE public.rentals            DROP CONSTRAINT rentals_token_key;
DROP INDEX public.categories_name_lower_key;

ALTER TABLE public.products           ADD CONSTRAINT products_shop_sku_key UNIQUE (shop_id, sku);
ALTER TABLE public.product_variations ADD CONSTRAINT product_variations_shop_sku_key UNIQUE (shop_id, sku);
ALTER TABLE public.inventory_items    ADD CONSTRAINT inventory_items_shop_item_sku_key UNIQUE (shop_id, item_sku);
ALTER TABLE public.branches           ADD CONSTRAINT branches_shop_name_key UNIQUE (shop_id, name);
ALTER TABLE public.branches           ADD CONSTRAINT branches_shop_slug_key UNIQUE (shop_id, slug);
ALTER TABLE public.bookings           ADD CONSTRAINT bookings_shop_token_key UNIQUE (shop_id, token);
ALTER TABLE public.rentals            ADD CONSTRAINT rentals_shop_token_key UNIQUE (shop_id, token);
CREATE UNIQUE INDEX categories_shop_name_key ON public.categories (shop_id, lower(name));

-- ==============================================================================
-- 5. Composite foreign keys: a row and everything it points at share one shop
-- ==============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['branches', 'customers', 'categories', 'products', 'product_variations',
    'inventory_items', 'bookings', 'booking_items', 'rentals', 'rental_items']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %s_shop_id_id_key UNIQUE (shop_id, id)', t, t);
  END LOOP;
END $$;

ALTER TABLE public.profiles               ADD CONSTRAINT profiles_shop_branch_fkey FOREIGN KEY (shop_id, branch_id) REFERENCES public.branches (shop_id, id);
ALTER TABLE public.products               ADD CONSTRAINT products_shop_category_fkey FOREIGN KEY (shop_id, category_id) REFERENCES public.categories (shop_id, id);
ALTER TABLE public.product_variations     ADD CONSTRAINT product_variations_shop_product_fkey FOREIGN KEY (shop_id, product_id) REFERENCES public.products (shop_id, id);
ALTER TABLE public.product_stock          ADD CONSTRAINT product_stock_shop_product_fkey FOREIGN KEY (shop_id, product_id) REFERENCES public.products (shop_id, id),
                                          ADD CONSTRAINT product_stock_shop_variation_fkey FOREIGN KEY (shop_id, variation_id) REFERENCES public.product_variations (shop_id, id),
                                          ADD CONSTRAINT product_stock_shop_branch_fkey FOREIGN KEY (shop_id, branch_id) REFERENCES public.branches (shop_id, id);
ALTER TABLE public.inventory_items        ADD CONSTRAINT inventory_items_shop_product_fkey FOREIGN KEY (shop_id, product_id) REFERENCES public.products (shop_id, id),
                                          ADD CONSTRAINT inventory_items_shop_variation_fkey FOREIGN KEY (shop_id, variation_id) REFERENCES public.product_variations (shop_id, id),
                                          ADD CONSTRAINT inventory_items_shop_branch_fkey FOREIGN KEY (shop_id, branch_id) REFERENCES public.branches (shop_id, id);
ALTER TABLE public.bookings               ADD CONSTRAINT bookings_shop_customer_fkey FOREIGN KEY (shop_id, customer_id) REFERENCES public.customers (shop_id, id),
                                          ADD CONSTRAINT bookings_shop_branch_fkey FOREIGN KEY (shop_id, branch_id) REFERENCES public.branches (shop_id, id);
ALTER TABLE public.booking_items          ADD CONSTRAINT booking_items_shop_booking_fkey FOREIGN KEY (shop_id, booking_id) REFERENCES public.bookings (shop_id, id),
                                          ADD CONSTRAINT booking_items_shop_product_fkey FOREIGN KEY (shop_id, product_id) REFERENCES public.products (shop_id, id),
                                          ADD CONSTRAINT booking_items_shop_variation_fkey FOREIGN KEY (shop_id, variation_id) REFERENCES public.product_variations (shop_id, id);
ALTER TABLE public.booking_item_inventory ADD CONSTRAINT bii_shop_booking_item_fkey FOREIGN KEY (shop_id, booking_item_id) REFERENCES public.booking_items (shop_id, id),
                                          ADD CONSTRAINT bii_shop_inventory_item_fkey FOREIGN KEY (shop_id, inventory_item_id) REFERENCES public.inventory_items (shop_id, id);
ALTER TABLE public.rentals                ADD CONSTRAINT rentals_shop_customer_fkey FOREIGN KEY (shop_id, customer_id) REFERENCES public.customers (shop_id, id),
                                          ADD CONSTRAINT rentals_shop_branch_fkey FOREIGN KEY (shop_id, branch_id) REFERENCES public.branches (shop_id, id),
                                          ADD CONSTRAINT rentals_shop_booking_fkey FOREIGN KEY (shop_id, booking_id) REFERENCES public.bookings (shop_id, id) ON DELETE SET NULL (booking_id);
ALTER TABLE public.rental_items           ADD CONSTRAINT rental_items_shop_rental_fkey FOREIGN KEY (shop_id, rental_id) REFERENCES public.rentals (shop_id, id),
                                          ADD CONSTRAINT rental_items_shop_product_fkey FOREIGN KEY (shop_id, product_id) REFERENCES public.products (shop_id, id),
                                          ADD CONSTRAINT rental_items_shop_variation_fkey FOREIGN KEY (shop_id, variation_id) REFERENCES public.product_variations (shop_id, id);
ALTER TABLE public.rental_item_inventory  ADD CONSTRAINT rii_shop_rental_item_fkey FOREIGN KEY (shop_id, rental_item_id) REFERENCES public.rental_items (shop_id, id),
                                          ADD CONSTRAINT rii_shop_inventory_item_fkey FOREIGN KEY (shop_id, inventory_item_id) REFERENCES public.inventory_items (shop_id, id);
ALTER TABLE public.payments               ADD CONSTRAINT payments_shop_rental_fkey FOREIGN KEY (shop_id, rental_id) REFERENCES public.rentals (shop_id, id);
ALTER TABLE public.ledger_entries         ADD CONSTRAINT ledger_entries_shop_branch_fkey FOREIGN KEY (shop_id, branch_id) REFERENCES public.branches (shop_id, id);

-- ==============================================================================
-- 6. Row level security
-- ==============================================================================
ALTER TABLE public.shops         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_counters ENABLE ROW LEVEL SECURITY;   -- no policies: only the token triggers write it

CREATE POLICY shops_read ON public.shops FOR SELECT
  USING (id = public.my_home_shop_id() OR public.is_platform_admin());
CREATE POLICY shops_admin ON public.shops FOR ALL
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

CREATE POLICY shop_payments_read ON public.shop_payments FOR SELECT
  USING (public.is_platform_admin() OR (shop_id = public.my_home_shop_id() AND public.get_my_role() = 'owner'));
CREATE POLICY shop_payments_admin ON public.shop_payments FOR ALL
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['branches', 'customers', 'categories', 'products', 'product_variations',
    'product_stock', 'inventory_items', 'bookings', 'booking_items', 'booking_item_inventory',
    'rentals', 'rental_items', 'rental_item_inventory', 'payments', 'ledger_entries', 'audit_log']
  LOOP
    EXECUTE format('CREATE POLICY shop_isolation ON public.%I AS RESTRICTIVE FOR ALL
                    USING (shop_id = public.current_shop_id()) WITH CHECK (shop_id = public.current_shop_id())', t);
  END LOOP;
END $$;

-- everyone can read their own profile (so a paused shop can show its message); otherwise own shop only
CREATE POLICY shop_isolation ON public.profiles AS RESTRICTIVE FOR ALL
  USING (id = auth.uid() OR shop_id = public.current_shop_id())
  WITH CHECK (shop_id = public.current_shop_id());

-- ==============================================================================
-- 7. app_rpc: the owner of the workflow functions. No BYPASSRLS, so the shop policy binds them.
-- ==============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rpc') THEN
    CREATE ROLE app_rpc NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
GRANT app_rpc TO postgres;
GRANT USAGE, CREATE ON SCHEMA public TO app_rpc;
-- auth.uid() and the auth schema: inherited from authenticated (postgres cannot grant them directly).
-- One-way: app_rpc gets authenticated's rights, authenticated never gets app_rpc's.
GRANT authenticated TO app_rpc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_rpc;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_rpc;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_rpc;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rpc;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO app_rpc;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['branches', 'customers', 'categories', 'products', 'product_variations',
    'product_stock', 'inventory_items', 'bookings', 'booking_items', 'booking_item_inventory',
    'rentals', 'rental_items', 'rental_item_inventory', 'payments', 'ledger_entries', 'audit_log', 'profiles']
  LOOP
    EXECUTE format('CREATE POLICY rpc_all ON public.%I FOR ALL TO app_rpc USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

ALTER FUNCTION public.admin_delete_booking(uuid, text) OWNER TO app_rpc;
ALTER FUNCTION public.admin_delete_payment(uuid, text) OWNER TO app_rpc;
ALTER FUNCTION public.admin_delete_rental(uuid, text) OWNER TO app_rpc;
ALTER FUNCTION public.admin_update_payment(uuid, numeric, text, text) OWNER TO app_rpc;
ALTER FUNCTION public.admin_update_rental(uuid, numeric, numeric, text, text) OWNER TO app_rpc;
ALTER FUNCTION public._reverse_ledger_for(uuid, uuid, text) OWNER TO app_rpc;
ALTER FUNCTION public.cancel_booking_atomic(uuid, numeric, text, text) OWNER TO app_rpc;
ALTER FUNCTION public.create_booking_atomic(text, uuid, uuid, date, text, uuid, numeric, numeric, numeric, jsonb, numeric) OWNER TO app_rpc;
ALTER FUNCTION public.delete_or_deactivate_product(uuid) OWNER TO app_rpc;
ALTER FUNCTION public.extend_rental_atomic(uuid, date, numeric, text, text) OWNER TO app_rpc;
ALTER FUNCTION public.get_all_inventory_stats() OWNER TO app_rpc;
ALTER FUNCTION public.get_booking_token(uuid) OWNER TO app_rpc;
ALTER FUNCTION public.import_products_atomic(jsonb) OWNER TO app_rpc;
ALTER FUNCTION public.mark_returned_atomic(uuid, timestamp with time zone, text, text, numeric, text, jsonb, numeric, text, numeric, text) OWNER TO app_rpc;
ALTER FUNCTION public.pickup_booking_atomic(uuid, date, numeric, uuid, text) OWNER TO app_rpc;
ALTER FUNCTION public.record_rental_payment(uuid, numeric, text) OWNER TO app_rpc;

-- ==============================================================================
-- 8. Per-shop token numbering
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.next_shop_counter(p_shop_id uuid, p_kind text, p_period text)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  INSERT INTO public.shop_counters (shop_id, kind, period, value) VALUES (p_shop_id, p_kind, p_period, 1)
  ON CONFLICT (shop_id, kind, period) DO UPDATE SET value = public.shop_counters.value + 1
  RETURNING value;
$$;
REVOKE ALL ON FUNCTION public.next_shop_counter(uuid, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.assign_booking_reference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_seq bigint;
BEGIN
  -- client-supplied tokens are always overridden
  v_seq := public.next_shop_counter(NEW.shop_id, 'booking', '');
  NEW.token := 'BK-' || lpad(v_seq::text, GREATEST(4, length(v_seq::text)), '0');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_rental_token()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_year text := TO_CHAR(NOW() AT TIME ZONE 'Asia/Kolkata', 'YYYY');
  v_prefix text;
  v_seq bigint;
BEGIN
  SELECT token_prefix INTO v_prefix FROM public.shops WHERE id = NEW.shop_id;
  v_seq := public.next_shop_counter(NEW.shop_id, 'rental', v_year);
  NEW.token := v_prefix || '-' || v_year || '-' || lpad(v_seq::text, GREATEST(4, length(v_seq::text)), '0');
  RETURN NEW;
END;
$$;

DROP SEQUENCE IF EXISTS public.booking_reference_seq;

-- ==============================================================================
-- 9. Ledger and audit triggers carry the shop of the row they record
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.ledger_on_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.advance, 0) > 0 THEN
      INSERT INTO public.ledger_entries (shop_id, entry_date, kind, amount, method, branch_id, booking_id, created_by)
      VALUES (NEW.shop_id, now(), 'advance_in', NEW.advance, NEW.advance_payment_method, NEW.branch_id, NEW.id, NEW.created_by);
    END IF;
    IF COALESCE(NEW.security_deposit, 0) > 0 THEN
      INSERT INTO public.ledger_entries (shop_id, entry_date, kind, amount, method, branch_id, booking_id, created_by)
      VALUES (NEW.shop_id, now(), 'deposit_in', NEW.security_deposit, NEW.security_deposit_payment_method, NEW.branch_id, NEW.id, NEW.created_by);
    END IF;
  ELSIF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    IF COALESCE(NEW.advance_refund, 0) > 0 THEN
      INSERT INTO public.ledger_entries (shop_id, entry_date, kind, amount, method, branch_id, booking_id, created_by)
      VALUES (NEW.shop_id, COALESCE(NEW.cancelled_at, now()), 'advance_refund_out', NEW.advance_refund, NEW.refund_payment_method, NEW.branch_id, NEW.id, NEW.cancelled_by);
    END IF;
    IF COALESCE(NEW.security_deposit_refund, 0) > 0 THEN
      INSERT INTO public.ledger_entries (shop_id, entry_date, kind, amount, method, branch_id, booking_id, created_by)
      VALUES (NEW.shop_id, COALESCE(NEW.cancelled_at, now()), 'deposit_refund_out', NEW.security_deposit_refund, NEW.refund_payment_method, NEW.branch_id, NEW.id, NEW.cancelled_by);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ledger_on_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_branch uuid;
  v_diff numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT branch_id INTO v_branch FROM public.rentals WHERE id = NEW.rental_id;
    INSERT INTO public.ledger_entries (shop_id, entry_date, kind, amount, method, branch_id, rental_id, payment_id, created_by)
    VALUES (NEW.shop_id, NEW.paid_at, 'payment_in', NEW.amount, NEW.method, v_branch, NEW.rental_id, NEW.id, NEW.recorded_by);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    v_diff := NEW.amount - OLD.amount;
    IF v_diff <> 0 THEN
      SELECT branch_id INTO v_branch FROM public.rentals WHERE id = NEW.rental_id;
      INSERT INTO public.ledger_entries (shop_id, entry_date, kind, amount, method, branch_id, rental_id, note, created_by)
      VALUES (NEW.shop_id, now(), CASE WHEN v_diff > 0 THEN 'adjustment_in' ELSE 'adjustment_out' END, abs(v_diff), NEW.method,
              v_branch, NEW.rental_id, 'payment ' || NEW.id || ' amount ' || OLD.amount || ' -> ' || NEW.amount, auth.uid());
    END IF;
    RETURN NEW;
  ELSE -- DELETE
    SELECT branch_id INTO v_branch FROM public.rentals WHERE id = OLD.rental_id;
    INSERT INTO public.ledger_entries (shop_id, entry_date, kind, amount, method, branch_id, rental_id, note, created_by)
    VALUES (OLD.shop_id, now(), 'adjustment_out', OLD.amount, OLD.method, v_branch, OLD.rental_id,
            'payment ' || OLD.id || ' deleted', auth.uid());
    RETURN OLD;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.ledger_on_rental_return()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.status = 'returned' AND OLD.status IS DISTINCT FROM 'returned' THEN
    IF COALESCE(NEW.deposit_deducted, 0) > 0 THEN
      INSERT INTO public.ledger_entries (shop_id, entry_date, kind, amount, branch_id, rental_id)
      VALUES (NEW.shop_id, now(), 'deposit_retained', NEW.deposit_deducted, NEW.branch_id, NEW.id);
    END IF;
    IF COALESCE(NEW.deposit_refunded, 0) > 0 THEN
      INSERT INTO public.ledger_entries (shop_id, entry_date, kind, amount, method, branch_id, rental_id)
      VALUES (NEW.shop_id, now(), 'deposit_refund_out', NEW.deposit_refunded, NEW.deposit_refund_method, NEW.branch_id, NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_record_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  INSERT INTO public.audit_log (shop_id, performed_by, via, action, table_name, record_id, reason, old_data)
  VALUES (
    OLD.shop_id,
    auth.uid(),
    CASE WHEN auth.uid() IS NULL THEN 'sql' ELSE 'app' END,
    'delete',
    TG_TABLE_NAME,
    OLD.id,
    NULLIF(current_setting('app.audit_reason', true), ''),
    to_jsonb(OLD)
  );
  RETURN OLD;
END;
$$;

-- shop_id and active_shop_id join the fields only a super_admin may change directly
CREATE OR REPLACE FUNCTION public.guard_profile_direct_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated')
     AND public.get_my_role() IS DISTINCT FROM 'super_admin'
     AND (
          NEW.id IS DISTINCT FROM OLD.id
       OR NEW.role IS DISTINCT FROM OLD.role
       OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
       OR NEW.is_active IS DISTINCT FROM OLD.is_active
       OR NEW.shop_id IS DISTINCT FROM OLD.shop_id
       OR NEW.active_shop_id IS DISTINCT FROM OLD.active_shop_id
     )
  THEN
    RAISE EXCEPTION 'Only Zypher can change a profile''s role, branch, shop or active status directly';
  END IF;
  RETURN NEW;
END;
$$;

-- ==============================================================================
-- 10. Staff management inside a shop (owner or Zypher)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.get_staff_emails()
RETURNS TABLE (id uuid, email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
BEGIN
  IF public.get_my_role() IS DISTINCT FROM 'super_admin' AND public.get_my_role() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Unauthorized: only the shop owner can see staff emails';
  END IF;

  RETURN QUERY
  SELECT u.id, u.email::text
  FROM auth.users u
  JOIN public.profiles p ON p.id = u.id
  WHERE p.shop_id = public.current_shop_id();
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_staff_status(p_user_id uuid, p_is_active boolean, p_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_role text := public.get_my_role();
  v_shop uuid := public.current_shop_id();
  v_target RECORD;
  v_owners integer;
BEGIN
  IF v_role IS DISTINCT FROM 'super_admin' AND v_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Unauthorized: only the shop owner can change staff';
  END IF;

  IF v_shop IS NULL THEN
    RAISE EXCEPTION 'No shop selected';
  END IF;

  -- super_admin is Zypher's role and is never given from inside a shop
  IF p_is_active IS NULL OR p_role IS NULL OR p_role NOT IN ('owner', 'manager', 'staff') THEN
    RAISE EXCEPTION 'Invalid role or status';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot change your own role or active status';
  END IF;

  -- lock the shop's owners so two changes cannot both pass the last-owner check
  PERFORM 1 FROM public.profiles WHERE shop_id = v_shop AND role = 'owner' AND is_active FOR UPDATE;

  SELECT * INTO v_target FROM public.profiles WHERE id = p_user_id AND shop_id = v_shop;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff member not found in this shop';
  END IF;

  UPDATE public.profiles SET is_active = p_is_active, role = p_role WHERE id = p_user_id;

  SELECT count(*) INTO v_owners FROM public.profiles WHERE shop_id = v_shop AND role = 'owner' AND is_active;
  IF v_owners < 1 THEN
    RAISE EXCEPTION 'At least one active owner must remain in the shop';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_staff_branch(p_user_id uuid, p_branch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_role text := public.get_my_role();
  v_shop uuid := public.current_shop_id();
BEGIN
  IF v_role IS DISTINCT FROM 'super_admin' AND v_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Unauthorized: only the shop owner can change staff branches';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND shop_id = v_shop) THEN
    RAISE EXCEPTION 'Staff member not found in this shop';
  END IF;

  IF p_branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id AND shop_id = v_shop) THEN
    RAISE EXCEPTION 'Branch not found in this shop';
  END IF;

  UPDATE public.profiles SET branch_id = p_branch_id WHERE id = p_user_id;
END;
$$;

-- ==============================================================================
-- 11. Plan limits (Starter: 1 branch, 3 logins; Pro: 3 branches; Business: no limits)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.plan_limit(p_plan text, p_kind text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_kind = 'branches' AND p_plan = 'starter' THEN 1
    WHEN p_kind = 'branches' AND p_plan = 'pro' THEN 3
    WHEN p_kind = 'logins' AND p_plan = 'starter' THEN 3
    ELSE NULL END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_branch_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_plan text;
  v_limit integer;
  v_count integer;
BEGIN
  IF NEW.is_active IS NOT TRUE OR (TG_OP = 'UPDATE' AND OLD.is_active IS TRUE) THEN
    RETURN NEW;
  END IF;
  SELECT plan INTO v_plan FROM public.shops WHERE id = NEW.shop_id FOR UPDATE;
  v_limit := public.plan_limit(v_plan, 'branches');
  IF v_limit IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO v_count FROM public.branches WHERE shop_id = NEW.shop_id AND is_active AND id <> NEW.id;
  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'Your % plan allows % active branch(es). Contact Zypher to upgrade.', initcap(v_plan), v_limit;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_branch_limit
  BEFORE INSERT OR UPDATE OF is_active ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.enforce_branch_limit();

CREATE OR REPLACE FUNCTION public.enforce_login_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_plan text;
  v_limit integer;
  v_count integer;
BEGIN
  IF NEW.is_active IS NOT TRUE OR NEW.shop_id IS NULL
     OR (TG_OP = 'UPDATE' AND OLD.is_active IS TRUE AND OLD.shop_id IS NOT DISTINCT FROM NEW.shop_id) THEN
    RETURN NEW;
  END IF;
  SELECT plan INTO v_plan FROM public.shops WHERE id = NEW.shop_id FOR UPDATE;
  v_limit := public.plan_limit(v_plan, 'logins');
  IF v_limit IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO v_count FROM public.profiles WHERE shop_id = NEW.shop_id AND is_active AND id <> NEW.id;
  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'Your % plan allows % staff logins. Contact Zypher to upgrade.', initcap(v_plan), v_limit;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_login_limit
  BEFORE INSERT OR UPDATE OF is_active, shop_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_login_limit();

-- ==============================================================================
-- 12. Zypher console functions (super_admin only)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.create_shop(
  p_name text, p_slug text, p_token_prefix text, p_plan text, p_branch_name text,
  p_phone text DEFAULT NULL, p_address text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_shop uuid;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Only Zypher can create shops';
  END IF;
  IF p_branch_name IS NULL OR btrim(p_branch_name) = '' THEN
    RAISE EXCEPTION 'The first branch needs a name';
  END IF;

  INSERT INTO public.shops (name, slug, token_prefix, plan, phone, address)
  VALUES (btrim(p_name), lower(btrim(p_slug)), upper(btrim(p_token_prefix)), p_plan, p_phone, p_address)
  RETURNING id INTO v_shop;

  INSERT INTO public.branches (shop_id, name, slug, phone, address, is_active)
  VALUES (v_shop, btrim(p_branch_name), lower(regexp_replace(btrim(p_branch_name), '[^a-zA-Z0-9]+', '-', 'g')), p_phone, p_address, true);

  RETURN v_shop;
END;
$$;

CREATE OR REPLACE FUNCTION public.switch_shop(p_shop_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Only Zypher can switch shops';
  END IF;
  IF p_shop_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.shops WHERE id = p_shop_id) THEN
    RAISE EXCEPTION 'Shop not found';
  END IF;
  UPDATE public.profiles SET active_shop_id = p_shop_id WHERE id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.set_shop_plan(p_shop_id uuid, p_plan text, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_branches integer;
  v_logins integer;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Only Zypher can change a shop''s plan';
  END IF;

  SELECT count(*) INTO v_branches FROM public.branches WHERE shop_id = p_shop_id AND is_active;
  SELECT count(*) INTO v_logins FROM public.profiles WHERE shop_id = p_shop_id AND is_active;

  IF public.plan_limit(p_plan, 'branches') < v_branches THEN
    RAISE EXCEPTION 'The shop has % active branches; the % plan allows %. Deactivate branches first.', v_branches, p_plan, public.plan_limit(p_plan, 'branches');
  END IF;
  IF public.plan_limit(p_plan, 'logins') < v_logins THEN
    RAISE EXCEPTION 'The shop has % active logins; the % plan allows %. Deactivate staff first.', v_logins, p_plan, public.plan_limit(p_plan, 'logins');
  END IF;

  UPDATE public.shops SET plan = p_plan, status = p_status WHERE id = p_shop_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shop not found';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_shop_payment(
  p_shop_id uuid, p_amount numeric, p_paid_on date, p_period_to date, p_method text DEFAULT 'bank_transfer', p_note text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Only Zypher can record shop payments';
  END IF;

  INSERT INTO public.shop_payments (shop_id, amount, paid_on, method, period_to, note, recorded_by)
  VALUES (p_shop_id, p_amount, p_paid_on, p_method, p_period_to, p_note, auth.uid());

  UPDATE public.shops SET paid_until = GREATEST(COALESCE(paid_until, p_period_to), p_period_to) WHERE id = p_shop_id;
END;
$$;

-- ==============================================================================
-- 13. Product photos: each shop writes only inside its own folder (<shop_id>/<file>)
-- ==============================================================================
DROP POLICY IF EXISTS product_images_insert ON storage.objects;
DROP POLICY IF EXISTS product_images_delete ON storage.objects;
CREATE POLICY product_images_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product_images'
              AND (storage.foldername(name))[1] = public.current_shop_id()::text
              AND public.get_my_role() IN ('super_admin', 'owner', 'manager'));
CREATE POLICY product_images_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'product_images'
         AND (storage.foldername(name))[1] = public.current_shop_id()::text
         AND public.get_my_role() IN ('super_admin', 'owner', 'manager'));

-- ==============================================================================
-- 14. Grants: logged-in users only; trigger and internal functions not callable from the API
-- ==============================================================================
REVOKE ALL ON FUNCTION public.my_home_shop_id(), public.is_platform_admin(), public.current_shop_id(),
  public.get_staff_emails(), public.admin_set_staff_status(uuid, boolean, text), public.set_staff_branch(uuid, uuid),
  public.create_shop(text, text, text, text, text, text, text), public.switch_shop(uuid),
  public.set_shop_plan(uuid, text, text), public.record_shop_payment(uuid, numeric, date, date, text, text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_home_shop_id(), public.is_platform_admin(), public.current_shop_id(),
  public.get_staff_emails(), public.admin_set_staff_status(uuid, boolean, text), public.set_staff_branch(uuid, uuid),
  public.create_shop(text, text, text, text, text, text, text), public.switch_shop(uuid),
  public.set_shop_plan(uuid, text, text), public.record_shop_payment(uuid, numeric, date, date, text, text)
TO authenticated;

REVOKE EXECUTE ON FUNCTION public.assign_booking_reference(), public.generate_rental_token(),
  public.enforce_branch_limit(), public.enforce_login_limit(), public._reverse_ledger_for(uuid, uuid, text)
FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
