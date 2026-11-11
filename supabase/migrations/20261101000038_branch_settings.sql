-- Settings page with a branch switch (docs/SETTINGS_PAGE_PLAN.md).
--   * `branches.settings` holds a branch's own values (overrides only). A setting a branch has not set follows the shop.
--     Only some settings may differ per branch (_branch_setting_keys); GST %, SAC and the licence rule stay shop-wide.
--   * update_branch_settings() sets or clears a branch's overrides (owner, as update_my_shop).
--   * The late rules copied onto a new booking and the grace time of a late return now follow the booking's branch.
--   * City, state and PIN code for the shop and each branch; the owner may now change the shop's name.
-- Additive: a shop with no branch overrides behaves exactly as before. Support logins are unchanged: they reach these
-- functions exactly as they reach update_my_shop today.

ALTER TABLE public.branches
  ADD COLUMN settings jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN city text CHECK (city IS NULL OR length(city) <= 60),
  ADD COLUMN state text CHECK (state IS NULL OR length(state) <= 60),
  ADD COLUMN pincode text CHECK (pincode IS NULL OR pincode ~ '^[1-9][0-9]{5}$');
ALTER TABLE public.shops
  ADD COLUMN city text CHECK (city IS NULL OR length(city) <= 60),
  ADD COLUMN state text CHECK (state IS NULL OR length(state) <= 60),
  ADD COLUMN pincode text CHECK (pincode IS NULL OR pincode ~ '^[1-9][0-9]{5}$');

-- the settings a branch may set for itself
CREATE OR REPLACE FUNCTION public._branch_setting_keys()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public, pg_catalog AS $$
  SELECT ARRAY['receipt_note', 'grace_minutes', 'check_in_time', 'check_out_time',
               'late_fee_on', 'late_fee_mode', 'late_fee_percent', 'late_fee_fixed', 'late_fee_basis',
               'late_cutoff_time', 'late_day_count', 'late_cap', 'late_cap_percent', 'late_clash_action'];
$$;

