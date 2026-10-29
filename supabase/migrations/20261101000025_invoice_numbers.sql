-- Tax invoices get their own number and date, fixed when issued.
-- Before, the "invoice number" was the booking token and the date was the day of printing, so a reprint changed it.
--   * Only a shop with a GSTIN and a GST % issues tax invoices; the others print plain receipts.
--   * An invoice is issued once the rental is returned (its amounts are final). Number: PREFIX/YYYY/NNNN where YYYY is the
--     financial year (April to March, e.g. 2627) and NNNN counts up per shop and year; at most 16 characters, as GST allows.
--   * A cancelled booking never gets a tax invoice.

ALTER TABLE public.rentals ADD COLUMN invoice_no text, ADD COLUMN invoice_date date;
CREATE UNIQUE INDEX rentals_shop_invoice_no_key ON public.rentals (shop_id, invoice_no) WHERE invoice_no IS NOT NULL;

CREATE OR REPLACE FUNCTION public.issue_invoice(p_rental_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_r public.rentals;
  v_shop public.shops;
  v_today date := (now() AT TIME ZONE public._shop_tz())::date;
  v_year integer := extract(year FROM v_today)::integer;
  v_fy text;
  v_n bigint;
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
  IF v_r.status <> 'completed' THEN
    RAISE EXCEPTION 'A tax invoice is issued after the rental is returned (this one is %)', v_r.status;
  END IF;
  IF v_r.invoice_no IS NULL THEN
    v_fy := CASE WHEN extract(month FROM v_today) >= 4
                 THEN lpad((v_year % 100)::text, 2, '0') || lpad(((v_year + 1) % 100)::text, 2, '0')
                 ELSE lpad(((v_year - 1) % 100)::text, 2, '0') || lpad((v_year % 100)::text, 2, '0') END;
    v_n := public.next_shop_counter(v_r.shop_id, 'invoice', v_fy);
    UPDATE public.rentals SET invoice_no = v_shop.token_prefix || '/' || v_fy || '/' || lpad(v_n::text, 4, '0'), invoice_date = v_today
    WHERE id = p_rental_id
    RETURNING * INTO v_r;
  END IF;
  RETURN jsonb_build_object('invoice_no', v_r.invoice_no, 'invoice_date', v_r.invoice_date);
END $$;

ALTER FUNCTION public.issue_invoice(uuid) OWNER TO app_rpc;
REVOKE ALL ON FUNCTION public.issue_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_invoice(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
