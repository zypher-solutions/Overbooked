-- Baseline schema for Overbooked.
--
-- The original TRENDZ base tables were created in the Supabase dashboard and never committed, so the
-- later migrations only ALTER them. This file rebuilds that starting point from:
--   * the columns the app reads and writes (src/lib/overbooked/store.tsx, availability.ts, pages/*)
--   * the columns and helper functions the later migrations reference
-- Columns that a later migration adds (bookings cancellation fields, rentals deposit_* / discount /
-- booking_id, ...) are deliberately NOT created here so every migration applies as written.
-- It was not taken from any live database.

-- ==============================================================================
-- 1. Tables
-- ==============================================================================

CREATE TABLE public.branches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  slug        text NOT NULL UNIQUE,
  address     text,
  phone       text,
  email       text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   text,
  role        text NOT NULL DEFAULT 'staff',
  branch_id   uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_role_check CHECK (role IN ('super_admin', 'owner', 'manager', 'staff'))
);

CREATE TABLE public.customers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name   text NOT NULL,
  phone       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_customers_phone ON public.customers (phone);

CREATE TABLE public.categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  base_sku    text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX categories_name_lower_key ON public.categories (lower(name));

CREATE TABLE public.products (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  sku             text NOT NULL UNIQUE,
  description     text,
  image_url       text,
  category_id     uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  purchase_price  numeric(14,2) NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
  attributes      jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.product_variations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  name        text NOT NULL,
  sku         text NOT NULL UNIQUE,
  daily_rate  numeric(14,2) NOT NULL DEFAULT 0 CHECK (daily_rate >= 0),
  is_enabled  boolean NOT NULL DEFAULT true,
  attributes  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- quantity = total physical units of a variation at a branch (status lives on inventory_items)
CREATE TABLE public.product_stock (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    uuid NOT NULL REFERENCES public.products(id),
  variation_id  uuid NOT NULL REFERENCES public.product_variations(id),
  branch_id     uuid NOT NULL REFERENCES public.branches(id),
  quantity      integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  CONSTRAINT product_stock_variation_branch_key UNIQUE (variation_id, branch_id)
);

-- one row per physical unit
CREATE TABLE public.inventory_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    uuid NOT NULL REFERENCES public.products(id),
  variation_id  uuid NOT NULL REFERENCES public.product_variations(id),
  branch_id     uuid NOT NULL REFERENCES public.branches(id),
  item_sku      text NOT NULL UNIQUE,
  status        text NOT NULL DEFAULT 'available'
                CHECK (status IN ('available', 'rented', 'maintenance', 'lost')),
  qr_token      text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_inventory_items_variation_branch ON public.inventory_items (variation_id, branch_id);

CREATE TABLE public.bookings (
  id                               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token                            text,
  customer_id                      uuid NOT NULL REFERENCES public.customers(id),
  branch_id                        uuid NOT NULL REFERENCES public.branches(id),
  booking_date                     date NOT NULL DEFAULT CURRENT_DATE,
  status                           text NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed')),
  notes                            text,
  created_by                       uuid REFERENCES public.profiles(id),
  total                            numeric NOT NULL DEFAULT 0 CHECK (total >= 0),
  advance                          numeric NOT NULL DEFAULT 0 CHECK (advance >= 0),
  security_deposit                 numeric NOT NULL DEFAULT 0 CHECK (security_deposit >= 0),
  advance_payment_method           text CHECK (advance_payment_method IS NULL OR advance_payment_method IN ('cash', 'upi', 'card', 'bank_transfer')),
  security_deposit_payment_method  text CHECK (security_deposit_payment_method IS NULL OR security_deposit_payment_method IN ('cash', 'upi', 'card', 'bank_transfer')),
  created_at                       timestamptz NOT NULL DEFAULT now(),
  updated_at                       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bookings_branch_id ON public.bookings (branch_id);
CREATE INDEX idx_bookings_customer_id ON public.bookings (customer_id);

CREATE TABLE public.booking_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid NOT NULL REFERENCES public.bookings(id),
  product_id    uuid REFERENCES public.products(id),
  variation_id  uuid REFERENCES public.product_variations(id),
  product_name  text NOT NULL,
  sku           text,
  image_url     text,
  qty           integer NOT NULL CHECK (qty > 0),
  daily_rate    numeric(14,2) NOT NULL CHECK (daily_rate >= 0),
  pickup_date   date NOT NULL,
  return_date   date NOT NULL,
  buffer_days   integer NOT NULL DEFAULT 0 CHECK (buffer_days >= 0),
  subtotal      numeric(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_items_dates_check CHECK (return_date >= pickup_date)
);
CREATE INDEX idx_booking_items_booking_id ON public.booking_items (booking_id);
CREATE INDEX idx_booking_items_variation_id ON public.booking_items (variation_id);

CREATE TABLE public.booking_item_inventory (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_item_id    uuid NOT NULL REFERENCES public.booking_items(id),
  inventory_item_id  uuid NOT NULL REFERENCES public.inventory_items(id),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bii_booking_item_id ON public.booking_item_inventory (booking_item_id);
CREATE INDEX idx_bii_inventory_item_id ON public.booking_item_inventory (inventory_item_id);

CREATE TABLE public.rentals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token              text UNIQUE,
  customer_id        uuid NOT NULL REFERENCES public.customers(id),
  branch_id          uuid NOT NULL REFERENCES public.branches(id),
  staff_id           uuid REFERENCES public.profiles(id),
  rent_date          date NOT NULL,
  actual_pickup_at   timestamptz,
  due_date           date NOT NULL,
  buffer_days        integer NOT NULL DEFAULT 0 CHECK (buffer_days >= 0),
  total              numeric NOT NULL DEFAULT 0 CHECK (total >= 0),
  advance            numeric NOT NULL DEFAULT 0 CHECK (advance >= 0),
  security_deposit   numeric NOT NULL DEFAULT 0 CHECK (security_deposit >= 0),
  payment_status     text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'partial', 'paid')),
  status             text NOT NULL DEFAULT 'out' CHECK (status IN ('out', 'returned')),
  returned_on        date,
  condition          text CHECK (condition IS NULL OR condition IN ('good', 'damaged', 'lost')),
  extra_fees         numeric NOT NULL DEFAULT 0 CHECK (extra_fees >= 0),
  extra_fees_reason  text,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rentals_dates_check CHECK (due_date >= rent_date),
  CONSTRAINT rentals_returned_on_check CHECK (returned_on IS NULL OR returned_on >= rent_date)
);
CREATE INDEX idx_rentals_branch_id ON public.rentals (branch_id);
CREATE INDEX idx_rentals_customer_id ON public.rentals (customer_id);

CREATE TABLE public.rental_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id     uuid NOT NULL REFERENCES public.rentals(id),
  product_id    uuid REFERENCES public.products(id),
  variation_id  uuid REFERENCES public.product_variations(id),
  product_name  text NOT NULL,
  sku           text,
  image_url     text,
  qty           integer NOT NULL CHECK (qty > 0),
  daily_rate    numeric(14,2) NOT NULL CHECK (daily_rate >= 0),
  days          integer NOT NULL DEFAULT 1 CHECK (days >= 0),
  subtotal      numeric(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.rental_item_inventory (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_item_id     uuid NOT NULL REFERENCES public.rental_items(id),
  inventory_item_id  uuid NOT NULL REFERENCES public.inventory_items(id),
  condition          text CHECK (condition IS NULL OR condition IN ('good', 'damaged', 'lost')),
  return_notes       text,
  returned_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rental_item_inventory_unique UNIQUE (rental_item_id, inventory_item_id)
);
CREATE INDEX idx_rii_inventory_item_id ON public.rental_item_inventory (inventory_item_id);

CREATE TABLE public.payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id    uuid NOT NULL REFERENCES public.rentals(id),
  amount       numeric(10,2) NOT NULL CHECK (amount > 0),
  method       text NOT NULL CHECK (method IN ('cash', 'upi', 'card', 'bank_transfer')),
  paid_at      timestamptz NOT NULL DEFAULT now(),
  recorded_by  uuid REFERENCES public.profiles(id),
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ==============================================================================
-- 2. RLS helper functions (later migrations replace these with the hardened versions)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.get_my_branch()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT branch_id FROM public.profiles WHERE id = auth.uid();
$$;

-- ==============================================================================
-- 3. Trigger functions that the later migrations expect to exist
-- ==============================================================================

-- every auth user gets a profile (20261018000011 replaces this with the inactive-by-default version)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- rental token TRZ-<year>-<n> (20261018000003 replaces the body with the race-safe version)
CREATE OR REPLACE FUNCTION public.generate_rental_token()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  year_part TEXT := TO_CHAR(NOW() AT TIME ZONE 'Asia/Kolkata', 'YYYY');
  seq       INT;
BEGIN
  SELECT COALESCE(MAX(CAST(SPLIT_PART(token, '-', 3) AS INT)), 0) + 1
    INTO seq
    FROM public.rentals
   WHERE token ~ ('^TRZ-' || year_part || '-[0-9]+$');

  NEW.token := 'TRZ-' || year_part || '-' || LPAD(seq::TEXT, 4, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_rental_token
  BEFORE INSERT ON public.rentals
  FOR EACH ROW EXECUTE FUNCTION public.generate_rental_token();

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_booking_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_products_updated_at BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER trg_rentals_updated_at BEFORE UPDATE ON public.rentals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER trg_bookings_updated_at BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.set_booking_updated_at();

-- Legacy TRENDZ functions that 20261018000011 revokes / pins. Stock is derived from inventory_items
-- status, so these are inert placeholders and are NOT attached to any table.
CREATE OR REPLACE FUNCTION public.guard_inventory_direct_update()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.deduct_stock_on_rental()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.restore_stock_on_return()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.return_rental_atomic(p_rental_id uuid, p_items jsonb, p_returned_on date)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'return_rental_atomic is retired; use mark_returned_atomic';
END;
$$;

-- ==============================================================================
-- 4. Availability RPCs (granted by 20261016000000; the app currently computes this in availability.ts)
-- ==============================================================================

-- units of a variation at a branch that are free for [pickup, return + buffer]
CREATE OR REPLACE FUNCTION public.get_eligible_physical_units(
  p_branch_id uuid,
  p_variation_id uuid,
  p_pickup_date date,
  p_return_date date,
  p_buffer_days integer DEFAULT 0
) RETURNS TABLE (id uuid, item_sku text, status text)
LANGUAGE sql
STABLE
AS $$
  SELECT ii.id, ii.item_sku, ii.status
  FROM public.inventory_items ii
  WHERE ii.variation_id = p_variation_id
    AND ii.branch_id = p_branch_id
    AND ii.status NOT IN ('lost', 'maintenance')
    AND NOT EXISTS (
      SELECT 1
      FROM public.booking_item_inventory bii
      JOIN public.booking_items bi ON bi.id = bii.booking_item_id
      JOIN public.bookings b ON b.id = bi.booking_id
      WHERE bii.inventory_item_id = ii.id
        AND b.status IN ('pending', 'confirmed')
        AND bi.pickup_date <= p_return_date + COALESCE(p_buffer_days, 0)
        AND bi.return_date + bi.buffer_days >= p_pickup_date
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.rental_item_inventory rii
      JOIN public.rental_items ri ON ri.id = rii.rental_item_id
      JOIN public.rentals r ON r.id = ri.rental_id
      WHERE rii.inventory_item_id = ii.id
        AND r.status = 'out'
        AND r.rent_date <= p_return_date + COALESCE(p_buffer_days, 0)
        AND GREATEST(r.due_date, CURRENT_DATE) + r.buffer_days >= p_pickup_date
    )
  ORDER BY ii.item_sku;
$$;

CREATE OR REPLACE FUNCTION public.check_availability(
  p_branch_id uuid,
  p_variation_id uuid,
  p_pickup_date date,
  p_return_date date,
  p_buffer_days integer DEFAULT 0
) RETURNS TABLE (
  total_capacity bigint,
  unavailable_maintenance bigint,
  unavailable_booking bigint,
  available_capacity bigint
)
LANGUAGE sql
STABLE
AS $$
  WITH cap AS (
    SELECT COUNT(*) FILTER (WHERE status <> 'lost') AS total,
           COUNT(*) FILTER (WHERE status = 'maintenance') AS maint
    FROM public.inventory_items
    WHERE variation_id = p_variation_id AND branch_id = p_branch_id
  ), free AS (
    SELECT COUNT(*) AS n
    FROM public.get_eligible_physical_units(p_branch_id, p_variation_id, p_pickup_date, p_return_date, p_buffer_days)
  )
  SELECT cap.total, cap.maint, GREATEST(0, cap.total - cap.maint - free.n), free.n
  FROM cap, free;
$$;

-- ==============================================================================
-- 5. Row level security for the tables whose policies no migration creates
--    (product_stock, inventory_items, bookings*, rentals*, payments get theirs in 20260923000000)
-- ==============================================================================

ALTER TABLE public.branches               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_stock          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_item_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rentals                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_items           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_item_inventory  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments               ENABLE ROW LEVEL SECURITY;

-- profiles: everyone reads their own row (20261018000011 recreates read_own_profile); super_admin manages all
CREATE POLICY read_own_profile ON public.profiles FOR SELECT
  USING (id = auth.uid() OR public.get_my_role() IN ('super_admin', 'owner'));
CREATE POLICY super_admin_profiles ON public.profiles FOR ALL
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

-- branches: any active user reads; owner/super_admin manage
CREATE POLICY branches_read ON public.branches FOR SELECT
  USING (public.get_my_role() IS NOT NULL);
CREATE POLICY branches_write ON public.branches FOR ALL
  USING (public.get_my_role() IN ('super_admin', 'owner'))
  WITH CHECK (public.get_my_role() IN ('super_admin', 'owner'));

-- customers: any active user reads and adds; no deletes through the API
CREATE POLICY read_customers ON public.customers FOR SELECT
  USING (public.get_my_role() IS NOT NULL);
CREATE POLICY insert_customers ON public.customers FOR INSERT
  WITH CHECK (public.get_my_role() IS NOT NULL);
CREATE POLICY update_customers ON public.customers FOR UPDATE
  USING (public.get_my_role() IS NOT NULL)
  WITH CHECK (public.get_my_role() IS NOT NULL);

-- catalog: any active user reads; owner/super_admin manage; managers insert (20260923000000) and update
CREATE POLICY cat_read ON public.categories FOR SELECT USING (public.get_my_role() IS NOT NULL);
CREATE POLICY cat_boss ON public.categories FOR ALL
  USING (public.get_my_role() IN ('super_admin', 'owner'))
  WITH CHECK (public.get_my_role() IN ('super_admin', 'owner'));

CREATE POLICY prod_read ON public.products FOR SELECT USING (public.get_my_role() IS NOT NULL);
CREATE POLICY prod_boss ON public.products FOR ALL
  USING (public.get_my_role() IN ('super_admin', 'owner'))
  WITH CHECK (public.get_my_role() IN ('super_admin', 'owner'));
CREATE POLICY prod_mgr_update ON public.products FOR UPDATE
  USING (public.get_my_role() = 'manager') WITH CHECK (public.get_my_role() = 'manager');

CREATE POLICY var_read ON public.product_variations FOR SELECT USING (public.get_my_role() IS NOT NULL);
CREATE POLICY var_boss ON public.product_variations FOR ALL
  USING (public.get_my_role() IN ('super_admin', 'owner'))
  WITH CHECK (public.get_my_role() IN ('super_admin', 'owner'));
CREATE POLICY var_mgr_update ON public.product_variations FOR UPDATE
  USING (public.get_my_role() = 'manager') WITH CHECK (public.get_my_role() = 'manager');

-- ==============================================================================
-- 6. Realtime (store.tsx subscribes to these tables)
-- ==============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE
      public.rentals, public.rental_items, public.payments, public.bookings,
      public.product_stock, public.inventory_items;
  END IF;
END $$;

-- ==============================================================================
-- 7. Storage bucket for product photos (AddProduct.tsx)
-- ==============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('product_images', 'product_images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY product_images_read ON storage.objects FOR SELECT
  USING (bucket_id = 'product_images');
CREATE POLICY product_images_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product_images' AND public.get_my_role() IN ('super_admin', 'owner', 'manager'));
CREATE POLICY product_images_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'product_images' AND public.get_my_role() IN ('super_admin', 'owner', 'manager'));
