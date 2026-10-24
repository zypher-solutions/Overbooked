-- Overbooked v2 — catalog: what a shop rents out.
--
--   category (has a business template: bridal, resort, car ...)
--     └ product            "Bridal lehenga", "Deluxe cottage", "Honda City"
--         └ variation      a size/colour, a room type, a model — has its own rates
--             └ unit       one physical thing: a dress piece, room 104, KL-07-AB-1234
-- Sets (optional feature): a product that rents several variations together (dress + jewellery).

CREATE TABLE public.categories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       uuid NOT NULL REFERENCES public.shops(id),
  name          text NOT NULL CHECK (btrim(name) <> ''),
  template_key  text NOT NULL REFERENCES public.business_templates(key),
  sku_prefix    text CHECK (sku_prefix ~ '^[A-Z]{2,6}$'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT categories_shop_id_id_key UNIQUE (shop_id, id)
);
CREATE UNIQUE INDEX categories_shop_name_key ON public.categories (shop_id, lower(name));

CREATE TABLE public.products (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id            uuid NOT NULL REFERENCES public.shops(id),
  category_id        uuid NOT NULL,
  name               text NOT NULL CHECK (btrim(name) <> ''),
  sku                text NOT NULL CHECK (sku ~ '^[A-Z0-9][A-Z0-9-]{1,39}$'),
  description        text,
  image_url          text,
  purchase_price     numeric(14,2) NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
  replacement_value  numeric(14,2) NOT NULL DEFAULT 0 CHECK (replacement_value >= 0),  -- charged if a unit is lost
  is_set             boolean NOT NULL DEFAULT false,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_shop_id_id_key UNIQUE (shop_id, id),
  CONSTRAINT products_shop_sku_key UNIQUE (shop_id, sku),
  CONSTRAINT products_shop_category_fkey FOREIGN KEY (shop_id, category_id) REFERENCES public.categories (shop_id, id)
);
CREATE INDEX idx_products_shop_name ON public.products (shop_id, name);
CREATE INDEX idx_products_category ON public.products (shop_id, category_id);

CREATE TABLE public.product_variations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id             uuid NOT NULL REFERENCES public.shops(id),
  product_id          uuid NOT NULL,
  name                text NOT NULL CHECK (btrim(name) <> ''),
  sku                 text NOT NULL CHECK (sku ~ '^[A-Z0-9][A-Z0-9-]{1,59}$'),
  attributes          jsonb NOT NULL DEFAULT '{}',   -- the template's variation fields: size, colour, model, room type ...
  base_occupancy      integer CHECK (base_occupancy > 0),        -- rooms: guests included in the night rate
  max_occupancy       integer CHECK (max_occupancy > 0),         -- rooms: most guests allowed
  km_included_per_day integer CHECK (km_included_per_day >= 0),  -- vehicles: free km per day
  turnaround          interval NOT NULL DEFAULT '0' CHECK (turnaround >= '0'),  -- gap after each rental
  is_enabled          boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_variations_shop_id_id_key UNIQUE (shop_id, id),
  CONSTRAINT product_variations_shop_sku_key UNIQUE (shop_id, sku),
  CONSTRAINT product_variations_shop_product_fkey FOREIGN KEY (shop_id, product_id) REFERENCES public.products (shop_id, id),
  CONSTRAINT product_variations_occupancy_check CHECK (base_occupancy IS NULL OR max_occupancy IS NULL OR max_occupancy >= base_occupancy)
);
CREATE INDEX idx_product_variations_product ON public.product_variations (shop_id, product_id);

