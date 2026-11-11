-- Staff controls and voiding payments (launch pack 1, part C; docs/LAUNCH_PACK_1_PLAN.md).
--   * Shop settings, all shop-wide, whose defaults are today's behaviour:
--       discount_limit_staff / discount_limit_manager  most discount (%) without the owner; empty = no limit (today)
--       void_payment_role          owner (default) | owner_manager
--       waive_late_fee_role        everyone (default) | owner_manager | owner: who may lower the suggested late fee at return
--       cancel_paid_role           everyone (default) | owner_manager: who may cancel a booking that has money on it
--       early_deposit_refund_role  owner (default) | owner_manager: who may give a deposit back before the return
--       backdate_return_hours      2 (default) | 6 | 24: a return time further back needs a manager or the owner
--     All are checked in the database. Over a limit the action is refused with a plain message.
--   * Voiding a payment: the row stays, marked void with who, when and why; totals, Finance and the dashboard leave it
--     out. void_payment() can also enter the correct payment in the same step. Deleting a payment is no longer offered in
--     the app (admin_delete_payment stays for the console and old clients).
-- Unchanged: support logins (a support login still cannot change or void money records), every other function.

ALTER TABLE public.payments
  ADD COLUMN voided_at timestamptz,
  ADD COLUMN voided_by uuid REFERENCES public.profiles(id),
  ADD COLUMN void_reason text,
  ADD CONSTRAINT payments_void_complete CHECK ((voided_at IS NULL) = (void_reason IS NULL));

