-- Overbooked v2 — customers and rentals.
--
-- One rental record goes reserved -> active (picked up / checked in) -> completed (returned / checked out),
-- or cancelled / no_show. Its money columns are kept in step with its lines, add-ons, charges and payments
-- by triggers, so total, paid and balance always equal the records under them.

CREATE TABLE public.customers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid NOT NULL REFERENCES public.shops(id),
  full_name       text NOT NULL CHECK (btrim(full_name) <> ''),
  phone           text NOT NULL CHECK (btrim(phone) <> ''),
  email           text,
  address         text,
  id_type         text CHECK (id_type IN ('aadhaar', 'driving_licence', 'passport', 'voter_id', 'pan', 'other')),
  id_number       text,
  licence_number  text,          -- vehicles
  licence_expiry  date,
  is_blocked      boolean NOT NULL DEFAULT false,   -- e.g. unpaid dues or damage history
  blocked_reason  text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customers_shop_id_id_key UNIQUE (shop_id, id)
);
CREATE INDEX idx_customers_shop_phone ON public.customers (shop_id, phone);
CREATE INDEX idx_customers_shop_name ON public.customers (shop_id, lower(full_name));

-- measurements (optional feature), e.g. {"chest": 38, "waist": 32}
CREATE TABLE public.customer_measurements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id      uuid NOT NULL REFERENCES public.shops(id),
  customer_id  uuid NOT NULL,
  label        text NOT NULL DEFAULT 'Default',
  measurements jsonb NOT NULL DEFAULT '{}',
  notes        text,
  taken_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_measurements_shop_customer_fkey FOREIGN KEY (shop_id, customer_id) REFERENCES public.customers (shop_id, id)
);

CREATE TABLE public.rentals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id           uuid NOT NULL REFERENCES public.shops(id),
  branch_id         uuid NOT NULL,
  customer_id       uuid NOT NULL,
  token             text NOT NULL,
  status            text NOT NULL DEFAULT 'reserved'
                    CHECK (status IN ('reserved', 'active', 'completed', 'cancelled', 'no_show')),
  start_at          timestamptz NOT NULL,      -- planned pickup / check-in
  end_at            timestamptz NOT NULL,      -- planned return / check-out
  actual_start_at   timestamptz,
  actual_end_at     timestamptz,
  adults            integer NOT NULL DEFAULT 1 CHECK (adults >= 0),
  children          integer NOT NULL DEFAULT 0 CHECK (children >= 0),
  with_driver       boolean NOT NULL DEFAULT false,
  whole_property    boolean NOT NULL DEFAULT false,
  deposit_agreed    numeric(14,2) NOT NULL DEFAULT 0 CHECK (deposit_agreed >= 0),
  -- money, kept in step by triggers (never written directly)
  items_total       numeric(14,2) NOT NULL DEFAULT 0 CHECK (items_total >= 0),
  add_ons_total     numeric(14,2) NOT NULL DEFAULT 0 CHECK (add_ons_total >= 0),
  charges_total     numeric(14,2) NOT NULL DEFAULT 0 CHECK (charges_total >= 0),
  discount          numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  cancellation_fee  numeric(14,2) NOT NULL DEFAULT 0 CHECK (cancellation_fee >= 0),
  total             numeric(14,2) GENERATED ALWAYS AS (
                      CASE WHEN status IN ('cancelled', 'no_show') THEN cancellation_fee
                           ELSE items_total + add_ons_total + charges_total - discount END) STORED,
  paid              numeric(14,2) NOT NULL DEFAULT 0,   -- payments + deposit applied - refunds
  deposit_received  numeric(14,2) NOT NULL DEFAULT 0 CHECK (deposit_received >= 0),
  deposit_refunded  numeric(14,2) NOT NULL DEFAULT 0 CHECK (deposit_refunded >= 0),
  deposit_applied   numeric(14,2) NOT NULL DEFAULT 0 CHECK (deposit_applied >= 0),  -- deposit kept towards charges
  id_verified_at    timestamptz,
  id_verified_by    uuid REFERENCES public.profiles(id),
  cancelled_at      timestamptz,
  cancelled_by      uuid REFERENCES public.profiles(id),
  cancel_reason     text,
  notes             text,
  created_by        uuid REFERENCES public.profiles(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rentals_shop_id_id_key UNIQUE (shop_id, id),
  CONSTRAINT rentals_shop_token_key UNIQUE (shop_id, token),
  CONSTRAINT rentals_shop_branch_fkey FOREIGN KEY (shop_id, branch_id) REFERENCES public.branches (shop_id, id),
  CONSTRAINT rentals_shop_customer_fkey FOREIGN KEY (shop_id, customer_id) REFERENCES public.customers (shop_id, id),
  CONSTRAINT rentals_dates_check CHECK (end_at > start_at),
  CONSTRAINT rentals_actual_dates_check CHECK (actual_end_at IS NULL OR actual_start_at IS NULL OR actual_end_at >= actual_start_at),
  CONSTRAINT rentals_discount_within_items CHECK (discount <= items_total + add_ons_total + charges_total),
  CONSTRAINT rentals_paid_within_total CHECK (paid >= 0 AND paid <= total),     -- balance never negative
  CONSTRAINT rentals_deposit_balance CHECK (deposit_refunded + deposit_applied <= deposit_received)
);
CREATE INDEX idx_rentals_shop_status ON public.rentals (shop_id, status);
CREATE INDEX idx_rentals_shop_start ON public.rentals (shop_id, start_at DESC);
CREATE INDEX idx_rentals_shop_created ON public.rentals (shop_id, created_at DESC);
CREATE INDEX idx_rentals_shop_customer ON public.rentals (shop_id, customer_id);

