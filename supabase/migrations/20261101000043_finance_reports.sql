-- Finance reports for launch: Pending bills, Daily cashbook, Income & expense, Product performance.
--   * An expense now says how it was paid (cash, UPI, card, bank transfer) and who was paid, so the cashbook can take
--     a cash expense out of the drawer. Expenses saved before this migration are counted as cash (owner's decision,
--     13 Nov 2026). An expense saved without a method (the cost of a cleaning job, older app versions) is cash too.
--   * Each branch may record the cash in its drawer on a given day (opening_cash, opening_cash_on). From that day the
--     cashbook's cash balance starts at that amount; before it, it is built from the payment records alone.
--     UPI, card and bank balances always start at zero: they are money received, not a drawer.
--   * Security deposits are real cash in the drawer, so the cashbook counts them, on their own lines (not as income).
--   * finance_cashbook, pending_bills and product_performance sum in the database, so a large shop does not load
--     every payment in the browser.
-- Additive: no existing figure changes. The activity log records the new columns.
-- Comes after 20261101000042_branch_bill_details.sql (branch feature/branch-bill-details): _act_branches below is that
-- migration's version (with the branch GSTIN) plus the opening cash, so merge that branch before this one.

-- ==============================================================================
-- Expenses: how it was paid, and to whom
-- ==============================================================================
ALTER TABLE public.expenses
  ADD COLUMN method text NOT NULL DEFAULT 'cash' CHECK (method IN ('cash', 'upi', 'card', 'bank_transfer')),
  ADD COLUMN paid_to text CHECK (paid_to IS NULL OR length(paid_to) <= 80);