-- ------------------------------------------------------------------------------
-- settings
-- ------------------------------------------------------------------------------
-- every key update_my_shop accepts, in one place (plan and features are Zypher's and dropped by update_my_shop)
CREATE OR REPLACE FUNCTION public._shop_setting_keys()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public, pg_catalog AS $$
  SELECT ARRAY['grace_minutes', 'check_in_time', 'check_out_time', 'require_licence', 'gst_percent', 'receipt_note',
               'sac_code', 'plan', 'features',
               'late_fee_on', 'late_fee_mode', 'late_fee_percent', 'late_fee_fixed', 'late_fee_basis',
               'late_cutoff_time', 'late_day_count', 'late_cap', 'late_cap_percent', 'late_clash_action',
               'discount_limit_staff', 'discount_limit_manager', 'void_payment_role', 'waive_late_fee_role',
               'cancel_paid_role', 'early_deposit_refund_role', 'backdate_return_hours'];
$$;

-- 038's version, plus the staff controls
CREATE OR REPLACE FUNCTION public._settings_check(s jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_catalog AS $$
DECLARE
  k text;
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
  FOREACH k IN ARRAY ARRAY['discount_limit_staff', 'discount_limit_manager'] LOOP
    IF s ? k AND jsonb_typeof(s -> k) <> 'null' AND (jsonb_typeof(s -> k) <> 'number' OR (s ->> k)::numeric NOT BETWEEN 0 AND 100) THEN
      RAISE EXCEPTION 'A discount limit is 0 to 100 percent, or empty for no limit';
    END IF;
  END LOOP;
  IF s ? 'void_payment_role' AND s ->> 'void_payment_role' NOT IN ('owner', 'owner_manager') THEN
    RAISE EXCEPTION 'Voiding a payment is for the owner, or the owner and managers';
  END IF;
  IF s ? 'waive_late_fee_role' AND s ->> 'waive_late_fee_role' NOT IN ('everyone', 'owner_manager', 'owner') THEN
    RAISE EXCEPTION 'Lowering a late fee is for everyone, the owner and managers, or the owner';
  END IF;
  IF s ? 'cancel_paid_role' AND s ->> 'cancel_paid_role' NOT IN ('everyone', 'owner_manager') THEN
    RAISE EXCEPTION 'Cancelling a paid booking is for everyone, or the owner and managers';
  END IF;
  IF s ? 'early_deposit_refund_role' AND s ->> 'early_deposit_refund_role' NOT IN ('owner', 'owner_manager') THEN
    RAISE EXCEPTION 'Giving a deposit back early is for the owner, or the owner and managers';
  END IF;
  IF s ? 'backdate_return_hours' AND COALESCE(s ->> 'backdate_return_hours', '') NOT IN ('2', '6', '24') THEN
    RAISE EXCEPTION 'The back-dated return limit is 2, 6 or 24 hours';
  END IF;
END $$;

-- 038's version; the allowed keys now come from _shop_setting_keys()
CREATE OR REPLACE FUNCTION public.update_my_shop(p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid;
  v_bad text;
BEGIN
  PERFORM public._require_role(ARRAY['super_admin', 'owner']);
  v_shop := public.current_shop_id();
  IF jsonb_typeof(p -> 'settings') = 'object' THEN
    SELECT k INTO v_bad FROM jsonb_object_keys(p -> 'settings') k WHERE k <> ALL (public._shop_setting_keys()) LIMIT 1;
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

-- does the shop's rule let the person signed in do this? ('everyone', 'owner_manager' or 'owner')
CREATE OR REPLACE FUNCTION public._rule_allows(p_key text, p_default text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT CASE public._shop_rule(public.current_shop_id(), p_key, p_default)
           WHEN 'everyone' THEN true
           WHEN 'owner_manager' THEN COALESCE(public.get_my_role() IN ('super_admin', 'owner', 'manager'), false)
           ELSE COALESCE(public.get_my_role() IN ('super_admin', 'owner'), false) END;
$$;

-- ------------------------------------------------------------------------------
-- voided payments are left out of every total
-- ------------------------------------------------------------------------------
-- 002's version
CREATE OR REPLACE FUNCTION public.recompute_rental_money(p_rental_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  UPDATE public.rentals r SET
    items_total      = COALESCE((SELECT sum(amount) FROM public.rental_lines WHERE rental_id = r.id), 0),
    add_ons_total    = COALESCE((SELECT sum(amount) FROM public.rental_add_ons WHERE rental_id = r.id), 0),
    charges_total    = COALESCE((SELECT sum(amount) FROM public.rental_charges WHERE rental_id = r.id), 0),
    paid             = COALESCE((SELECT sum(CASE kind WHEN 'payment' THEN amount WHEN 'deposit_applied' THEN amount
                                                    WHEN 'refund' THEN -amount ELSE 0 END)
                                 FROM public.payments WHERE rental_id = r.id AND voided_at IS NULL), 0),
    deposit_received = COALESCE((SELECT sum(amount) FROM public.payments WHERE rental_id = r.id AND kind = 'deposit' AND voided_at IS NULL), 0),
    deposit_refunded = COALESCE((SELECT sum(amount) FROM public.payments WHERE rental_id = r.id AND kind = 'deposit_refund' AND voided_at IS NULL), 0),
    deposit_applied  = COALESCE((SELECT sum(amount) FROM public.payments WHERE rental_id = r.id AND kind = 'deposit_applied' AND voided_at IS NULL), 0),
    updated_at       = now()
  WHERE r.id = p_rental_id;
$$;

-- 007's version
CREATE OR REPLACE FUNCTION public.dashboard_summary(p_from date, p_to date, p_branch_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_role text;
  v_branch uuid := p_branch_id;
  v_tz text := public._shop_tz();
  v_from timestamptz;
  v_to timestamptz;
BEGIN
  v_role := public._require_role(ARRAY['super_admin', 'owner', 'manager']);
  IF v_role = 'manager' THEN
    v_branch := public.get_my_branch();
  END IF;
  v_from := (p_from::timestamp AT TIME ZONE v_tz);
  v_to := ((p_to + 1)::timestamp AT TIME ZONE v_tz);

  RETURN (
    SELECT jsonb_build_object(
      'rentals', (SELECT count(*) FROM public.rentals r WHERE r.start_at >= v_from AND r.start_at < v_to
                    AND (v_branch IS NULL OR r.branch_id = v_branch) AND r.status NOT IN ('cancelled', 'no_show')),
      'revenue', (SELECT COALESCE(sum(r.total), 0) FROM public.rentals r WHERE r.start_at >= v_from AND r.start_at < v_to
                    AND (v_branch IS NULL OR r.branch_id = v_branch)),
      'balance_due', (SELECT COALESCE(sum(r.total - r.paid), 0) FROM public.rentals r WHERE r.start_at >= v_from AND r.start_at < v_to
                    AND (v_branch IS NULL OR r.branch_id = v_branch)),
      'collected', (SELECT COALESCE(sum(CASE p.kind WHEN 'payment' THEN p.amount WHEN 'refund' THEN -p.amount ELSE 0 END), 0)
                    FROM public.payments p JOIN public.rentals r ON r.id = p.rental_id
                    WHERE p.voided_at IS NULL AND p.paid_at >= v_from AND p.paid_at < v_to AND (v_branch IS NULL OR r.branch_id = v_branch)),
      'deposit_kept', (SELECT COALESCE(sum(p.amount), 0) FROM public.payments p JOIN public.rentals r ON r.id = p.rental_id
                    WHERE p.voided_at IS NULL AND p.kind = 'deposit_applied' AND p.paid_at >= v_from AND p.paid_at < v_to
                      AND (v_branch IS NULL OR r.branch_id = v_branch)),
      'deposits_held_now', (SELECT COALESCE(sum(r.deposit_received - r.deposit_refunded - r.deposit_applied), 0) FROM public.rentals r
                    WHERE (v_branch IS NULL OR r.branch_id = v_branch)),
      'by_method', (SELECT COALESCE(jsonb_object_agg(m.method, m.amount), '{}') FROM (
                      SELECT p.method, sum(CASE p.kind WHEN 'refund' THEN -p.amount WHEN 'deposit_refund' THEN -p.amount ELSE p.amount END) AS amount
                      FROM public.payments p JOIN public.rentals r ON r.id = p.rental_id
                      WHERE p.voided_at IS NULL AND p.method IS NOT NULL AND p.paid_at >= v_from AND p.paid_at < v_to
                        AND (v_branch IS NULL OR r.branch_id = v_branch)
                      GROUP BY p.method) m)));
END $$;

-- ------------------------------------------------------------------------------
-- voiding a payment (optionally with the correct one entered in the same step)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.void_payment(p_payment_id uuid, p_reason text, p_replacement jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_p public.payments;
  v_r public.rentals;
  v_amount numeric;
  v_method text;
BEGIN
  PERFORM public._require_role(ARRAY['super_admin', 'owner', 'manager']);
  IF public.is_support() THEN
    RAISE EXCEPTION 'A Zypher support login cannot change or delete money records';
  END IF;
  IF NOT public._rule_allows('void_payment_role', 'owner') THEN
    RAISE EXCEPTION 'Only the owner can void a payment (the owner can let managers do it in Settings)';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'A reason (at least 3 characters) is required';
  END IF;
  SELECT * INTO v_p FROM public.payments WHERE id = p_payment_id AND shop_id = public.current_shop_id() FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;
  SELECT * INTO v_r FROM public.rentals WHERE id = v_p.rental_id;
  PERFORM public._require_branch(v_r.branch_id);
  IF v_p.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'This payment is already void';
  END IF;

  PERFORM set_config('app.audit_reason', btrim(p_reason), true);
  BEGIN
    UPDATE public.payments SET voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason) WHERE id = p_payment_id;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'Voiding it would leave the booking overpaid or more deposit given back than received. Void the later refund first';
  END;
  PERFORM public._audit('payments', p_payment_id, p_reason, to_jsonb(v_p), jsonb_build_object('voided', true));

  IF p_replacement IS NOT NULL THEN
    v_amount := (p_replacement ->> 'amount')::numeric;
    v_method := CASE WHEN v_p.kind = 'deposit_applied' THEN NULL ELSE p_replacement ->> 'method' END;
    IF v_amount IS NULL OR v_amount <= 0 OR v_amount <> round(v_amount, 2) THEN
      RAISE EXCEPTION 'Enter the correct amount, above zero, in rupees and paise';
    END IF;
    IF v_p.kind <> 'deposit_applied' AND (v_method IS NULL OR v_method NOT IN ('cash', 'upi', 'card', 'bank_transfer')) THEN
      RAISE EXCEPTION 'Choose how the money was paid (cash, UPI, card or bank transfer)';
    END IF;
    BEGIN
      INSERT INTO public.payments (shop_id, rental_id, kind, amount, method, paid_at, note, recorded_by)
      VALUES (v_p.shop_id, v_p.rental_id, v_p.kind, v_amount, v_method, v_p.paid_at,
              left('Corrected: ' || btrim(p_reason), 300), auth.uid());
    EXCEPTION WHEN check_violation THEN
      RAISE EXCEPTION 'The correct amount is more than the balance due or the deposit held';
    END;
  END IF;
  RETURN (SELECT jsonb_build_object('total', total, 'paid', paid, 'balance', total - paid) FROM public.rentals WHERE id = v_p.rental_id);
END $$;

-- 034's version, plus the void
CREATE OR REPLACE FUNCTION public._act_payments()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  p public.payments%ROWTYPE;
  r public.rentals%ROWTYPE;
  v_tz text;
  v_amt text;
  v_sum text;
BEGIN
  IF TG_OP = 'DELETE' THEN p := OLD; ELSE p := NEW; END IF;
  SELECT * INTO r FROM public.rentals WHERE id = p.rental_id;
  v_tz := public._act_tz(p.shop_id);
  v_amt := public._act_inr(p.amount);

  IF TG_OP = 'INSERT' THEN
    v_sum := CASE p.kind
      WHEN 'payment' THEN format('Received a payment of %s (%s) for booking %s', v_amt, public._act_method(p.method), r.token)
      WHEN 'refund' THEN format('Refunded %s (%s) on booking %s', v_amt, public._act_method(p.method), r.token)
      WHEN 'deposit' THEN format('Received a security deposit of %s (%s) for booking %s', v_amt, public._act_method(p.method), r.token)
      WHEN 'deposit_refund' THEN format('Returned %s of the security deposit (%s) on booking %s', v_amt, public._act_method(p.method), r.token)
      WHEN 'deposit_applied' THEN format('Used %s of the security deposit toward the bill of booking %s', v_amt, r.token)
      ELSE format('Recorded %s on booking %s', v_amt, r.token) END;
    PERFORM public._act_log(p.shop_id, r.branch_id, 'money', 'payment_' || p.kind, 2, 'payment', p.id, r.token, v_sum,
                            false, public._act_change('Note', NULL, p.note), NULL, NULL, p.recorded_by);
  ELSIF TG_OP = 'UPDATE' AND NEW.voided_at IS NOT NULL AND OLD.voided_at IS NULL THEN
    PERFORM public._act_log(p.shop_id, r.branch_id, 'money', 'payment_voided', 2, 'payment', p.id, r.token,
      format('Voided a %s of %s (%s) on booking %s', public._act_pay_kind(p.kind), v_amt, public._act_method(p.method), r.token),
      true, NULL, NULL, NEW.void_reason);
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM public._act_log(p.shop_id, r.branch_id, 'money', 'payment_changed', 2, 'payment', p.id, r.token,
      format('Corrected a %s on booking %s', public._act_pay_kind(p.kind), r.token), true,
      public._act_change('Amount', public._act_inr(OLD.amount), public._act_inr(NEW.amount))
      || public._act_change('Type', public._act_words(public._act_pay_kind(OLD.kind)), public._act_words(public._act_pay_kind(NEW.kind)))
      || public._act_change('Paid by', public._act_method(OLD.method), public._act_method(NEW.method))
      || public._act_change('Date', public._act_when(OLD.paid_at, v_tz), public._act_when(NEW.paid_at, v_tz))
      || public._act_change('Note', OLD.note, NEW.note));
  ELSE
    PERFORM public._act_log(p.shop_id, r.branch_id, 'money', 'payment_deleted', 3, 'payment', p.id, r.token,
      format('Deleted a %s of %s (%s) from booking %s', public._act_pay_kind(p.kind), v_amt, public._act_method(p.method), COALESCE(r.token, '—')),
      true, NULL, to_jsonb(OLD));
  END IF;
  RETURN NULL;
END $$;

-- ------------------------------------------------------------------------------
-- a deposit given back before the return (022's version; the owner can let managers do it)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_rental_payment(p_rental_id uuid, p_kind text, p_amount numeric, p_method text DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_r RECORD;
BEGIN
  PERFORM public._require_role();
  SELECT * INTO v_r FROM public.rentals WHERE id = p_rental_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental not found';
  END IF;
  PERFORM public._require_branch(v_r.branch_id);
  IF p_kind NOT IN ('payment', 'deposit', 'deposit_refund', 'deposit_applied') THEN
    RAISE EXCEPTION 'Unknown payment type: %', p_kind;
  END IF;
  IF v_r.status IN ('cancelled', 'no_show') AND p_kind <> 'deposit_refund' THEN
    RAISE EXCEPTION 'This rental is cancelled';
  END IF;
  IF p_kind = 'deposit_refund' AND v_r.status IN ('reserved', 'active') AND NOT public._rule_allows('early_deposit_refund_role', 'owner') THEN
    RAISE EXCEPTION 'The deposit is given back when the rental is returned or cancelled. Only % can give it back earlier',
      CASE public._shop_rule(public.current_shop_id(), 'early_deposit_refund_role', 'owner') WHEN 'owner_manager' THEN 'the owner or a manager' ELSE 'the owner' END;
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Enter an amount above zero';
  END IF;
  PERFORM public._insert_payment(p_rental_id, p_kind, p_amount, p_method, p_note);
  RETURN (SELECT jsonb_build_object('total', total, 'paid', paid, 'balance', total - paid,
                                    'deposit_held', deposit_received - deposit_refunded - deposit_applied)
          FROM public.rentals WHERE id = p_rental_id);
END $$;

-- ------------------------------------------------------------------------------
-- the return: back-dated limit and lowering the suggested late fee (022's wrapper)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_rental(p_rental_id uuid, p jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_returned timestamptz := COALESCE((p ->> 'returned_at')::timestamptz, now());
  v_hours integer := public._shop_rule(public.current_shop_id(), 'backdate_return_hours', '2')::integer;
  v_suggested numeric;
  v_given numeric;
BEGIN
  PERFORM public._require_role();
  IF v_returned < now() - make_interval(hours => v_hours) THEN
    IF public.get_my_role() NOT IN ('super_admin', 'owner', 'manager') THEN
      RAISE EXCEPTION 'A return time more than % hours ago needs a manager or the owner', v_hours;
    END IF;
    INSERT INTO public.audit_log (shop_id, performed_by, via, action, table_name, record_id, reason, new_data)
    VALUES (public.current_shop_id(), auth.uid(), 'app', 'update', 'rentals', p_rental_id,
            'Return recorded for an earlier time', jsonb_build_object('returned_at', v_returned));
  END IF;
  IF NOT public._rule_allows('waive_late_fee_role', 'everyone') THEN
    SELECT COALESCE(sum((c ->> 'amount')::numeric), 0) INTO v_suggested
    FROM jsonb_array_elements(public.return_suggestions(p_rental_id, v_returned) -> 'charges') c WHERE c ->> 'type' = 'late';
    SELECT COALESCE(sum((c ->> 'amount')::numeric), 0) INTO v_given
    FROM jsonb_array_elements(COALESCE(p -> 'charges', '[]')) c WHERE c ->> 'type' = 'late';
    IF v_given < v_suggested - 0.004 THEN
      -- (the activity formatters are not open to app_rpc, so the amount is formatted here)
      RAISE EXCEPTION 'The suggested late fee is ₹%. Lowering or removing it needs %', to_char(v_suggested, 'FM999999990.00'),
        CASE public._shop_rule(public.current_shop_id(), 'waive_late_fee_role', 'everyone') WHEN 'owner' THEN 'the owner' ELSE 'a manager or the owner' END;
    END IF;
  END IF;
  RETURN public._complete_rental_core(p_rental_id, p);
END $$;

-- ------------------------------------------------------------------------------
-- cancelling a booking that has money on it (a wrapper, like start_rental in 037)
-- ------------------------------------------------------------------------------
ALTER FUNCTION public.cancel_rental(uuid, numeric, text, text, boolean) RENAME TO _cancel_rental_core;

CREATE OR REPLACE FUNCTION public.cancel_rental(p_rental_id uuid, p_fee numeric DEFAULT 0, p_refund_method text DEFAULT NULL,
                                                p_reason text DEFAULT NULL, p_no_show boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  PERFORM public._require_role();
  IF EXISTS (SELECT 1 FROM public.rentals WHERE id = p_rental_id AND (paid > 0 OR deposit_received > deposit_refunded))
     AND NOT public._rule_allows('cancel_paid_role', 'everyone') THEN
    RAISE EXCEPTION 'This booking has money paid on it. Cancelling it needs a manager or the owner';
  END IF;
  RETURN public._cancel_rental_core(p_rental_id, p_fee, p_refund_method, p_reason, p_no_show);
END $$;

-- ------------------------------------------------------------------------------
-- discount limits: checked when the booking is saved, on the discount and on prices agreed below the list price
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._check_discount_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  -- read through jsonb: a booking row has no rental_id and a line row's id is not the booking's
  v_rental uuid := (to_jsonb(NEW) ->> CASE TG_TABLE_NAME WHEN 'rentals' THEN 'id' ELSE 'rental_id' END)::uuid;
  v_role text := public.get_my_role();
  v_limit numeric;
  v_list numeric;
  v_given numeric;
BEGIN
  IF auth.uid() IS NULL OR v_role IS NULL OR v_role IN ('super_admin', 'owner') THEN
    RETURN NULL;
  END IF;
  v_limit := public._shop_rule(NEW.shop_id, CASE v_role WHEN 'manager' THEN 'discount_limit_manager' ELSE 'discount_limit_staff' END, NULL)::numeric;
  IF v_limit IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT COALESCE(sum(round(rate * time_units * qty, 2)), 0),
         COALESCE(sum(GREATEST(0, round(rate * time_units * qty, 2) - amount)) FILTER (WHERE is_override), 0)
  INTO v_list, v_given FROM public.rental_lines WHERE rental_id = v_rental;
  SELECT v_list + add_ons_total, v_given + discount INTO v_list, v_given FROM public.rentals WHERE id = v_rental;
  IF v_list > 0 AND v_given > round(v_list * v_limit / 100, 2) + 0.004 THEN
    RAISE EXCEPTION 'A discount of % (with prices agreed below the list price) is more than % of the price. That needs %',
      public._act_inr(v_given), v_limit || '%', CASE v_role WHEN 'manager' THEN 'the owner' ELSE 'a manager or the owner' END;
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER trg_discount_limit_new AFTER INSERT ON public.rentals DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.discount > 0) EXECUTE FUNCTION public._check_discount_limit();
CREATE CONSTRAINT TRIGGER trg_discount_limit_change AFTER UPDATE OF discount ON public.rentals DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.discount > OLD.discount) EXECUTE FUNCTION public._check_discount_limit();
CREATE CONSTRAINT TRIGGER trg_discount_limit_line_new AFTER INSERT ON public.rental_lines DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.is_override) EXECUTE FUNCTION public._check_discount_limit();
CREATE CONSTRAINT TRIGGER trg_discount_limit_line_change AFTER UPDATE OF amount, is_override ON public.rental_lines DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.is_override AND (NEW.amount < OLD.amount OR NOT OLD.is_override)) EXECUTE FUNCTION public._check_discount_limit();

-- ------------------------------------------------------------------------------
-- who may call what
-- ------------------------------------------------------------------------------
ALTER FUNCTION public.cancel_rental(uuid, numeric, text, text, boolean) OWNER TO app_rpc;
ALTER FUNCTION public._cancel_rental_core(uuid, numeric, text, text, boolean) OWNER TO app_rpc;
REVOKE ALL ON FUNCTION public.cancel_rental(uuid, numeric, text, text, boolean), public._cancel_rental_core(uuid, numeric, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_rental(uuid, numeric, text, text, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public._shop_setting_keys(), public._rule_allows(text, text), public._check_discount_limit()
  FROM PUBLIC, anon, authenticated;
-- record_rental_payment, complete_rental and cancel_rental run as app_rpc
GRANT EXECUTE ON FUNCTION public._rule_allows(text, text), public._shop_rule(uuid, text, text) TO app_rpc;
REVOKE ALL ON FUNCTION public._act_payments() FROM PUBLIC, anon, authenticated, app_rpc;
REVOKE ALL ON FUNCTION public.void_payment(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_payment(uuid, text, jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
