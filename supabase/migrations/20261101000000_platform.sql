-- Overbooked v2 — platform: shops, business templates, people, Zypher billing, numbering.
--
-- One database serves many rental shops. Every business row carries shop_id; rules in
-- 20261101000003_security.sql keep each shop's data private. super_admin = Zypher staff (no shop);
-- owner / manager / staff = people of one shop.

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- ==============================================================================
-- Business templates: what a type of rental business looks like (labels, fields, rates,
-- checks, features). A shop picks one or more; adding a business type later = a new row.
-- ==============================================================================
CREATE TABLE public.business_templates (
  key              text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  name             text NOT NULL,
  -- how time and units work: wearable = by day; vehicle = by hour/day with km; room = by night with guests
  kind             text NOT NULL CHECK (kind IN ('wearable', 'vehicle', 'room')),
  labels           jsonb NOT NULL DEFAULT '{}',   -- {"item": "Outfit", "items": "Outfits", "unit": "Piece", ...}
  variation_fields jsonb NOT NULL DEFAULT '[]',   -- [{"key": "size", "label": "Size", "type": "text"}, ...]
  unit_fields      jsonb NOT NULL DEFAULT '[]',   -- [{"key": "registration_no", "label": "Registration no.", "required": true}]
  checks           jsonb NOT NULL DEFAULT '{}',   -- {"pickup": ["condition", "odometer", ...], "return": [...]}
  rate_types       text[] NOT NULL,               -- which rates a variation of this type can have
  turnaround       interval NOT NULL DEFAULT '0', -- default gap after each rental (cleaning, servicing)
  features         jsonb NOT NULL DEFAULT '{}',   -- features switched on by default for shops using it
  default_add_ons  jsonb NOT NULL DEFAULT '[]',   -- add-ons created for a new shop
  sort             integer NOT NULL DEFAULT 0
);

-- ==============================================================================
-- Shops
-- ==============================================================================
CREATE TABLE public.shops (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL CHECK (btrim(name) <> ''),
  slug            text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  token_prefix    text NOT NULL CHECK (token_prefix ~ '^[A-Z]{2,6}$'),
  business_types  text[] NOT NULL CHECK (cardinality(business_types) > 0),
  phone           text,
  email           text,
  address         text,
  gstin           text,
  logo_url        text,
  timezone        text NOT NULL DEFAULT 'Asia/Kolkata',
  plan            text NOT NULL DEFAULT 'starter' CHECK (plan IN ('starter', 'pro', 'business')),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  paid_until      date,
  -- shop-level switches and policies, e.g. {"features": {"sets": true}, "grace_minutes": 60,
  -- "check_in_time": "14:00", "check_out_time": "11:00", "require_licence": true}
  settings        jsonb NOT NULL DEFAULT '{}',
  notes           text,          -- Zypher's own notes about the shop
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- every business type a shop uses must exist
CREATE OR REPLACE FUNCTION public.check_shop_business_types()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM unnest(NEW.business_types) t WHERE t NOT IN (SELECT key FROM public.business_templates)) THEN
    RAISE EXCEPTION 'Unknown business type in %', NEW.business_types;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_check_shop_business_types BEFORE INSERT OR UPDATE OF business_types ON public.shops
  FOR EACH ROW EXECUTE FUNCTION public.check_shop_business_types();

CREATE TABLE public.branches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     uuid NOT NULL REFERENCES public.shops(id),
  name        text NOT NULL CHECK (btrim(name) <> ''),
  slug        text NOT NULL,
  address     text,
  phone       text,
  email       text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT branches_shop_id_id_key UNIQUE (shop_id, id),
  CONSTRAINT branches_shop_name_key UNIQUE (shop_id, name),
  CONSTRAINT branches_shop_slug_key UNIQUE (shop_id, slug)
);

