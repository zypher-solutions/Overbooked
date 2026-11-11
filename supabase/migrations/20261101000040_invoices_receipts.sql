-- Invoices, receipts and credit notes (launch pack 1, part D; docs/LAUNCH_PACK_1_PLAN.md).
--   * Invoice timing (setting invoice_timing): 'after_return' (the old rule, default for existing shops) or 'at_booking'
--     (default for new clothing shops). A tax invoice is issued only by issue_invoice(), from a button; printing never
--     issues one. The SAC code is asked for at issue, not in settings.
--   * Once a booking has a tax invoice its amount cannot be lowered in place: a credit note does it (issue_credit_note).
--     Cancelling an invoiced booking makes the credit note by itself. When a returned booking ends up above what was
--     billed (late fee, damage, an extension), a supplementary bill is made by itself for the difference.
--   * Every payment gets a receipt number (payments.receipt_no); payments made before this migration are numbered here.
--   * Settings for the bill: editable terms, "advance is kept when a booking is cancelled", bank details for record
--     (bank name, account holder, last 4 digits only, IFSC). A full account number is never asked for or stored.
-- Document numbers: PREFIX-C/2627/0001 (credit note), PREFIX-S/... (supplementary bill), PREFIX-R/... (receipt); when that is
-- longer than the 16 characters GST allows (a 6-letter prefix), the prefix is left out: C2627/0001.
-- Unchanged: support logins, every other function; a shop that never issues an invoice sees only the receipt numbers.

-- ------------------------------------------------------------------------------
-- numbers
-- ------------------------------------------------------------------------------
-- the Indian financial year of a date as 4 digits: 2627 for April 2026 to March 2027 (as issue_invoice in 025)
CREATE OR REPLACE FUNCTION public._fin_year(p_day date)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_catalog AS $$
  SELECT CASE WHEN extract(month FROM p_day) >= 4
              THEN lpad((extract(year FROM p_day)::integer % 100)::text, 2, '0') || lpad(((extract(year FROM p_day)::integer + 1) % 100)::text, 2, '0')
              ELSE lpad(((extract(year FROM p_day)::integer - 1) % 100)::text, 2, '0') || lpad((extract(year FROM p_day)::integer % 100)::text, 2, '0') END;
$$;

-- the next number of a document series of the shop for today's financial year
CREATE OR REPLACE FUNCTION public._doc_number(p_shop uuid, p_letter text, p_counter text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_fy text := public._fin_year((now() AT TIME ZONE COALESCE((SELECT NULLIF(timezone, '') FROM public.shops WHERE id = p_shop), 'Asia/Kolkata'))::date);
  v_n bigint := public.next_shop_counter(p_shop, p_counter, v_fy);
  v_tail text := p_letter || '/' || v_fy || '/' || lpad(v_n::text, 4, '0');
  v_full text := (SELECT token_prefix FROM public.shops WHERE id = p_shop) || '-' || v_tail;
BEGIN
  RETURN CASE WHEN length(v_full) <= 16 THEN v_full ELSE p_letter || v_fy || '/' || lpad(v_n::text, 4, '0') END;
END $$;

-- ------------------------------------------------------------------------------
-- documents of a booking after its tax invoice
-- ------------------------------------------------------------------------------
CREATE TABLE public.rental_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     uuid NOT NULL REFERENCES public.shops(id),
  rental_id   uuid NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('credit_note', 'supplementary')),
  number      text NOT NULL,
  amount      numeric(14,2) NOT NULL CHECK (amount > 0),
  reason      text,
  doc_date    date NOT NULL,
  issued_by   uuid REFERENCES public.profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rental_documents_shop_number_key UNIQUE (shop_id, number),
  CONSTRAINT rental_documents_shop_rental_fkey FOREIGN KEY (shop_id, rental_id) REFERENCES public.rentals (shop_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_rental_documents_rental ON public.rental_documents (shop_id, rental_id);
ALTER TABLE public.rental_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_isolation ON public.rental_documents AS RESTRICTIVE FOR ALL
  USING (shop_id = (SELECT public.current_shop_id())) WITH CHECK (shop_id = (SELECT public.current_shop_id()));
-- like the booking's other records: whoever can see the booking sees its documents
CREATE POLICY rental_documents_read ON public.rental_documents FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.rentals r WHERE r.id = rental_id));
REVOKE ALL ON public.rental_documents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.rental_documents TO authenticated;
GRANT ALL ON public.rental_documents TO service_role;

-- what the customer has been billed so far: the invoice, plus supplementary bills, less credit notes
ALTER TABLE public.rentals ADD COLUMN invoice_total numeric(14,2);
-- invoices issued before (always after the return) billed the booking's total then
UPDATE public.rentals SET invoice_total = total WHERE invoice_no IS NOT NULL;

