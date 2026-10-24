-- Overbooked v2 — reads for the Zypher console (super_admin only; works across shops).

-- headline numbers for the overview page; "today" is India time
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
    'overdue', (SELECT count(*) FROM public.shops WHERE status = 'active' AND (paid_until IS NULL OR paid_until < v_today)),
    'due_in_7_days', (SELECT count(*) FROM public.shops WHERE status = 'active' AND paid_until BETWEEN v_today AND v_today + 7),
    'units', (SELECT count(*) FROM public.units WHERE status <> 'retired'),
    'rentals_30d', (SELECT count(*) FROM public.rentals WHERE created_at > now() - interval '30 days'),
    'active_logins', (SELECT count(*) FROM public.profiles WHERE is_active AND shop_id IS NOT NULL));
END $$;

-- everything the shop page shows: details, branches, people, open invites, usage, payments, features
CREATE OR REPLACE FUNCTION public.shop_detail(p_shop_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth, pg_catalog AS $$
DECLARE
  v_shop public.shops;
BEGIN
  PERFORM public._require_zypher();
  SELECT * INTO v_shop FROM public.shops WHERE id = p_shop_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shop not found';
  END IF;

  RETURN jsonb_build_object(
    'shop', to_jsonb(v_shop),
    'branches', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'is_active', b.is_active,
                   'phone', b.phone, 'address', b.address,
                   'units', (SELECT count(*) FROM public.units u WHERE u.branch_id = b.id AND u.status <> 'retired'))
                   ORDER BY b.created_at), '[]')
                 FROM public.branches b WHERE b.shop_id = p_shop_id),
    'people', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'role', p.role,
                 'branch', b.name, 'is_active', p.is_active, 'email', u.email, 'last_sign_in_at', u.last_sign_in_at)
                 ORDER BY (p.role = 'owner') DESC, p.full_name), '[]')
               FROM public.profiles p JOIN auth.users u ON u.id = p.id LEFT JOIN public.branches b ON b.id = p.branch_id
               WHERE p.shop_id = p_shop_id),
    'invites', (SELECT COALESCE(jsonb_agg(jsonb_build_object('email', i.email, 'role', i.role, 'branch', b.name,
                  'created_at', i.created_at) ORDER BY i.created_at DESC), '[]')
                FROM public.staff_invites i LEFT JOIN public.branches b ON b.id = i.branch_id
                WHERE i.shop_id = p_shop_id AND i.accepted_at IS NULL),
    'usage', jsonb_build_object(
      'products', (SELECT count(*) FROM public.products WHERE shop_id = p_shop_id AND is_active),
      'units', (SELECT count(*) FROM public.units WHERE shop_id = p_shop_id AND status <> 'retired'),
      'customers', (SELECT count(*) FROM public.customers WHERE shop_id = p_shop_id),
      'rentals', (SELECT count(*) FROM public.rentals WHERE shop_id = p_shop_id),
      'rentals_30d', (SELECT count(*) FROM public.rentals WHERE shop_id = p_shop_id AND created_at > now() - interval '30 days'),
      'open_rentals', (SELECT count(*) FROM public.rentals WHERE shop_id = p_shop_id AND status IN ('reserved', 'active')),
      'last_rental_at', (SELECT max(created_at) FROM public.rentals WHERE shop_id = p_shop_id)),
    'payments', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', sp.id, 'receipt_no', sp.receipt_no, 'kind', sp.kind, 'amount', sp.amount, 'paid_on', sp.paid_on,
                   'period_to', sp.period_to, 'method', sp.method, 'note', sp.note) ORDER BY sp.paid_on DESC, sp.created_at DESC), '[]')
                 FROM public.shop_payments sp WHERE sp.shop_id = p_shop_id),
    -- every switch the shop's templates know about, with its current value
    'features', (SELECT COALESCE(jsonb_object_agg(f.key, public.shop_feature(p_shop_id, f.key)), '{}')
                 FROM (SELECT DISTINCT jsonb_object_keys(t.features) AS key FROM public.business_templates t
                       WHERE t.key = ANY (v_shop.business_types)) f));
END $$;

REVOKE ALL ON FUNCTION public.console_summary(), public.shop_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.console_summary(), public.shop_detail(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