-- ==============================================================================
-- People
-- ==============================================================================
CREATE TABLE public.profiles (
  id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name       text NOT NULL,
  role            text NOT NULL DEFAULT 'staff' CHECK (role IN ('super_admin', 'owner', 'manager', 'staff')),
  shop_id         uuid REFERENCES public.shops(id),
  active_shop_id  uuid REFERENCES public.shops(id) ON DELETE SET NULL,   -- Zypher staff: the shop they opened
  branch_id       uuid,
  avatar_url      text,
  is_active       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_shop_branch_fkey FOREIGN KEY (shop_id, branch_id) REFERENCES public.branches (shop_id, id),
  -- Zypher staff belong to no shop; shop people need a shop before they can be active
  CONSTRAINT profiles_shop_check CHECK (
    (role = 'super_admin' AND shop_id IS NULL AND branch_id IS NULL)
    OR (role <> 'super_admin' AND (shop_id IS NOT NULL OR is_active IS FALSE)))
);
CREATE INDEX idx_profiles_shop_id ON public.profiles (shop_id);

CREATE TABLE public.staff_invites (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id      uuid NOT NULL REFERENCES public.shops(id),
  email        text NOT NULL CHECK (email = lower(btrim(email))),
  role         text NOT NULL CHECK (role IN ('owner', 'manager', 'staff')),
  branch_id    uuid,
  invited_by   uuid REFERENCES public.profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  accepted_at  timestamptz,
  CONSTRAINT staff_invites_shop_branch_fkey FOREIGN KEY (shop_id, branch_id) REFERENCES public.branches (shop_id, id)
);
CREATE UNIQUE INDEX staff_invites_one_open_per_email ON public.staff_invites (email) WHERE accepted_at IS NULL;

-- ==============================================================================
-- Zypher's side: shops pay by bank transfer; this records it
-- ==============================================================================
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

-- per-shop numbering (rental tokens <PREFIX>-YYYY-NNNN)
CREATE TABLE public.shop_counters (
  shop_id  uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  kind     text NOT NULL,
  period   text NOT NULL DEFAULT '',
  value    bigint NOT NULL,
  PRIMARY KEY (shop_id, kind, period)
);

-- every deletion and every super_admin correction, with its reason
CREATE TABLE public.audit_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shop_id       uuid REFERENCES public.shops(id),
  performed_at  timestamptz NOT NULL DEFAULT now(),
  performed_by  uuid,
  via           text NOT NULL CHECK (via IN ('app', 'sql')),
  action        text NOT NULL,
  table_name    text NOT NULL,
  record_id     uuid,
  reason        text,
  old_data      jsonb,
  new_data      jsonb
);
CREATE INDEX idx_audit_log_shop_id ON public.audit_log (shop_id, performed_at DESC);

-- ==============================================================================
-- Who is calling. All STABLE SECURITY DEFINER: rules call them as (SELECT fn()) so they run once per query.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.my_home_shop_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT shop_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin' AND is_active);
$$;

-- the shop every query runs in: Zypher staff -> the shop they opened; others -> their shop while it is active
CREATE OR REPLACE FUNCTION public.current_shop_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT CASE WHEN p.role = 'super_admin' THEN p.active_shop_id ELSE p.shop_id END
  FROM public.profiles p
  WHERE p.id = auth.uid() AND p.is_active
    AND (p.role = 'super_admin' OR EXISTS (SELECT 1 FROM public.shops s WHERE s.id = p.shop_id AND s.status = 'active'));
$$;

-- NULL for inactive people, for staff of an inactive branch and for everyone in a paused shop
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT p.role FROM public.profiles p
  WHERE p.id = auth.uid() AND p.is_active
    AND (p.role = 'super_admin'
         OR (EXISTS (SELECT 1 FROM public.shops s WHERE s.id = p.shop_id AND s.status = 'active')
             AND (p.role = 'owner' OR p.branch_id IS NULL
                  OR EXISTS (SELECT 1 FROM public.branches b WHERE b.id = p.branch_id AND b.is_active))));
$$;

CREATE OR REPLACE FUNCTION public.get_my_branch()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT CASE WHEN public.get_my_role() IS NULL THEN NULL ELSE p.branch_id END
  FROM public.profiles p WHERE p.id = auth.uid();
$$;