-- one price per rate type; prices are a starting point, staff may negotiate per rental
CREATE TABLE public.variation_rates (
  shop_id       uuid NOT NULL REFERENCES public.shops(id),
  variation_id  uuid NOT NULL,
  rate_type     text NOT NULL CHECK (rate_type IN (
                  'hour',          -- per started hour (vehicles)
                  'day',           -- per day / 24 h
                  'night',         -- per night (rooms)
                  'extra_km',      -- per km above the daily allowance
                  'extra_hour',    -- per hour returned late
                  'extra_person',  -- per guest above base occupancy, per night
                  'driver_day',    -- driver per day
                  'late_penalty')),-- flat amount once when returned late
  amount        numeric(14,2) NOT NULL CHECK (amount >= 0),
  PRIMARY KEY (variation_id, rate_type),
  CONSTRAINT variation_rates_shop_variation_fkey FOREIGN KEY (shop_id, variation_id)
    REFERENCES public.product_variations (shop_id, id) ON DELETE CASCADE
);

-- one physical thing that is rented: a dress piece, a room, a vehicle
CREATE TABLE public.units (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id        uuid NOT NULL REFERENCES public.shops(id),
  product_id     uuid NOT NULL,
  variation_id   uuid NOT NULL,
  branch_id      uuid NOT NULL,
  code           text NOT NULL CHECK (btrim(code) <> ''),  -- unit SKU, room number or registration number
  -- out-on-rent is not stored: it comes from the unit's active reservation
  status         text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'maintenance', 'lost', 'retired')),
  status_reason  text,      -- e.g. "alteration", "dry cleaning", "service", "damaged"
  attributes     jsonb NOT NULL DEFAULT '{}',  -- the template's unit fields
  odometer       integer CHECK (odometer >= 0),  -- vehicles: last known reading
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT units_shop_id_id_key UNIQUE (shop_id, id),
  CONSTRAINT units_shop_code_key UNIQUE (shop_id, code),
  CONSTRAINT units_shop_product_fkey FOREIGN KEY (shop_id, product_id) REFERENCES public.products (shop_id, id),
  CONSTRAINT units_shop_variation_fkey FOREIGN KEY (shop_id, variation_id) REFERENCES public.product_variations (shop_id, id),
  CONSTRAINT units_shop_branch_fkey FOREIGN KEY (shop_id, branch_id) REFERENCES public.branches (shop_id, id)
);
CREATE INDEX idx_units_variation_branch ON public.units (shop_id, variation_id, branch_id);
CREATE INDEX idx_units_branch ON public.units (shop_id, branch_id);

-- sets (optional): a set product rents these variations together, each as its own unit
CREATE TABLE public.set_items (
  shop_id         uuid NOT NULL REFERENCES public.shops(id),
  set_product_id  uuid NOT NULL,
  variation_id    uuid NOT NULL,
  qty             integer NOT NULL DEFAULT 1 CHECK (qty > 0),
  PRIMARY KEY (set_product_id, variation_id),
  CONSTRAINT set_items_shop_set_fkey FOREIGN KEY (shop_id, set_product_id) REFERENCES public.products (shop_id, id) ON DELETE CASCADE,
  CONSTRAINT set_items_shop_variation_fkey FOREIGN KEY (shop_id, variation_id) REFERENCES public.product_variations (shop_id, id)
);

-- extras sold with a rental: meal plans, extra bed, helmet, child seat, delivery ...
CREATE TABLE public.add_ons (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     uuid NOT NULL REFERENCES public.shops(id),
  name        text NOT NULL CHECK (btrim(name) <> ''),
  basis       text NOT NULL CHECK (basis IN (
                'per_rental',         -- once
                'per_day',            -- each day (or night) of the rental
                'per_unit_day',       -- each unit, each day/night (extra bed per room)
                'per_person_night')), -- each guest, each night (meal plans)
  amount      numeric(14,2) NOT NULL CHECK (amount >= 0),
  template_keys text[] NOT NULL DEFAULT '{}',  -- business types it is offered for; empty = all
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT add_ons_shop_id_id_key UNIQUE (shop_id, id),
  CONSTRAINT add_ons_shop_name_key UNIQUE (shop_id, name)
);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER trg_products_updated_at BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