-- what was rented, priced at booking time (a snapshot: catalog changes never rewrite past rentals)
CREATE TABLE public.rental_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid NOT NULL REFERENCES public.shops(id),
  rental_id       uuid NOT NULL,
  product_id      uuid NOT NULL,
  variation_id    uuid NOT NULL,
  set_product_id  uuid,                         -- when the line came from a set
  kind            text NOT NULL CHECK (kind IN ('wearable', 'vehicle', 'room')),
  description     text NOT NULL,
  sku             text NOT NULL,
  image_url       text,
  qty             integer NOT NULL CHECK (qty > 0),
  rate_type       text NOT NULL,
  rate            numeric(14,2) NOT NULL CHECK (rate >= 0),
  time_units      numeric(10,2) NOT NULL CHECK (time_units > 0),   -- days, hours or nights
  amount          numeric(14,2) NOT NULL CHECK (amount >= 0),
  is_override     boolean NOT NULL DEFAULT false,                 -- amount negotiated by hand
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rental_lines_shop_id_id_key UNIQUE (shop_id, id),
  CONSTRAINT rental_lines_shop_rental_fkey FOREIGN KEY (shop_id, rental_id) REFERENCES public.rentals (shop_id, id) ON DELETE CASCADE,
  CONSTRAINT rental_lines_shop_product_fkey FOREIGN KEY (shop_id, product_id) REFERENCES public.products (shop_id, id),
  CONSTRAINT rental_lines_shop_variation_fkey FOREIGN KEY (shop_id, variation_id) REFERENCES public.product_variations (shop_id, id),
  CONSTRAINT rental_lines_shop_set_fkey FOREIGN KEY (shop_id, set_product_id) REFERENCES public.products (shop_id, id)
);
CREATE INDEX idx_rental_lines_rental ON public.rental_lines (shop_id, rental_id);
CREATE INDEX idx_rental_lines_variation ON public.rental_lines (shop_id, variation_id);

-- which unit is held for which rental, for which time (including its turnaround).
-- The exclusion constraint makes double booking impossible: no two live reservations of one unit overlap.
CREATE TABLE public.unit_reservations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     uuid NOT NULL REFERENCES public.shops(id),
  rental_id   uuid NOT NULL,
  line_id     uuid NOT NULL,
  unit_id     uuid NOT NULL,
  period      tstzrange NOT NULL CHECK (NOT isempty(period) AND lower_inc(period) AND NOT upper_inf(period)),
  state       text NOT NULL DEFAULT 'held' CHECK (state IN ('held', 'out', 'returned', 'released')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unit_reservations_shop_rental_fkey FOREIGN KEY (shop_id, rental_id) REFERENCES public.rentals (shop_id, id) ON DELETE CASCADE,
  CONSTRAINT unit_reservations_shop_line_fkey FOREIGN KEY (shop_id, line_id) REFERENCES public.rental_lines (shop_id, id) ON DELETE CASCADE,
  CONSTRAINT unit_reservations_shop_unit_fkey FOREIGN KEY (shop_id, unit_id) REFERENCES public.units (shop_id, id),
  CONSTRAINT unit_reservations_no_overlap EXCLUDE USING gist (unit_id WITH =, period WITH &&) WHERE (state <> 'released')
);
CREATE INDEX idx_unit_reservations_rental ON public.unit_reservations (shop_id, rental_id);
CREATE INDEX idx_unit_reservations_unit ON public.unit_reservations (unit_id, state);