-- p = {branch_id, spent_on, category, amount, method, paid_to, note}
CREATE OR REPLACE FUNCTION public.add_expense(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_branch uuid := (p ->> 'branch_id')::uuid;
  v_amount numeric := round(COALESCE((p ->> 'amount')::numeric, 0), 2);
  v_date date := (p ->> 'spent_on')::date;
  v_method text := COALESCE(NULLIF(btrim(p ->> 'method'), ''), 'cash');
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
  IF v_method NOT IN ('cash', 'upi', 'card', 'bank_transfer') THEN
    RAISE EXCEPTION 'Choose how it was paid';
  END IF;
  IF length(btrim(COALESCE(p ->> 'paid_to', ''))) > 80 THEN
    RAISE EXCEPTION 'Paid to is at most 80 characters';
  END IF;
  INSERT INTO public.expenses (shop_id, branch_id, spent_on, category, amount, method, paid_to, note, created_by)
  VALUES (public.current_shop_id(), v_branch, v_date, btrim(p ->> 'category'), v_amount, v_method,
          NULLIF(btrim(p ->> 'paid_to'), ''), NULLIF(btrim(p ->> 'note'), ''), auth.uid())
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
  IF p ? 'method' AND COALESCE(p ->> 'method', '') NOT IN ('cash', 'upi', 'card', 'bank_transfer') THEN
    RAISE EXCEPTION 'Choose how it was paid';
  END IF;
  IF length(btrim(COALESCE(p ->> 'paid_to', ''))) > 80 THEN
    RAISE EXCEPTION 'Paid to is at most 80 characters';
  END IF;
  UPDATE public.expenses SET
    branch_id = COALESCE((p ->> 'branch_id')::uuid, branch_id),
    spent_on = COALESCE((p ->> 'spent_on')::date, spent_on),
    category = COALESCE(NULLIF(btrim(p ->> 'category'), ''), category),
    amount = COALESCE(round((p ->> 'amount')::numeric, 2), amount),
    method = COALESCE(NULLIF(p ->> 'method', ''), method),
    paid_to = CASE WHEN p ? 'paid_to' THEN NULLIF(btrim(p ->> 'paid_to'), '') ELSE paid_to END,
    note = CASE WHEN p ? 'note' THEN NULLIF(btrim(p ->> 'note'), '') ELSE note END
  WHERE id = p_expense_id
  RETURNING * INTO v_new;
  PERFORM public._audit('expenses', p_expense_id, p_reason, to_jsonb(v_old), to_jsonb(v_new));
END $$;

-- the activity log (034's version, with how it was paid and to whom)
CREATE OR REPLACE FUNCTION public._act_expenses()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  e public.expenses%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN e := OLD; ELSE e := NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM public._act_log(e.shop_id, e.branch_id, 'money', 'expense_added', 0, 'expense', e.id, e.category,
      format('Added an expense of %s (%s)%s', public._act_inr(e.amount), e.category, COALESCE(' paid to ' || e.paid_to, '')), false,
      public._act_change('Date', NULL, to_char(e.spent_on, 'FMDD Mon YYYY'))
      || public._act_change('Paid by', NULL, public._act_method(e.method))
      || public._act_change('Paid to', NULL, e.paid_to)
      || public._act_change('Note', NULL, e.note),
      NULL, NULL, COALESCE(auth.uid(), e.created_by));
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM public._act_log(e.shop_id, e.branch_id, 'money', 'expense_changed', 2, 'expense', e.id, e.category,
      format('Corrected an expense of %s (%s)', public._act_inr(e.amount), e.category), true,
      public._act_change('Amount', public._act_inr(OLD.amount), public._act_inr(NEW.amount))
      || public._act_change('Date', to_char(OLD.spent_on, 'FMDD Mon YYYY'), to_char(NEW.spent_on, 'FMDD Mon YYYY'))
      || public._act_change('Category', OLD.category, NEW.category)
      || public._act_change('Paid by', public._act_method(OLD.method), public._act_method(NEW.method))
      || public._act_change('Paid to', OLD.paid_to, NEW.paid_to)
      || public._act_change('Branch', public._act_branch_name(OLD.branch_id), public._act_branch_name(NEW.branch_id))
      || public._act_change('Note', OLD.note, NEW.note));
  ELSE
    PERFORM public._act_log(e.shop_id, e.branch_id, 'money', 'expense_deleted', 3, 'expense', e.id, e.category,
      format('Deleted an expense of %s (%s)', public._act_inr(e.amount), e.category), true, NULL, to_jsonb(OLD));
  END IF;
  RETURN NULL;
END $$;

-- a payment method in plain words, for the activity log
CREATE OR REPLACE FUNCTION public._act_method(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p WHEN 'cash' THEN 'Cash' WHEN 'upi' THEN 'UPI' WHEN 'card' THEN 'Card'
                WHEN 'bank_transfer' THEN 'Bank transfer' ELSE p END;
$$;

-- ==============================================================================
-- Opening cash per branch
-- ==============================================================================
ALTER TABLE public.branches
  ADD COLUMN opening_cash numeric(14,2) CHECK (opening_cash IS NULL OR opening_cash >= 0),
  ADD COLUMN opening_cash_on date,
  ADD CONSTRAINT branches_opening_cash_pair CHECK ((opening_cash IS NULL) = (opening_cash_on IS NULL));

-- the owner records the cash counted in a branch's drawer at the start of a day (NULL amount clears it)
CREATE OR REPLACE FUNCTION public.set_opening_cash(p_branch_id uuid, p_amount numeric, p_on date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  PERFORM public._require_role(ARRAY['super_admin', 'owner']);
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id AND shop_id = public.current_shop_id()) THEN
    RAISE EXCEPTION 'Branch not found';
  END IF;
  IF p_amount IS NOT NULL THEN
    IF p_amount < 0 OR p_amount > 100000000 THEN
      RAISE EXCEPTION 'Enter the cash counted (0 or more)';
    END IF;
    IF p_on IS NULL OR p_on > (now() AT TIME ZONE public._shop_tz())::date THEN
      RAISE EXCEPTION 'Choose the day it was counted (not in the future)';
    END IF;
  END IF;
  UPDATE public.branches
  SET opening_cash = round(p_amount, 2), opening_cash_on = CASE WHEN p_amount IS NULL THEN NULL ELSE p_on END
  WHERE id = p_branch_id;
END $$;

-- the activity log (042_branch_bill_details' version, with the GSTIN, plus the opening cash; a change of it is a money
-- correction, so important)
CREATE OR REPLACE FUNCTION public._act_branches()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_action text := 'branch_changed';
  v_level int := 1;
  v_sum text;
  v_ch jsonb;
  v_cash jsonb;
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
  -- the opening cash is its own entry, under money
  v_cash := public._act_change('Opening cash', public._act_inr(OLD.opening_cash), public._act_inr(NEW.opening_cash))
    || public._act_change('Counted on', to_char(OLD.opening_cash_on, 'FMDD Mon YYYY'), to_char(NEW.opening_cash_on, 'FMDD Mon YYYY'));
  IF v_cash <> '{}'::jsonb THEN
    PERFORM public._act_log(NEW.shop_id, NEW.id, 'money', 'opening_cash_set', 2, 'branch', NEW.id, NEW.name,
      CASE WHEN NEW.opening_cash IS NULL THEN format('Cleared the opening cash of branch %s', NEW.name)
           ELSE format('Set the opening cash of branch %s to %s on %s', NEW.name, public._act_inr(NEW.opening_cash),
                       to_char(NEW.opening_cash_on, 'FMDD Mon YYYY')) END,
      true, v_cash);
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
  -- nothing else changed (only the opening cash): no second entry
  IF v_level = 1 AND v_ch = '{}'::jsonb AND v_cash <> '{}'::jsonb THEN
    RETURN NULL;
  END IF;
  PERFORM public._act_log(NEW.shop_id, NEW.id, 'branches', v_action, v_level, 'branch', NEW.id, NEW.name, v_sum, v_level = 2, v_ch);
  RETURN NULL;
END $$;

-- ==============================================================================
-- Daily cashbook
-- ==============================================================================
-- Money in and out per day and payment method, for the dates asked, and each method's balance at the start of p_from.
--   in:  rent received (payment), deposits received (deposit)
--   out: refunds (refund), deposits given back (deposit_refund), expenses
--   deposit_applied moves no money and is left out.
-- Cash balance of a branch before day D: if the branch counted its drawer on a day <= D, that count plus the cash
-- movements from that day; otherwise every cash movement before D. Other methods: every movement before D.
-- p_branch_id NULL = every branch the caller may see (a manager sees only their own).
CREATE OR REPLACE FUNCTION public.finance_cashbook(p_from date, p_to date, p_branch_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_role text := public._require_role(ARRAY['super_admin', 'owner', 'manager']);
  v_branch uuid := CASE WHEN v_role = 'manager' THEN public.get_my_branch() ELSE p_branch_id END;
  v_shop uuid := public.current_shop_id();
  v_tz text := public._shop_tz();
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'Choose a from date on or before the to date';
  END IF;
  IF p_to - p_from > 366 THEN
    RAISE EXCEPTION 'Choose at most a year';
  END IF;
  RETURN (
    WITH moves AS (
      SELECT r.branch_id, (p.paid_at AT TIME ZONE v_tz)::date AS day, p.method,
             CASE WHEN p.kind = 'payment' THEN p.amount ELSE 0 END AS rent_in,
             CASE WHEN p.kind = 'deposit' THEN p.amount ELSE 0 END AS deposit_in,
             CASE WHEN p.kind = 'refund' THEN p.amount ELSE 0 END AS refund_out,
             CASE WHEN p.kind = 'deposit_refund' THEN p.amount ELSE 0 END AS deposit_out,
             0::numeric AS expense_out
      FROM public.payments p JOIN public.rentals r ON r.id = p.rental_id
      WHERE p.shop_id = v_shop AND p.method IS NOT NULL AND (v_branch IS NULL OR r.branch_id = v_branch)
      UNION ALL
      SELECT e.branch_id, e.spent_on, e.method, 0, 0, 0, 0, e.amount
      FROM public.expenses e
      WHERE e.shop_id = v_shop AND (v_branch IS NULL OR e.branch_id = v_branch)
    ),
    branch AS (
      SELECT b.id, b.opening_cash, b.opening_cash_on FROM public.branches b
      WHERE b.shop_id = v_shop AND (v_branch IS NULL OR b.id = v_branch)
    ),
    -- per branch and method, the balance at the start of p_from
    opening AS (
      SELECT m.method,
             sum(CASE WHEN m.method = 'cash' AND b.opening_cash_on IS NOT NULL AND b.opening_cash_on <= p_from
                           AND m.day < b.opening_cash_on THEN 0
                      ELSE m.rent_in + m.deposit_in - m.refund_out - m.deposit_out - m.expense_out END) AS amount
      FROM moves m JOIN branch b ON b.id = m.branch_id
      WHERE m.day < p_from
      GROUP BY m.method
    ),
    counted AS (
      SELECT COALESCE(sum(opening_cash), 0) AS amount FROM branch
      WHERE opening_cash_on IS NOT NULL AND opening_cash_on <= p_from
    ),
    days AS (
      SELECT m.day, m.method, sum(m.rent_in) AS rent_in, sum(m.deposit_in) AS deposit_in, sum(m.refund_out) AS refund_out,
             sum(m.deposit_out) AS deposit_out, sum(m.expense_out) AS expense_out
      FROM moves m WHERE m.day BETWEEN p_from AND p_to
      GROUP BY m.day, m.method
    ),
    -- a branch that counts its drawer inside the range: from that day its cash restarts at the count
    resets AS (
      SELECT b.opening_cash_on AS day, sum(b.opening_cash) AS amount,
             -- the cash it had by the book just before, which the count replaces
             sum(COALESCE((SELECT sum(m.rent_in + m.deposit_in - m.refund_out - m.deposit_out - m.expense_out)
                           FROM moves m WHERE m.branch_id = b.id AND m.method = 'cash' AND m.day < b.opening_cash_on), 0)) AS book
      FROM branch b
      WHERE b.opening_cash_on > p_from AND b.opening_cash_on <= p_to
      GROUP BY b.opening_cash_on
    )
    SELECT jsonb_build_object(
      'opening', jsonb_build_object(
        'cash', COALESCE((SELECT amount FROM opening WHERE method = 'cash'), 0) + (SELECT amount FROM counted),
        'upi', COALESCE((SELECT amount FROM opening WHERE method = 'upi'), 0),
        'card', COALESCE((SELECT amount FROM opening WHERE method = 'card'), 0),
        'bank_transfer', COALESCE((SELECT amount FROM opening WHERE method = 'bank_transfer'), 0)),
      'days', COALESCE((SELECT jsonb_agg(jsonb_build_object('day', day, 'method', method, 'rent_in', rent_in,
                          'deposit_in', deposit_in, 'refund_out', refund_out, 'deposit_out', deposit_out,
                          'expense_out', expense_out) ORDER BY day, method) FROM days), '[]'),
      -- the cash count of a day replaces what the book said: adjustment = count - book balance
      'cash_counts', COALESCE((SELECT jsonb_agg(jsonb_build_object('day', day, 'amount', amount, 'book', book) ORDER BY day)
                               FROM resets), '[]'))
  );
END $$;

-- ==============================================================================
-- Pending bills
-- ==============================================================================
-- Every booking with money still owed (bill total less what was paid), oldest pickup first.
-- p_from / p_to filter on the pickup day (NULL = no limit). Cancelled bookings owe only their cancellation fee.
CREATE OR REPLACE FUNCTION public.pending_bills(p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_branch_id uuid DEFAULT NULL)
RETURNS TABLE (rental_id uuid, token text, status text, branch_id uuid, customer_name text, customer_phone text,
               start_at timestamptz, end_at timestamptz, total numeric, paid numeric, pending numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_role text := public._require_role(ARRAY['super_admin', 'owner', 'manager']);
  v_branch uuid := CASE WHEN v_role = 'manager' THEN public.get_my_branch() ELSE p_branch_id END;
  v_tz text := public._shop_tz();
BEGIN
  RETURN QUERY
  SELECT r.id, r.token, r.status, r.branch_id, c.full_name, c.phone, r.start_at, r.end_at, r.total, r.paid,
         r.total - r.paid
  FROM public.rentals r JOIN public.customers c ON c.id = r.customer_id
  WHERE r.shop_id = public.current_shop_id()
    AND r.total - r.paid > 0
    AND (v_branch IS NULL OR r.branch_id = v_branch)
    AND (p_from IS NULL OR (r.start_at AT TIME ZONE v_tz)::date >= p_from)
    AND (p_to IS NULL OR (r.start_at AT TIME ZONE v_tz)::date <= p_to)
  ORDER BY r.start_at
  LIMIT 2000;
END $$;

-- ==============================================================================
-- Product performance
-- ==============================================================================
-- Per product, for bookings picked up in the dates (pickup day; NULL = all time) and branch:
--   bookings and pieces that went out (picked up or returned), their rent, the share of the booking discount
--   (the discount spread over the booking's lines by amount), and what it earned (returned bookings, after discount).
CREATE OR REPLACE FUNCTION public.product_performance(p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_branch_id uuid DEFAULT NULL)
RETURNS TABLE (product_id uuid, bookings bigint, pieces bigint, rent numeric, discount numeric, earned numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_role text := public._require_role(ARRAY['super_admin', 'owner', 'manager']);
  v_branch uuid := CASE WHEN v_role = 'manager' THEN public.get_my_branch() ELSE p_branch_id END;
  v_tz text := public._shop_tz();
BEGIN
  RETURN QUERY
  WITH lines AS (
    SELECT l.product_id, l.rental_id, l.qty, l.amount, r.status,
           CASE WHEN r.items_total > 0 THEN round(r.discount * l.amount / r.items_total, 2) ELSE 0 END AS share
    FROM public.rental_lines l JOIN public.rentals r ON r.id = l.rental_id
    WHERE r.shop_id = public.current_shop_id() AND r.status IN ('active', 'completed')
      AND (v_branch IS NULL OR r.branch_id = v_branch)
      AND (p_from IS NULL OR (r.start_at AT TIME ZONE v_tz)::date >= p_from)
      AND (p_to IS NULL OR (r.start_at AT TIME ZONE v_tz)::date <= p_to)
  )
  SELECT x.product_id, count(DISTINCT x.rental_id), COALESCE(sum(x.qty), 0)::bigint, COALESCE(sum(x.amount), 0),
         COALESCE(sum(x.share), 0), COALESCE(sum(x.amount - x.share) FILTER (WHERE x.status = 'completed'), 0)
  FROM lines x
  GROUP BY x.product_id;
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.add_expense(jsonb)', 'public.update_expense(uuid, jsonb, text)',
                           'public.set_opening_cash(uuid, numeric, date)', 'public.finance_cashbook(date, date, uuid)',
                           'public.pending_bills(date, date, uuid)', 'public.product_performance(date, date, uuid)']
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO app_rpc', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public._act_expenses(), public._act_branches(), public._act_method(text) FROM PUBLIC, anon, authenticated, app_rpc;

NOTIFY pgrst, 'reload schema';