-- a branch's value, else the shop's, else the default
CREATE OR REPLACE FUNCTION public._branch_rule(p_branch uuid, p_key text, p_default text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT COALESCE(
    (SELECT NULLIF(b.settings ->> p_key, '') FROM public.branches b WHERE b.id = p_branch),
    (SELECT NULLIF(s.settings ->> p_key, '') FROM public.shops s JOIN public.branches b ON b.shop_id = s.id WHERE b.id = p_branch),
    p_default);
$$;

-- the checks of every setting with rules, for the shop and for a branch (037's checks, plus the limits the app already used)
CREATE OR REPLACE FUNCTION public._settings_check(s jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_catalog AS $$
BEGIN
  IF s ? 'late_fee_on' AND jsonb_typeof(s -> 'late_fee_on') <> 'boolean' THEN
    RAISE EXCEPTION 'Late fees are on or off';
  END IF;
  IF s ? 'late_fee_mode' AND s ->> 'late_fee_mode' NOT IN ('percent', 'fixed') THEN
    RAISE EXCEPTION 'The late fee is a percentage of the daily price or a fixed amount';
  END IF;
  IF s ? 'late_fee_percent' AND (jsonb_typeof(s -> 'late_fee_percent') <> 'number'
     OR (s ->> 'late_fee_percent')::numeric NOT BETWEEN 0 AND 300) THEN
    RAISE EXCEPTION 'The late fee percentage is 0 to 300';
  END IF;
  IF s ? 'late_cap_percent' AND (jsonb_typeof(s -> 'late_cap_percent') <> 'number'
     OR (s ->> 'late_cap_percent')::numeric NOT BETWEEN 0 AND 300) THEN
    RAISE EXCEPTION 'The maximum late fee is 0 to 300 percent of the rent';
  END IF;
  IF s ? 'late_fee_fixed' AND (jsonb_typeof(s -> 'late_fee_fixed') <> 'number'
     OR (s ->> 'late_fee_fixed')::numeric NOT BETWEEN 0 AND 10000000
     OR (s ->> 'late_fee_fixed')::numeric <> round((s ->> 'late_fee_fixed')::numeric, 2)) THEN
    RAISE EXCEPTION 'The fixed late fee is 0 to 1,00,00,000 rupees, in rupees and paise';
  END IF;
  IF s ? 'late_fee_basis' AND s ->> 'late_fee_basis' NOT IN ('catalogue', 'agreed') THEN
    RAISE EXCEPTION 'The daily price is the catalogue rate or the agreed price';
  END IF;
  IF s ? 'late_cutoff_time' AND COALESCE(s ->> 'late_cutoff_time', '') <> ''
     AND s ->> 'late_cutoff_time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
    RAISE EXCEPTION 'The latest return time is a time like 20:00';
  END IF;
  IF s ? 'late_day_count' AND s ->> 'late_day_count' NOT IN ('calendar', 'blocks') THEN
    RAISE EXCEPTION 'Late days are counted as calendar days or 24-hour blocks';
  END IF;
  IF s ? 'late_cap' AND s ->> 'late_cap' NOT IN ('none', 'rent_percent', 'replacement') THEN
    RAISE EXCEPTION 'The maximum late fee is none, a percentage of the rent, or the replacement value';
  END IF;
  IF s ? 'late_clash_action' AND s ->> 'late_clash_action' NOT IN ('swap', 'hold') THEN
    RAISE EXCEPTION 'A late piece''s next booking is offered a swap or a hold';
  END IF;
  IF s ? 'grace_minutes' AND (jsonb_typeof(s -> 'grace_minutes') <> 'number'
     OR (s ->> 'grace_minutes')::numeric NOT BETWEEN 0 AND 1440 OR (s ->> 'grace_minutes')::numeric <> trunc((s ->> 'grace_minutes')::numeric)) THEN
    RAISE EXCEPTION 'Grace time is whole minutes, 0 to 1440';
  END IF;
  IF (s ? 'check_in_time' AND s ->> 'check_in_time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
     OR (s ? 'check_out_time' AND s ->> 'check_out_time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') THEN
    RAISE EXCEPTION 'Check-in and check-out are times like 14:00';
  END IF;
  IF s ? 'receipt_note' AND length(COALESCE(s ->> 'receipt_note', '')) > 200 THEN
    RAISE EXCEPTION 'The receipt note is at most 200 characters';
  END IF;
END $$;

-- 037's version: the checks moved to _settings_check; the owner may also change the name, city, state and PIN code
CREATE OR REPLACE FUNCTION public.update_my_shop(p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid;
  v_bad text;
BEGIN
  PERFORM public._require_role(ARRAY['super_admin', 'owner']);
  v_shop := public.current_shop_id();
  IF jsonb_typeof(p -> 'settings') = 'object' THEN
    SELECT k INTO v_bad FROM jsonb_object_keys(p -> 'settings') k
    WHERE k NOT IN ('grace_minutes', 'check_in_time', 'check_out_time', 'require_licence', 'gst_percent', 'receipt_note',
                    'sac_code', 'plan', 'features',   -- plan and features are Zypher's and are dropped below, as before
                    'late_fee_on', 'late_fee_mode', 'late_fee_percent', 'late_fee_fixed', 'late_fee_basis',
                    'late_cutoff_time', 'late_day_count', 'late_cap', 'late_cap_percent', 'late_clash_action')
    LIMIT 1;
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'Unknown setting: %', v_bad;
    END IF;
    PERFORM public._settings_check(p -> 'settings');
  END IF;
  IF p ? 'name' AND (btrim(COALESCE(p ->> 'name', '')) = '' OR length(btrim(p ->> 'name')) > 80) THEN
    RAISE EXCEPTION 'The shop name is 1 to 80 characters';
  END IF;
  IF p ? 'pincode' AND COALESCE(btrim(p ->> 'pincode'), '') !~ '^([1-9][0-9]{5})?$' THEN
    RAISE EXCEPTION 'The PIN code is 6 digits';
  END IF;
  UPDATE public.shops SET
    name = CASE WHEN p ? 'name' THEN btrim(regexp_replace(p ->> 'name', '\s+', ' ', 'g')) ELSE name END,
    phone = CASE WHEN p ? 'phone' THEN NULLIF(btrim(p ->> 'phone'), '') ELSE phone END,
    email = CASE WHEN p ? 'email' THEN NULLIF(btrim(p ->> 'email'), '') ELSE email END,
    address = CASE WHEN p ? 'address' THEN NULLIF(btrim(p ->> 'address'), '') ELSE address END,
    city = CASE WHEN p ? 'city' THEN NULLIF(btrim(p ->> 'city'), '') ELSE city END,
    state = CASE WHEN p ? 'state' THEN NULLIF(btrim(p ->> 'state'), '') ELSE state END,
    pincode = CASE WHEN p ? 'pincode' THEN NULLIF(btrim(p ->> 'pincode'), '') ELSE pincode END,
    gstin = CASE WHEN p ? 'gstin' THEN NULLIF(upper(btrim(p ->> 'gstin')), '') ELSE gstin END,
    logo_url = CASE WHEN p ? 'logo_url' THEN NULLIF(p ->> 'logo_url', '') ELSE logo_url END,
    settings = settings || (COALESCE(p -> 'settings', '{}') - 'plan' - 'features')
  WHERE id = v_shop;
END $$;

-- set (p_set) or remove (p_clear: back to the shop's value) a branch's own settings
CREATE OR REPLACE FUNCTION public.update_branch_settings(p_branch_id uuid, p_set jsonb DEFAULT '{}', p_clear text[] DEFAULT '{}')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_bad text;
BEGIN
  PERFORM public._require_role(ARRAY['super_admin', 'owner']);
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id AND shop_id = public.current_shop_id()) THEN
    RAISE EXCEPTION 'Branch not found';
  END IF;
  IF jsonb_typeof(COALESCE(p_set, '{}')) <> 'object' THEN
    RAISE EXCEPTION 'Settings must be a list of names and values';
  END IF;
  SELECT k INTO v_bad FROM (SELECT jsonb_object_keys(COALESCE(p_set, '{}')) k UNION SELECT unnest(COALESCE(p_clear, '{}'))) x
  WHERE k <> ALL (public._branch_setting_keys()) LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '% is set for the whole shop, not per branch', v_bad;
  END IF;
  PERFORM public._settings_check(COALESCE(p_set, '{}'));
  UPDATE public.branches SET settings = (settings || COALESCE(p_set, '{}')) - COALESCE(p_clear, '{}')
  WHERE id = p_branch_id;
END $$;

-- the late rules a new booking gets, from its branch (037's _late_terms read the shop only)
CREATE OR REPLACE FUNCTION public._branch_late_terms(p_branch uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT jsonb_build_object(
    'on',          public._branch_rule(p_branch, 'late_fee_on', 'true')::boolean,
    'mode',        public._branch_rule(p_branch, 'late_fee_mode', 'percent'),
    'percent',     public._branch_rule(p_branch, 'late_fee_percent', '100')::numeric,
    'fixed',       public._branch_rule(p_branch, 'late_fee_fixed', '0')::numeric,
    'basis',       public._branch_rule(p_branch, 'late_fee_basis', 'catalogue'),
    'cutoff',      public._branch_rule(p_branch, 'late_cutoff_time', NULL),
    'count',       public._branch_rule(p_branch, 'late_day_count', 'calendar'),
    'cap',         public._branch_rule(p_branch, 'late_cap', 'none'),
    'cap_percent', public._branch_rule(p_branch, 'late_cap_percent', '100')::numeric);
$$;

CREATE OR REPLACE FUNCTION public._rental_late_terms()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  NEW.late_terms := COALESCE(NEW.late_terms, public._branch_late_terms(NEW.branch_id));
  RETURN NEW;
END $$;

-- 037's version; the grace time of hourly and nightly lines follows the booking's branch
CREATE OR REPLACE FUNCTION public.return_suggestions(p_rental_id uuid, p_returned_at timestamptz DEFAULT now(), p_odometers jsonb DEFAULT '[]')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_r RECORD;
  v_tz text := public._shop_tz();
  v_grace interval;
  v_charges jsonb := '[]';
  v_line public.rental_lines;
  v_late_hours integer;
  v_late_days integer;
  v_rate numeric;
  v_penalty numeric := 0;
  v_unit RECORD;
  v_out integer;
  v_in integer;
  v_days integer;
  v_allow integer;
  v_extra integer;
  v_fee jsonb;
  v_late boolean;
BEGIN
  PERFORM public._require_role();
  SELECT * INTO v_r FROM public.rentals WHERE id = p_rental_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental not found';
  END IF;
  v_grace := make_interval(mins => public._branch_rule(v_r.branch_id, 'grace_minutes', '60')::integer);

  FOR v_line IN SELECT * FROM public.rental_lines WHERE rental_id = p_rental_id AND rate_type IN ('day', 'hour', 'hour_day', 'night') LOOP
    v_rate := NULL;
    v_late := NULL;
    IF v_line.kind = 'wearable' AND v_r.late_terms IS NOT NULL THEN
      v_late := false;
      IF (v_r.late_terms ->> 'on')::boolean THEN
        v_fee := public._wearable_late_fee(v_r.late_terms, v_line, v_r.end_at, p_returned_at, v_tz);
        v_late := (v_fee ->> 'days')::integer > 0;
        IF (v_fee ->> 'amount')::numeric > 0 THEN
          v_charges := v_charges || jsonb_build_object('type', 'late', 'amount', (v_fee ->> 'amount')::numeric, 'note', v_fee ->> 'note');
        END IF;
      END IF;
    ELSIF v_line.kind = 'wearable' THEN
      v_late_days := (p_returned_at AT TIME ZONE v_tz)::date - (v_r.end_at AT TIME ZONE v_tz)::date;
      IF v_late_days > 0 THEN
        v_charges := v_charges || jsonb_build_object('type', 'late', 'amount', round(v_line.qty * v_line.rate * v_late_days, 2),
          'note', v_late_days || ' day(s) late - ' || v_line.description);
      END IF;
    ELSIF p_returned_at > v_r.end_at + v_grace THEN
      v_late_hours := ceil(extract(epoch FROM (p_returned_at - v_r.end_at)) / 3600.0)::integer;
      SELECT amount INTO v_rate FROM public.variation_rates WHERE variation_id = v_line.variation_id AND rate_type = 'extra_hour';
      IF v_rate IS NULL AND v_line.kind = 'vehicle' THEN
        SELECT amount INTO v_rate FROM public.variation_rates WHERE variation_id = v_line.variation_id AND rate_type = 'hour';
      END IF;
      IF v_rate IS NULL AND v_line.kind = 'vehicle' THEN
        v_rate := round(v_line.rate / 24.0, 2);
      END IF;
      IF v_rate IS NOT NULL THEN
        v_charges := v_charges || jsonb_build_object('type', 'late', 'amount', round(v_line.qty * v_rate * v_late_hours, 2),
          'note', v_late_hours || ' hour(s) late - ' || v_line.description);
      END IF;
    END IF;
    IF COALESCE(v_late, p_returned_at > v_r.end_at + (CASE WHEN v_line.kind = 'wearable' THEN interval '0' ELSE v_grace END)
       AND (v_line.kind <> 'wearable' OR (p_returned_at AT TIME ZONE v_tz)::date > (v_r.end_at AT TIME ZONE v_tz)::date)) THEN
      SELECT COALESCE(max(amount), 0) INTO v_rate FROM public.variation_rates WHERE variation_id = v_line.variation_id AND rate_type = 'late_penalty';
      v_penalty := GREATEST(v_penalty, v_rate);
    END IF;
  END LOOP;
  IF v_penalty > 0 THEN
    v_charges := v_charges || jsonb_build_object('type', 'late', 'amount', v_penalty, 'note', 'Late return penalty');
  END IF;

  -- km above the allowance, per vehicle
  FOR v_unit IN
    SELECT ur.unit_id, u.code, rl.variation_id, v.km_included_per_day
    FROM public.unit_reservations ur
    JOIN public.units u ON u.id = ur.unit_id
    JOIN public.rental_lines rl ON rl.id = ur.line_id
    JOIN public.product_variations v ON v.id = rl.variation_id
    WHERE ur.rental_id = p_rental_id AND rl.kind = 'vehicle'
  LOOP
    SELECT odometer INTO v_out FROM public.rental_checks WHERE rental_id = p_rental_id AND unit_id = v_unit.unit_id AND phase = 'pickup';
    SELECT (value ->> 'odometer')::integer INTO v_in FROM jsonb_array_elements(p_odometers) WHERE value ->> 'unit_id' = v_unit.unit_id::text;
    CONTINUE WHEN v_out IS NULL OR v_in IS NULL OR v_unit.km_included_per_day IS NULL;
    IF v_in < v_out THEN
      RAISE EXCEPTION 'Odometer of % at return (%) is lower than at pickup (%)', v_unit.code, v_in, v_out;
    END IF;
    v_days := GREATEST(1, ceil(extract(epoch FROM (p_returned_at - COALESCE(v_r.actual_start_at, v_r.start_at))) / 86400.0)::integer);
    v_allow := v_unit.km_included_per_day * v_days;
    v_extra := GREATEST(0, (v_in - v_out) - v_allow);
    SELECT amount INTO v_rate FROM public.variation_rates WHERE variation_id = v_unit.variation_id AND rate_type = 'extra_km';
    IF v_extra > 0 AND COALESCE(v_rate, 0) > 0 THEN
      v_charges := v_charges || jsonb_build_object('type', 'extra_km', 'amount', round(v_extra * v_rate, 2),
        'note', v_unit.code || ': ' || (v_in - v_out) || ' km driven, ' || v_allow || ' km included, ' || v_extra || ' km extra');
    END IF;
  END LOOP;

  RETURN jsonb_build_object('charges', v_charges);
END $$;

-- 021's version, plus city, state and PIN code
CREATE OR REPLACE FUNCTION public.setup_save_branch(p_shop_id uuid, p_branch_id uuid, p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_name text := btrim(COALESCE(p ->> 'name', ''));
  v_slug text;
  v_try integer := 1;
  v_id uuid := p_branch_id;
BEGIN
  PERFORM public._require_setup_shop(p_shop_id);
  IF p ? 'pincode' AND COALESCE(btrim(p ->> 'pincode'), '') !~ '^([1-9][0-9]{5})?$' THEN
    RAISE EXCEPTION 'The PIN code is 6 digits';
  END IF;
  IF p_branch_id IS NULL THEN
    IF v_name = '' THEN RAISE EXCEPTION 'The branch needs a name'; END IF;
    v_slug := trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'));
    IF v_slug = '' THEN v_slug := 'branch'; END IF;
    WHILE EXISTS (SELECT 1 FROM public.branches WHERE shop_id = p_shop_id AND slug = CASE WHEN v_try = 1 THEN v_slug ELSE v_slug || '-' || v_try END) LOOP
      v_try := v_try + 1;
    END LOOP;
    IF v_try > 1 THEN v_slug := v_slug || '-' || v_try; END IF;
    INSERT INTO public.branches (shop_id, name, slug, address, phone, email, is_active, city, state, pincode)
    VALUES (p_shop_id, v_name, v_slug, NULLIF(btrim(p ->> 'address'), ''), NULLIF(btrim(p ->> 'phone'), ''),
            NULLIF(btrim(p ->> 'email'), ''), COALESCE((p ->> 'is_active')::boolean, true),
            NULLIF(btrim(p ->> 'city'), ''), NULLIF(btrim(p ->> 'state'), ''), NULLIF(btrim(p ->> 'pincode'), ''))
    RETURNING id INTO v_id;
  ELSE
    IF p ? 'name' AND v_name = '' THEN RAISE EXCEPTION 'The branch needs a name'; END IF;
    UPDATE public.branches SET
      name = CASE WHEN p ? 'name' THEN v_name ELSE name END,
      address = CASE WHEN p ? 'address' THEN NULLIF(btrim(p ->> 'address'), '') ELSE address END,
      phone = CASE WHEN p ? 'phone' THEN NULLIF(btrim(p ->> 'phone'), '') ELSE phone END,
      email = CASE WHEN p ? 'email' THEN NULLIF(btrim(p ->> 'email'), '') ELSE email END,
      city = CASE WHEN p ? 'city' THEN NULLIF(btrim(p ->> 'city'), '') ELSE city END,
      state = CASE WHEN p ? 'state' THEN NULLIF(btrim(p ->> 'state'), '') ELSE state END,
      pincode = CASE WHEN p ? 'pincode' THEN NULLIF(btrim(p ->> 'pincode'), '') ELSE pincode END,
      is_active = CASE WHEN p ? 'is_active' THEN (p ->> 'is_active')::boolean ELSE is_active END
    WHERE id = p_branch_id AND shop_id = p_shop_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Branch not found in this shop'; END IF;
  END IF;
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'This shop already has a branch with that name';
END $$;

-- ------------------------------------------------------------------------------
-- activity log (034's versions, plus the new columns and a branch's own settings)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._act_branches()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_action text := 'branch_changed';
  v_level int := 1;
  v_sum text;
  v_ch jsonb;
  k text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public._act_log(NEW.shop_id, NEW.id, 'branches', 'branch_added', 0, 'branch', NEW.id, NEW.name, format('Added branch %s', NEW.name));
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM public._act_log(OLD.shop_id, OLD.id, 'branches', 'branch_deleted', 3, 'branch', OLD.id, OLD.name,
      format('Deleted branch %s', OLD.name), true, NULL, to_jsonb(OLD));
    RETURN NULL;
  END IF;
  v_sum := format('Changed the details of branch %s', NEW.name);
  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    v_level := 2;
    v_action := CASE WHEN NEW.is_active THEN 'branch_reopened' ELSE 'branch_closed' END;
    v_sum := format(CASE WHEN NEW.is_active THEN 'Reopened branch %s' ELSE 'Closed branch %s' END, NEW.name);
  END IF;
  v_ch := public._act_change('Name', OLD.name, NEW.name) || public._act_change('Address', OLD.address, NEW.address)
    || public._act_change('Phone', OLD.phone, NEW.phone) || public._act_change('Email', OLD.email, NEW.email)
    || public._act_change('City', OLD.city, NEW.city) || public._act_change('State', OLD.state, NEW.state)
    || public._act_change('PIN code', OLD.pincode, NEW.pincode);
  IF OLD.settings IS DISTINCT FROM NEW.settings THEN
    FOR k IN SELECT jsonb_object_keys(OLD.settings) UNION SELECT jsonb_object_keys(NEW.settings) LOOP
      v_ch := v_ch || public._act_change(public._act_words(k), COALESCE(left(OLD.settings ->> k, 120), 'Shop default'),
                                                               COALESCE(left(NEW.settings ->> k, 120), 'Shop default'));
    END LOOP;
    IF v_level = 1 THEN
      v_action := 'branch_settings_changed';
      v_sum := format('Changed the settings of branch %s', NEW.name);
    END IF;
  END IF;
  PERFORM public._act_log(NEW.shop_id, NEW.id, 'branches', v_action, v_level, 'branch', NEW.id, NEW.name, v_sum, v_level = 2, v_ch);
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public._act_shops()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_ch jsonb;
  k text;
  o jsonb := COALESCE(OLD.settings, '{}');
  n jsonb := COALESCE(NEW.settings, '{}');
BEGIN
  v_ch := public._act_change('Shop name', OLD.name, NEW.name)
       || public._act_change('Phone', OLD.phone, NEW.phone)
       || public._act_change('Email', OLD.email, NEW.email)
       || public._act_change('Address', OLD.address, NEW.address)
       || public._act_change('City', OLD.city, NEW.city)
       || public._act_change('State', OLD.state, NEW.state)
       || public._act_change('PIN code', OLD.pincode, NEW.pincode)
       || public._act_change('GSTIN', OLD.gstin, NEW.gstin)
       || public._act_change('Logo', CASE WHEN OLD.logo_url IS DISTINCT FROM NEW.logo_url THEN CASE WHEN OLD.logo_url IS NULL THEN NULL ELSE 'Old logo' END END,
                                     CASE WHEN OLD.logo_url IS DISTINCT FROM NEW.logo_url THEN CASE WHEN NEW.logo_url IS NULL THEN 'Removed' ELSE 'New logo' END END)
       || public._act_change('Time zone', OLD.timezone, NEW.timezone)
       || public._act_change('Booking number prefix', OLD.token_prefix, NEW.token_prefix)
       || public._act_change('Business types', array_to_string(OLD.business_types, ', '), array_to_string(NEW.business_types, ', '))
       || public._act_change('Plan', public._act_words(OLD.plan), public._act_words(NEW.plan))
       || public._act_change('Shop status', public._act_words(OLD.status), public._act_words(NEW.status));
  FOR k IN SELECT jsonb_object_keys(o) UNION SELECT jsonb_object_keys(n) LOOP
    CONTINUE WHEN k = 'features';
    v_ch := v_ch || public._act_change(public._act_words(k), left(o ->> k, 120), left(n ->> k, 120));
  END LOOP;
  FOR k IN SELECT jsonb_object_keys(COALESCE(o -> 'features', '{}')) UNION SELECT jsonb_object_keys(COALESCE(n -> 'features', '{}')) LOOP
    v_ch := v_ch || public._act_change('Feature: ' || public._act_words(k),
                                       CASE (o -> 'features' ->> k) WHEN 'true' THEN 'On' WHEN 'false' THEN 'Off' ELSE o -> 'features' ->> k END,
                                       CASE (n -> 'features' ->> k) WHEN 'true' THEN 'On' WHEN 'false' THEN 'Off' ELSE n -> 'features' ->> k END);
  END LOOP;
  PERFORM public._act_log(NEW.id, NULL, 'settings', 'settings_changed', 1, 'shop', NEW.id, NEW.name, 'Changed the shop settings',
                          v_ch ? 'Shop status' OR v_ch ? 'Plan', v_ch);
  RETURN NULL;
END $$;

-- ------------------------------------------------------------------------------
-- who may call what
-- ------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public._branch_setting_keys(), public._branch_rule(uuid, text, text), public._settings_check(jsonb),
  public._branch_late_terms(uuid) FROM PUBLIC, anon, authenticated;
-- return_suggestions runs as app_rpc
GRANT EXECUTE ON FUNCTION public._branch_rule(uuid, text, text), public._branch_late_terms(uuid) TO app_rpc;
REVOKE ALL ON FUNCTION public._act_branches(), public._act_shops() FROM PUBLIC, anon, authenticated, app_rpc;
-- shops is readable column by column (migration 020 keeps the shop notes private): the new columns need their own grant
GRANT SELECT (city, state, pincode) ON public.shops TO authenticated;
REVOKE ALL ON FUNCTION public.update_branch_settings(uuid, jsonb, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_branch_settings(uuid, jsonb, text[]) TO authenticated;
NOTIFY pgrst, 'reload schema';