CREATE TABLE public.rental_add_ons (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id      uuid NOT NULL REFERENCES public.shops(id),
  rental_id    uuid NOT NULL,
  add_on_id    uuid NOT NULL,
  name         text NOT NULL,
  basis        text NOT NULL,
  quantity     numeric(10,2) NOT NULL CHECK (quantity > 0),   -- times the basis applies (nights x people ...)
  unit_amount  numeric(14,2) NOT NULL CHECK (unit_amount >= 0),
  amount       numeric(14,2) NOT NULL CHECK (amount >= 0),
  CONSTRAINT rental_add_ons_shop_rental_fkey FOREIGN KEY (shop_id, rental_id) REFERENCES public.rentals (shop_id, id) ON DELETE CASCADE,
  CONSTRAINT rental_add_ons_shop_add_on_fkey FOREIGN KEY (shop_id, add_on_id) REFERENCES public.add_ons (shop_id, id)
);
CREATE INDEX idx_rental_add_ons_rental ON public.rental_add_ons (shop_id, rental_id);

-- charges at or after return (a challan can arrive weeks later)
CREATE TABLE public.rental_charges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     uuid NOT NULL REFERENCES public.shops(id),
  rental_id   uuid NOT NULL,
  type        text NOT NULL CHECK (type IN ('late', 'extra_km', 'fuel', 'damage', 'lost', 'cleaning', 'toll',
                                            'parking', 'challan', 'alteration', 'extra_person', 'other')),
  amount      numeric(14,2) NOT NULL CHECK (amount > 0),
  note        text,
  created_by  uuid REFERENCES public.profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rental_charges_shop_rental_fkey FOREIGN KEY (shop_id, rental_id) REFERENCES public.rentals (shop_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_rental_charges_rental ON public.rental_charges (shop_id, rental_id);

-- the handover record per unit: condition, odometer, fuel, photos (private bucket rental_photos)
CREATE TABLE public.rental_checks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id      uuid NOT NULL REFERENCES public.shops(id),
  rental_id    uuid NOT NULL,
  unit_id      uuid NOT NULL,
  phase        text NOT NULL CHECK (phase IN ('pickup', 'return')),
  condition    text CHECK (condition IN ('good', 'damaged', 'lost')),
  odometer     integer CHECK (odometer >= 0),
  fuel_level   smallint CHECK (fuel_level BETWEEN 0 AND 8),   -- in eighths of a tank
  notes        text,
  photo_paths  text[] NOT NULL DEFAULT '{}',
  checked_by   uuid REFERENCES public.profiles(id),
  checked_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rental_checks_shop_rental_fkey FOREIGN KEY (shop_id, rental_id) REFERENCES public.rentals (shop_id, id) ON DELETE CASCADE,
  CONSTRAINT rental_checks_shop_unit_fkey FOREIGN KEY (shop_id, unit_id) REFERENCES public.units (shop_id, id),
  CONSTRAINT rental_checks_one_per_phase UNIQUE (rental_id, unit_id, phase)
);

-- every rupee in or out of a rental
CREATE TABLE public.payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id      uuid NOT NULL REFERENCES public.shops(id),
  rental_id    uuid NOT NULL,
  kind         text NOT NULL CHECK (kind IN (
                 'payment',          -- money towards the rental total
                 'refund',           -- money back (e.g. cancellation)
                 'deposit',          -- security deposit received (held, not revenue)
                 'deposit_refund',   -- deposit given back
                 'deposit_applied')),-- deposit kept towards charges (no cash moves)
  amount       numeric(14,2) NOT NULL CHECK (amount > 0),
  method       text CHECK (method IN ('cash', 'upi', 'card', 'bank_transfer')),
  paid_at      timestamptz NOT NULL DEFAULT now(),
  note         text,
  recorded_by  uuid REFERENCES public.profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_shop_rental_fkey FOREIGN KEY (shop_id, rental_id) REFERENCES public.rentals (shop_id, id),
  CONSTRAINT payments_method_by_kind CHECK ((kind = 'deposit_applied') = (method IS NULL))
);
CREATE INDEX idx_payments_rental ON public.payments (shop_id, rental_id);
CREATE INDEX idx_payments_shop_paid_at ON public.payments (shop_id, paid_at);

-- appointments (optional feature): fittings and trials, vehicle delivery, inspections
CREATE TABLE public.appointments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       uuid NOT NULL REFERENCES public.shops(id),
  branch_id     uuid NOT NULL,
  customer_id   uuid NOT NULL,
  rental_id     uuid,
  type          text NOT NULL CHECK (type IN ('fitting', 'trial', 'delivery', 'collection', 'inspection', 'other')),
  scheduled_at  timestamptz NOT NULL,
  status        text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'done', 'missed', 'cancelled')),
  notes         text,
  created_by    uuid REFERENCES public.profiles(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointments_shop_branch_fkey FOREIGN KEY (shop_id, branch_id) REFERENCES public.branches (shop_id, id),
  CONSTRAINT appointments_shop_customer_fkey FOREIGN KEY (shop_id, customer_id) REFERENCES public.customers (shop_id, id),
  CONSTRAINT appointments_shop_rental_fkey FOREIGN KEY (shop_id, rental_id) REFERENCES public.rentals (shop_id, id) ON DELETE SET NULL (rental_id)
);
CREATE INDEX idx_appointments_shop_when ON public.appointments (shop_id, scheduled_at);

