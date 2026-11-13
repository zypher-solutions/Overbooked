-- 042: each branch may print its own GSTIN and bank details on its bills.
--   A branch in another state is registered for GST there, so it has its own GSTIN; it may also bank elsewhere.
--   branches.gstin (blank = the shop's GSTIN); bank_name, bank_holder, bank_last4 and bank_ifsc may now be a branch's own
--   setting (update_branch_settings; blank = the shop's). Whether the shop charges GST stays shop-wide (shops.gstin and the
--   GST % are the switch). Backward compatible: existing branches have no GSTIN and no bank keys, so they print as before.

ALTER TABLE public.branches
  ADD COLUMN gstin text CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$');

-- 038's list, plus the bank details
CREATE OR REPLACE FUNCTION public._branch_setting_keys()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public, pg_catalog AS $$
  SELECT ARRAY['receipt_note', 'grace_minutes', 'check_in_time', 'check_out_time',
               'late_fee_on', 'late_fee_mode', 'late_fee_percent', 'late_fee_fixed', 'late_fee_basis',
               'late_cutoff_time', 'late_day_count', 'late_cap', 'late_cap_percent', 'late_clash_action',
               'bank_name', 'bank_holder', 'bank_last4', 'bank_ifsc'];
$$;

-- 038's version, plus the GSTIN
CREATE OR REPLACE FUNCTION public.setup_save_branch(p_shop_id uuid, p_branch_id uuid, p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_name text := btrim(COALESCE(p ->> 'name', ''));
  v_gstin text := NULLIF(upper(btrim(COALESCE(p ->> 'gstin', ''))), '');
  v_slug text;
  v_try integer := 1;
  v_id uuid := p_branch_id;
BEGIN
  PERFORM public._require_setup_shop(p_shop_id);
  IF p ? 'pincode' AND COALESCE(btrim(p ->> 'pincode'), '') !~ '^([1-9][0-9]{5})?$' THEN
    RAISE EXCEPTION 'The PIN code is 6 digits';
  END IF;
  IF v_gstin IS NOT NULL AND v_gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$' THEN
    RAISE EXCEPTION 'A GST number has 15 characters, like 32ABCDE1234F1Z5';
  END IF;
  IF p_branch_id IS NULL THEN
    IF v_name = '' THEN RAISE EXCEPTION 'The branch needs a name'; END IF;
    v_slug := trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'));
    IF v_slug = '' THEN v_slug := 'branch'; END IF;
    WHILE EXISTS (SELECT 1 FROM public.branches WHERE shop_id = p_shop_id AND slug = CASE WHEN v_try = 1 THEN v_slug ELSE v_slug || '-' || v_try END) LOOP
      v_try := v_try + 1;
    END LOOP;
    IF v_try > 1 THEN v_slug := v_slug || '-' || v_try; END IF;
    INSERT INTO public.branches (shop_id, name, slug, address, phone, email, is_active, city, state, pincode, gstin)
    VALUES (p_shop_id, v_name, v_slug, NULLIF(btrim(p ->> 'address'), ''), NULLIF(btrim(p ->> 'phone'), ''),
            NULLIF(btrim(p ->> 'email'), ''), COALESCE((p ->> 'is_active')::boolean, true),
            NULLIF(btrim(p ->> 'city'), ''), NULLIF(btrim(p ->> 'state'), ''), NULLIF(btrim(p ->> 'pincode'), ''), v_gstin)
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
      gstin = CASE WHEN p ? 'gstin' THEN v_gstin ELSE gstin END,
      is_active = CASE WHEN p ? 'is_active' THEN (p ->> 'is_active')::boolean ELSE is_active END
    WHERE id = p_branch_id AND shop_id = p_shop_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Branch not found in this shop'; END IF;
  END IF;
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'This shop already has a branch with that name';
END $$;

-- 038's version, plus the GSTIN
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
    || public._act_change('PIN code', OLD.pincode, NEW.pincode)
    || public._act_change('GSTIN', COALESCE(OLD.gstin, 'Shop''s GSTIN'), COALESCE(NEW.gstin, 'Shop''s GSTIN'));
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

REVOKE ALL ON FUNCTION public._branch_setting_keys() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._act_branches() FROM PUBLIC, anon, authenticated, app_rpc;
NOTIFY pgrst, 'reload schema';
