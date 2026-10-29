-- Expenses: money going out of the shop (rent, salaries, dry-cleaning, tailoring ...), so Finance can show profit.
--   Profit = earned (from the money records) - expenses, for the chosen dates and branch.
-- The owner and a branch manager add expenses; only the owner changes or deletes one (each is written to the audit log).
-- Staff do not see expenses. The table is written only through the functions below.

CREATE TABLE public.expenses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     uuid NOT NULL REFERENCES public.shops(id),
  branch_id   uuid NOT NULL,
  spent_on    date NOT NULL,
  category    text NOT NULL CHECK (length(btrim(category)) BETWEEN 1 AND 60),
  amount      numeric(14,2) NOT NULL CHECK (amount > 0),
  note        text,
  created_by  uuid REFERENCES public.profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expenses_shop_id_id_key UNIQUE (shop_id, id),
  CONSTRAINT expenses_shop_branch_fkey FOREIGN KEY (shop_id, branch_id) REFERENCES public.branches (shop_id, id)
);
CREATE INDEX idx_expenses_shop_date ON public.expenses (shop_id, spent_on DESC);
CREATE INDEX idx_expenses_branch ON public.expenses (shop_id, branch_id, spent_on DESC);

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_isolation ON public.expenses AS RESTRICTIVE FOR ALL
  USING (shop_id = (SELECT public.current_shop_id())) WITH CHECK (shop_id = (SELECT public.current_shop_id()));
CREATE POLICY rpc_all ON public.expenses FOR ALL TO app_rpc USING (true) WITH CHECK (true);
CREATE POLICY expenses_read ON public.expenses FOR SELECT
  USING ((SELECT public.get_my_role()) IN ('super_admin', 'owner')
         OR ((SELECT public.get_my_role()) = 'manager' AND branch_id = (SELECT public.get_my_branch())));
REVOKE ALL ON public.expenses FROM authenticated;
GRANT SELECT ON public.expenses TO authenticated;

CREATE TRIGGER trg_touch_expenses BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- p = {branch_id, spent_on, category, amount, note}
CREATE OR REPLACE FUNCTION public.add_expense(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_branch uuid := (p ->> 'branch_id')::uuid;
  v_amount numeric := round(COALESCE((p ->> 'amount')::numeric, 0), 2);
  v_date date := (p ->> 'spent_on')::date;
  v_id uuid;
BEGIN
  PERFORM public._require_role(ARRAY['super_admin', 'owner', 'manager']);
  PERFORM public._require_branch(v_branch);
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id = v_branch) THEN
    RAISE EXCEPTION 'Choose a branch';
  END IF;
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Enter an amount above zero';
  END IF;
  IF v_date IS NULL OR v_date > (now() AT TIME ZONE public._shop_tz())::date THEN
    RAISE EXCEPTION 'Choose the date it was spent (not in the future)';
  END IF;
  IF NULLIF(btrim(p ->> 'category'), '') IS NULL THEN
    RAISE EXCEPTION 'Choose a category';
  END IF;
  INSERT INTO public.expenses (shop_id, branch_id, spent_on, category, amount, note, created_by)
  VALUES (public.current_shop_id(), v_branch, v_date, btrim(p ->> 'category'), v_amount, NULLIF(btrim(p ->> 'note'), ''), auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- the owner corrects an expense, with a reason (kept in the audit log)
CREATE OR REPLACE FUNCTION public.update_expense(p_expense_id uuid, p jsonb, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_old public.expenses;
  v_new public.expenses;
BEGIN
  PERFORM public._require_role(ARRAY['super_admin', 'owner']);
  PERFORM public._require_correction(p_reason);
  SELECT * INTO v_old FROM public.expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;
  UPDATE public.expenses SET
    branch_id = COALESCE((p ->> 'branch_id')::uuid, branch_id),
    spent_on = COALESCE((p ->> 'spent_on')::date, spent_on),
    category = COALESCE(NULLIF(btrim(p ->> 'category'), ''), category),
    amount = COALESCE(round((p ->> 'amount')::numeric, 2), amount),
    note = CASE WHEN p ? 'note' THEN NULLIF(btrim(p ->> 'note'), '') ELSE note END
  WHERE id = p_expense_id
  RETURNING * INTO v_new;
  PERFORM public._audit('expenses', p_expense_id, p_reason, to_jsonb(v_old), to_jsonb(v_new));
END $$;

CREATE OR REPLACE FUNCTION public.delete_expense(p_expense_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_old public.expenses;
BEGIN
  PERFORM public._require_role(ARRAY['super_admin', 'owner']);
  PERFORM public._require_correction(p_reason);
  SELECT * INTO v_old FROM public.expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;
  DELETE FROM public.expenses WHERE id = p_expense_id;
  PERFORM public._audit('expenses', p_expense_id, p_reason, to_jsonb(v_old), NULL);
END $$;

-- totals for Finance: p_branch NULL = every branch the caller may see
CREATE OR REPLACE FUNCTION public.expense_summary(p_from date, p_to date, p_branch_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_role text := public._require_role(ARRAY['super_admin', 'owner', 'manager']);
  v_branch uuid := CASE WHEN v_role = 'manager' THEN public.get_my_branch() ELSE p_branch_id END;
BEGIN
  RETURN jsonb_build_object(
    'total', COALESCE((SELECT sum(amount) FROM public.expenses
                       WHERE spent_on BETWEEN p_from AND p_to AND (v_branch IS NULL OR branch_id = v_branch)), 0),
    'by_category', COALESCE((SELECT jsonb_agg(jsonb_build_object('category', category, 'amount', amt) ORDER BY amt DESC)
                             FROM (SELECT category, sum(amount) AS amt FROM public.expenses
                                   WHERE spent_on BETWEEN p_from AND p_to AND (v_branch IS NULL OR branch_id = v_branch)
                                   GROUP BY category) c), '[]'));
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.add_expense(jsonb)', 'public.update_expense(uuid, jsonb, text)',
                           'public.delete_expense(uuid, text)', 'public.expense_summary(date, date, uuid)']
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO app_rpc', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
