-- The console shows a shop's trial: platform_overview returns trial_ends, and a shop inside its trial is not counted as overdue.

DROP FUNCTION public.platform_overview();
CREATE FUNCTION public.platform_overview()
RETURNS TABLE (shop_id uuid, name text, slug text, token_prefix text, business_types text[], plan text, status text,
               phone text, monthly_fee numeric, paid_until date, last_payment_on date, last_payment_amount numeric, branches bigint, active_logins bigint,
               units bigint, rentals_30d bigint, created_at timestamptz, trial_ends date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  PERFORM public._require_zypher();
  RETURN QUERY
  SELECT s.id, s.name, s.slug, s.token_prefix, s.business_types, s.plan, s.status, s.phone, s.monthly_fee, s.paid_until,
         lp.paid_on, lp.amount,
         (SELECT count(*) FROM public.branches b WHERE b.shop_id = s.id AND b.is_active),
         (SELECT count(*) FROM public.profiles pr WHERE pr.shop_id = s.id AND pr.is_active),
         (SELECT count(*) FROM public.units u WHERE u.shop_id = s.id AND u.status <> 'retired'),
         (SELECT count(*) FROM public.rentals r WHERE r.shop_id = s.id AND r.created_at > now() - interval '30 days'),
         s.created_at, s.trial_ends
  FROM public.shops s
  LEFT JOIN LATERAL (SELECT sp.paid_on, sp.amount FROM public.shop_payments sp WHERE sp.shop_id = s.id
                     ORDER BY sp.paid_on DESC, sp.created_at DESC LIMIT 1) lp ON true
  ORDER BY s.name;
END $$;
REVOKE ALL ON FUNCTION public.platform_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_overview() TO authenticated;

CREATE OR REPLACE FUNCTION public.console_summary()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  PERFORM public._require_zypher();
  RETURN jsonb_build_object(
    'today', v_today,
    'shops_active', (SELECT count(*) FROM public.shops WHERE status = 'active'),
    'shops_paused', (SELECT count(*) FROM public.shops WHERE status = 'suspended'),
    'monthly_due', (SELECT COALESCE(sum(monthly_fee), 0) FROM public.shops WHERE status = 'active'),
    'collected_this_month', (SELECT COALESCE(sum(amount), 0) FROM public.shop_payments
                             WHERE paid_on >= date_trunc('month', v_today)::date),
    'overdue', (SELECT count(*) FROM public.shops WHERE status = 'active' AND (paid_until IS NULL OR paid_until < v_today)
                  AND (trial_ends IS NULL OR trial_ends < v_today)),
    'in_trial', (SELECT count(*) FROM public.shops WHERE status = 'active' AND trial_ends >= v_today
                   AND (paid_until IS NULL OR paid_until < v_today)),
    'due_in_7_days', (SELECT count(*) FROM public.shops WHERE status = 'active' AND paid_until BETWEEN v_today AND v_today + 7),
    'units', (SELECT count(*) FROM public.units WHERE status <> 'retired'),
    'rentals_30d', (SELECT count(*) FROM public.rentals WHERE created_at > now() - interval '30 days'),
    'active_logins', (SELECT count(*) FROM public.profiles WHERE is_active AND shop_id IS NOT NULL));
END $$;
NOTIFY pgrst, 'reload schema';