-- a feature switch for the current shop: shop setting first, else on if any of its templates turns it on
CREATE OR REPLACE FUNCTION public.shop_feature(p_shop_id uuid, p_feature text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT COALESCE(
    (SELECT (s.settings -> 'features' ->> p_feature)::boolean FROM public.shops s WHERE s.id = p_shop_id),
    (SELECT bool_or(COALESCE((t.features ->> p_feature)::boolean, false))
     FROM public.shops s JOIN public.business_templates t ON t.key = ANY (s.business_types)
     WHERE s.id = p_shop_id),
    false);
$$;

CREATE OR REPLACE FUNCTION public.next_shop_counter(p_shop_id uuid, p_kind text, p_period text)
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  INSERT INTO public.shop_counters (shop_id, kind, period, value) VALUES (p_shop_id, p_kind, p_period, 1)
  ON CONFLICT (shop_id, kind, period) DO UPDATE SET value = public.shop_counters.value + 1
  RETURNING value;
$$;

-- ==============================================================================
-- New accounts: an open invite puts the person in its shop, role and branch; otherwise inactive, no shop
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_invite RECORD;
  v_name text := COALESCE(NULLIF(btrim(NEW.raw_user_meta_data ->> 'full_name'), ''), NEW.email);
BEGIN
  SELECT * INTO v_invite FROM public.staff_invites
  WHERE email = lower(NEW.email) AND accepted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.profiles (id, full_name, is_active) VALUES (NEW.id, v_name, false);
    RETURN NEW;
  END IF;

  INSERT INTO public.profiles (id, full_name, role, shop_id, branch_id, is_active)
  VALUES (NEW.id, v_name, v_invite.role, v_invite.shop_id, v_invite.branch_id, true);
  UPDATE public.staff_invites SET accepted_at = now() WHERE id = v_invite.id;
  RETURN NEW;
END $$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ==============================================================================
-- Plan limits (Starter: 1 branch, 3 logins; Pro: 3 branches; Business: none)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.plan_limit(p_plan text, p_kind text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_kind = 'branches' AND p_plan = 'starter' THEN 1
    WHEN p_kind = 'branches' AND p_plan = 'pro' THEN 3
    WHEN p_kind = 'logins' AND p_plan = 'starter' THEN 3
    ELSE NULL END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_branch_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_plan text;
  v_limit integer;
BEGIN
  IF NEW.is_active IS NOT TRUE OR (TG_OP = 'UPDATE' AND OLD.is_active) THEN
    RETURN NEW;
  END IF;
  SELECT plan INTO v_plan FROM public.shops WHERE id = NEW.shop_id FOR UPDATE;
  v_limit := public.plan_limit(v_plan, 'branches');
  IF v_limit IS NOT NULL
     AND (SELECT count(*) FROM public.branches WHERE shop_id = NEW.shop_id AND is_active AND id <> NEW.id) >= v_limit THEN
    RAISE EXCEPTION 'Your % plan allows % active branch(es). Contact Zypher to upgrade.', initcap(v_plan), v_limit;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_enforce_branch_limit BEFORE INSERT OR UPDATE OF is_active ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.enforce_branch_limit();

CREATE OR REPLACE FUNCTION public.enforce_login_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_plan text;
  v_limit integer;
BEGIN
  IF NEW.is_active IS NOT TRUE OR NEW.shop_id IS NULL
     OR (TG_OP = 'UPDATE' AND OLD.is_active AND OLD.shop_id IS NOT DISTINCT FROM NEW.shop_id) THEN
    RETURN NEW;
  END IF;
  SELECT plan INTO v_plan FROM public.shops WHERE id = NEW.shop_id FOR UPDATE;
  v_limit := public.plan_limit(v_plan, 'logins');
  IF v_limit IS NOT NULL
     AND (SELECT count(*) FROM public.profiles WHERE shop_id = NEW.shop_id AND is_active AND id <> NEW.id) >= v_limit THEN
    RAISE EXCEPTION 'Your % plan allows % staff logins. Contact Zypher to upgrade.', initcap(v_plan), v_limit;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_enforce_login_limit BEFORE INSERT OR UPDATE OF is_active, shop_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_login_limit();

-- a branch can only be closed once nothing is open there
CREATE OR REPLACE FUNCTION public.guard_branch_deactivation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
BEGIN
  IF OLD.is_active AND NOT NEW.is_active
     AND EXISTS (SELECT 1 FROM public.rentals WHERE branch_id = OLD.id AND status IN ('reserved', 'active')) THEN
    RAISE EXCEPTION 'This branch still has open rentals. Complete or cancel them before deactivating it.';
  END IF;
  RETURN NEW;
END $$;
-- trigger created in 20261101000002 once rentals exists