-- ==============================================================================
-- Money kept in step: one function recomputes a rental from its records
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.recompute_rental_money(p_rental_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  UPDATE public.rentals r SET
    items_total      = COALESCE((SELECT sum(amount) FROM public.rental_lines WHERE rental_id = r.id), 0),
    add_ons_total    = COALESCE((SELECT sum(amount) FROM public.rental_add_ons WHERE rental_id = r.id), 0),
    charges_total    = COALESCE((SELECT sum(amount) FROM public.rental_charges WHERE rental_id = r.id), 0),
    paid             = COALESCE((SELECT sum(CASE kind WHEN 'payment' THEN amount WHEN 'deposit_applied' THEN amount
                                                    WHEN 'refund' THEN -amount ELSE 0 END)
                                 FROM public.payments WHERE rental_id = r.id), 0),
    deposit_received = COALESCE((SELECT sum(amount) FROM public.payments WHERE rental_id = r.id AND kind = 'deposit'), 0),
    deposit_refunded = COALESCE((SELECT sum(amount) FROM public.payments WHERE rental_id = r.id AND kind = 'deposit_refund'), 0),
    deposit_applied  = COALESCE((SELECT sum(amount) FROM public.payments WHERE rental_id = r.id AND kind = 'deposit_applied'), 0),
    updated_at       = now()
  WHERE r.id = p_rental_id;
$$;

CREATE OR REPLACE FUNCTION public.trg_recompute_rental_money()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_rental_money(OLD.rental_id);
    RETURN OLD;
  END IF;
  PERFORM public.recompute_rental_money(NEW.rental_id);
  IF TG_OP = 'UPDATE' AND OLD.rental_id IS DISTINCT FROM NEW.rental_id THEN
    PERFORM public.recompute_rental_money(OLD.rental_id);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_lines_money AFTER INSERT OR UPDATE OR DELETE ON public.rental_lines
  FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_rental_money();
CREATE TRIGGER trg_add_ons_money AFTER INSERT OR UPDATE OR DELETE ON public.rental_add_ons
  FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_rental_money();
CREATE TRIGGER trg_charges_money AFTER INSERT OR UPDATE OR DELETE ON public.rental_charges
  FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_rental_money();
CREATE TRIGGER trg_payments_money AFTER INSERT OR UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_rental_money();

-- rental token <PREFIX>-YYYY-NNNN, numbered per shop and year
CREATE OR REPLACE FUNCTION public.assign_rental_token()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_prefix text;
  v_tz text;
  v_year text;
  v_seq bigint;
BEGIN
  SELECT token_prefix, timezone INTO v_prefix, v_tz FROM public.shops WHERE id = NEW.shop_id;
  v_year := to_char(now() AT TIME ZONE v_tz, 'YYYY');
  v_seq := public.next_shop_counter(NEW.shop_id, 'rental', v_year);
  NEW.token := v_prefix || '-' || v_year || '-' || lpad(v_seq::text, GREATEST(4, length(v_seq::text)), '0');
  RETURN NEW;
END $$;
CREATE TRIGGER trg_assign_rental_token BEFORE INSERT ON public.rentals
  FOR EACH ROW EXECUTE FUNCTION public.assign_rental_token();

CREATE TRIGGER trg_guard_branch_deactivation BEFORE UPDATE OF is_active ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.guard_branch_deactivation();

-- every deletion is written to audit_log (with the reason set by the admin functions)
CREATE OR REPLACE FUNCTION public.audit_record_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  INSERT INTO public.audit_log (shop_id, performed_by, via, action, table_name, record_id, reason, old_data)
  VALUES (OLD.shop_id, auth.uid(), CASE WHEN auth.uid() IS NULL THEN 'sql' ELSE 'app' END, 'delete',
          TG_TABLE_NAME, OLD.id, NULLIF(current_setting('app.audit_reason', true), ''), to_jsonb(OLD));
  RETURN OLD;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rentals', 'rental_lines', 'rental_add_ons', 'rental_charges', 'payments', 'unit_reservations']
  LOOP
    EXECUTE format('CREATE TRIGGER trg_audit_delete AFTER DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_record_delete()', t);
  END LOOP;
END $$;