CREATE OR REPLACE FUNCTION public._billed(p_rental uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT COALESCE((SELECT invoice_total FROM public.rentals WHERE id = p_rental), 0)
       + COALESCE((SELECT sum(CASE kind WHEN 'supplementary' THEN amount ELSE -amount END) FROM public.rental_documents WHERE rental_id = p_rental), 0);
$$;

-- 025's version: issued from a button; at booking or after the return, as the shop chose; the SAC code is needed
CREATE OR REPLACE FUNCTION public.issue_invoice(p_rental_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_r public.rentals;
  v_shop public.shops;
  v_today date := (now() AT TIME ZONE public._shop_tz())::date;
  v_n bigint;
  v_fy text;
  v_at_booking boolean;
BEGIN
  PERFORM public._require_role();
  SELECT * INTO v_r FROM public.rentals WHERE id = p_rental_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental not found';
  END IF;
  PERFORM public._require_branch(v_r.branch_id);
  SELECT * INTO v_shop FROM public.shops WHERE id = v_r.shop_id;
  IF NULLIF(btrim(v_shop.gstin), '') IS NULL OR COALESCE((v_shop.settings ->> 'gst_percent')::numeric, 0) <= 0 THEN
    RAISE EXCEPTION 'This shop prints receipts. Enter the GSTIN and the GST %% in Shop settings to issue tax invoices';
  END IF;
  IF v_r.invoice_no IS NOT NULL THEN
    RETURN jsonb_build_object('invoice_no', v_r.invoice_no, 'invoice_date', v_r.invoice_date);
  END IF;
  v_at_booking := public._shop_rule(v_r.shop_id, 'invoice_timing', 'after_return') = 'at_booking';
  IF v_r.status IN ('cancelled', 'no_show') THEN
    RAISE EXCEPTION 'A cancelled booking never gets a tax invoice';
  END IF;
  IF NOT v_at_booking AND v_r.status <> 'completed' THEN
    RAISE EXCEPTION 'A tax invoice is issued after the rental is returned (this one is %). The shop can bill at booking in Settings', v_r.status;
  END IF;
  IF NULLIF(btrim(v_shop.settings ->> 'sac_code'), '') IS NULL THEN
    RAISE EXCEPTION 'Enter the SAC code in Settings first: a tax invoice must show it';
  END IF;
  v_fy := public._fin_year(v_today);
  v_n := public.next_shop_counter(v_r.shop_id, 'invoice', v_fy);
  UPDATE public.rentals SET invoice_no = v_shop.token_prefix || '/' || v_fy || '/' || lpad(v_n::text, 4, '0'),
         invoice_date = v_today, invoice_total = total
  WHERE id = p_rental_id
  RETURNING * INTO v_r;
  RETURN jsonb_build_object('invoice_no', v_r.invoice_no, 'invoice_date', v_r.invoice_date);
END $$;

-- a credit note: lowers the amount of an invoiced booking (owner, with a reason, like the other money corrections)
CREATE OR REPLACE FUNCTION public.issue_credit_note(p_rental_id uuid, p_amount numeric, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_r public.rentals;
  v_number text;
BEGIN
  PERFORM public._require_correction(p_reason);
  SELECT * INTO v_r FROM public.rentals WHERE id = p_rental_id AND shop_id = public.current_shop_id() FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental not found';
  END IF;
  IF v_r.invoice_no IS NULL THEN
    RAISE EXCEPTION 'This booking has no tax invoice: change its amount directly';
  END IF;
  IF v_r.status IN ('cancelled', 'no_show') THEN
    RAISE EXCEPTION 'This booking is cancelled; its credit note was made then';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount <> round(p_amount, 2) THEN
    RAISE EXCEPTION 'Enter an amount above zero, in rupees and paise';
  END IF;
  IF p_amount > v_r.total OR p_amount > public._billed(p_rental_id) THEN
    RAISE EXCEPTION 'A credit note cannot be more than what was billed (%)', public._act_inr(LEAST(v_r.total, public._billed(p_rental_id)));
  END IF;
  PERFORM set_config('app.credit_note', p_rental_id::text, true);
  BEGIN
    UPDATE public.rentals SET discount = discount + p_amount WHERE id = p_rental_id;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'The customer has paid more than the new amount. Record a refund first';
  END;
  PERFORM set_config('app.credit_note', '', true);
  v_number := public._doc_number(v_r.shop_id, 'C', 'credit_note');
  INSERT INTO public.rental_documents (shop_id, rental_id, kind, number, amount, reason, doc_date, issued_by)
  VALUES (v_r.shop_id, p_rental_id, 'credit_note', v_number, p_amount, btrim(p_reason), (now() AT TIME ZONE public._shop_tz())::date, auth.uid());
  RETURN jsonb_build_object('number', v_number);
END $$;

-- after a tax invoice: the amount is never lowered in place; a cancellation makes its credit note, and a returned booking
-- that ends up above what was billed gets a supplementary bill
CREATE OR REPLACE FUNCTION public._invoice_followups()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_billed numeric := public._billed(NEW.id);
  v_today date := (now() AT TIME ZONE COALESCE((SELECT NULLIF(timezone, '') FROM public.shops WHERE id = NEW.shop_id), 'Asia/Kolkata'))::date;
BEGIN
  IF NEW.status IN ('cancelled', 'no_show') AND OLD.status NOT IN ('cancelled', 'no_show') THEN
    IF v_billed - NEW.total > 0 THEN
      INSERT INTO public.rental_documents (shop_id, rental_id, kind, number, amount, reason, doc_date, issued_by)
      VALUES (NEW.shop_id, NEW.id, 'credit_note', public._doc_number(NEW.shop_id, 'C', 'credit_note'), v_billed - NEW.total,
              COALESCE(NULLIF(btrim(NEW.cancel_reason), ''), 'Booking cancelled'), v_today, auth.uid());
    END IF;
    RETURN NULL;
  END IF;
  IF NEW.total < OLD.total AND COALESCE(current_setting('app.credit_note', true), '') <> NEW.id::text THEN
    RAISE EXCEPTION 'Booking % has tax invoice %, so its amount cannot be lowered here. Issue a credit note instead', NEW.token, NEW.invoice_no;
  END IF;
  IF NEW.status = 'completed' AND NEW.total > v_billed THEN
    INSERT INTO public.rental_documents (shop_id, rental_id, kind, number, amount, reason, doc_date, issued_by)
    VALUES (NEW.shop_id, NEW.id, 'supplementary', public._doc_number(NEW.shop_id, 'S', 'supplementary'), NEW.total - v_billed,
            'Charged after the invoice', v_today, auth.uid());
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_invoice_followups AFTER UPDATE ON public.rentals
  FOR EACH ROW WHEN (OLD.invoice_no IS NOT NULL AND (NEW.total IS DISTINCT FROM OLD.total OR NEW.status IS DISTINCT FROM OLD.status))
  EXECUTE FUNCTION public._invoice_followups();

-- ------------------------------------------------------------------------------
-- receipt numbers for payments
-- ------------------------------------------------------------------------------
ALTER TABLE public.payments ADD COLUMN receipt_no text;
CREATE UNIQUE INDEX payments_shop_receipt_no_key ON public.payments (shop_id, receipt_no) WHERE receipt_no IS NOT NULL;

CREATE OR REPLACE FUNCTION public._payment_receipt_no()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  NEW.receipt_no := COALESCE(NEW.receipt_no, public._doc_number(NEW.shop_id, 'R', 'receipt'));
  RETURN NEW;
END $$;
CREATE TRIGGER trg_payment_receipt_no BEFORE INSERT ON public.payments FOR EACH ROW EXECUTE FUNCTION public._payment_receipt_no();

-- the payments made before: numbered in the order they were made, in their own financial year
DO $$
DECLARE
  p record;
  v_fy text;
  v_n bigint;
  v_full text;
BEGIN
  FOR p IN SELECT py.id, py.shop_id, s.token_prefix, (py.paid_at AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata'))::date AS day
           FROM public.payments py JOIN public.shops s ON s.id = py.shop_id
           WHERE py.receipt_no IS NULL ORDER BY py.shop_id, py.paid_at, py.created_at LOOP
    v_fy := public._fin_year(p.day);
    v_n := public.next_shop_counter(p.shop_id, 'receipt', v_fy);
    v_full := p.token_prefix || '-R/' || v_fy || '/' || lpad(v_n::text, 4, '0');
    UPDATE public.payments SET receipt_no = CASE WHEN length(v_full) <= 16 THEN v_full ELSE 'R' || v_fy || '/' || lpad(v_n::text, 4, '0') END
    WHERE id = p.id;
  END LOOP;
END $$;

-- ------------------------------------------------------------------------------
-- settings
-- ------------------------------------------------------------------------------
ALTER FUNCTION public._shop_setting_keys() RENAME TO _shop_setting_keys_039;
CREATE OR REPLACE FUNCTION public._shop_setting_keys()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public, pg_catalog AS $$
  SELECT public._shop_setting_keys_039()
         || ARRAY['invoice_timing', 'bill_terms', 'cancel_keeps_advance', 'bank_name', 'bank_holder', 'bank_last4', 'bank_ifsc'];
$$;

ALTER FUNCTION public._settings_check(jsonb) RENAME TO _settings_check_039;
CREATE OR REPLACE FUNCTION public._settings_check(s jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_catalog AS $$
BEGIN
  PERFORM public._settings_check_039(s);
  IF s ? 'invoice_timing' AND s ->> 'invoice_timing' NOT IN ('after_return', 'at_booking') THEN
    RAISE EXCEPTION 'The tax invoice is issued after the return or at booking';
  END IF;
  IF s ? 'bill_terms' AND length(COALESCE(s ->> 'bill_terms', '')) > 600 THEN
    RAISE EXCEPTION 'The terms on the bill are at most 600 characters';
  END IF;
  IF s ? 'cancel_keeps_advance' AND jsonb_typeof(s -> 'cancel_keeps_advance') <> 'boolean' THEN
    RAISE EXCEPTION 'Keeping the advance on a cancellation is on or off';
  END IF;
  IF (s ? 'bank_name' AND length(COALESCE(s ->> 'bank_name', '')) > 60) OR (s ? 'bank_holder' AND length(COALESCE(s ->> 'bank_holder', '')) > 80) THEN
    RAISE EXCEPTION 'The bank name is at most 60 characters and the account holder at most 80';
  END IF;
  IF s ? 'bank_last4' AND COALESCE(s ->> 'bank_last4', '') !~ '^([0-9]{4})?$' THEN
    RAISE EXCEPTION 'Enter only the last 4 digits of the account number';
  END IF;
  IF s ? 'bank_ifsc' AND COALESCE(s ->> 'bank_ifsc', '') !~ '^([A-Z]{4}0[A-Z0-9]{6})?$' THEN
    RAISE EXCEPTION 'The IFSC is 11 characters, like SBIN0001234';
  END IF;
END $$;

-- a new clothing shop bills at booking, like the shops it is made for; other shops keep "after the return"
CREATE OR REPLACE FUNCTION public._new_shop_invoice_timing()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  IF NOT (COALESCE(NEW.settings, '{}') ? 'invoice_timing') AND cardinality(NEW.business_types) > 0
     AND NOT EXISTS (SELECT 1 FROM public.business_templates t WHERE t.key = ANY (NEW.business_types) AND t.kind <> 'wearable') THEN
    NEW.settings := COALESCE(NEW.settings, '{}') || '{"invoice_timing": "at_booking"}';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_new_shop_invoice_timing BEFORE INSERT ON public.shops FOR EACH ROW EXECUTE FUNCTION public._new_shop_invoice_timing();

-- ------------------------------------------------------------------------------
-- activity log
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._act_rental_documents()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  r public.rentals%ROWTYPE;
  v_cust text;
BEGIN
  IF TG_OP <> 'INSERT' THEN RETURN NULL; END IF;
  SELECT * INTO r FROM public.rentals WHERE id = NEW.rental_id;
  v_cust := COALESCE((SELECT full_name FROM public.customers WHERE id = r.customer_id), 'a customer');
  PERFORM public._act_log(NEW.shop_id, r.branch_id, 'money',
    CASE NEW.kind WHEN 'credit_note' THEN 'credit_note_issued' ELSE 'supplementary_bill_issued' END, 2, 'document', NEW.id, NEW.number,
    format(CASE NEW.kind WHEN 'credit_note' THEN 'Issued credit note %s of %s against invoice %s (booking %s, %s)'
                         ELSE 'Issued supplementary bill %s of %s after invoice %s (booking %s, %s)' END,
           NEW.number, public._act_inr(NEW.amount), r.invoice_no, r.token, v_cust),
    NEW.kind = 'credit_note', NULL, NULL, NEW.reason, NEW.issued_by);
  RETURN NULL;
END $$;
CREATE TRIGGER trg_activity AFTER INSERT ON public.rental_documents FOR EACH ROW EXECUTE FUNCTION public._act_rental_documents();

-- ------------------------------------------------------------------------------
-- who may call what
-- ------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public._fin_year(date), public._doc_number(uuid, text, text), public._billed(uuid), public._invoice_followups(),
  public._payment_receipt_no(), public._shop_setting_keys_039(), public._settings_check_039(jsonb), public._new_shop_invoice_timing(),
  public._act_rental_documents()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._act_rental_documents() FROM app_rpc;
-- issue_invoice runs as app_rpc
GRANT EXECUTE ON FUNCTION public._fin_year(date) TO app_rpc;
REVOKE ALL ON FUNCTION public.issue_credit_note(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_credit_note(uuid, numeric, text) TO authenticated;
NOTIFY pgrst, 'reload schema';
