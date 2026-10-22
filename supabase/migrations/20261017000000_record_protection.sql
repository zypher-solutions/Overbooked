-- Migration: 20261017000000_record_protection.sql
-- QA_REPORT.md: S27 (financial records must be permanent), product history.
--
-- Rules (owner decision, 2026-10-15):
--   * Nobody can edit or delete payments, rentals, bookings or their line items through the API.
--     That includes owners, managers and staff.
--   * A super_admin can correct or remove a record from the app, through the admin_* functions below.
--     A written reason is required and every change is stored in audit_log.
--   * Someone with database access (SQL editor) can still delete directly ("break-glass");
--     those deletions are also written to audit_log, with via = 'sql'.
--   * A product that has rental/booking history is deactivated, never deleted.

-- ==============================================================================
-- 1. audit_log (readable by super_admin only; written only by the functions/triggers below)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.audit_log (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  performed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  performed_by  UUID,                 -- NULL when run from the SQL editor
  via           TEXT NOT NULL,        -- 'app' | 'sql'
  action        TEXT NOT NULL,        -- 'delete' | 'update'
  table_name    TEXT NOT NULL,
  record_id     UUID,
  reason        TEXT,
  old_data      JSONB,
  new_data      JSONB
);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_log_read" ON public.audit_log;
CREATE POLICY "audit_log_read" ON public.audit_log FOR SELECT
  USING (public.get_my_role() = 'super_admin');

REVOKE ALL ON public.audit_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.audit_log TO authenticated;

-- ==============================================================================
-- 2. Triggers: block direct API changes, and log every deletion
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.block_direct_record_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- anon / authenticated = a call through the API. The admin_* functions and the other RPCs run as
  -- their owner, and the SQL editor runs as postgres, so both pass.
  IF current_user IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Records are permanent: % on % is not allowed. A super admin can correct or remove it from the record''s Admin tools.',
      TG_OP, TG_TABLE_NAME;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_record_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  INSERT INTO public.audit_log (performed_by, via, action, table_name, record_id, reason, old_data)
  VALUES (
    auth.uid(),
    CASE WHEN auth.uid() IS NULL THEN 'sql' ELSE 'app' END,
    'delete',
    TG_TABLE_NAME,
    OLD.id,
    NULLIF(current_setting('app.audit_reason', true), ''),
    to_jsonb(OLD)
  );
  RETURN OLD;
END;
$$;

-- payments and line items: no direct UPDATE or DELETE
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['payments', 'rental_items', 'rental_item_inventory', 'booking_items', 'booking_item_inventory']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_block_direct_change ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_block_direct_change BEFORE UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.block_direct_record_change()', t);
  END LOOP;

  -- rentals and bookings: UPDATE is already limited by their guard triggers; add DELETE
  FOREACH t IN ARRAY ARRAY['rentals', 'bookings']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_block_direct_delete ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_block_direct_delete BEFORE DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.block_direct_record_change()', t);
  END LOOP;

  -- every deletion, from the app or the SQL editor, is logged
  FOREACH t IN ARRAY ARRAY['payments', 'rentals', 'rental_items', 'rental_item_inventory',
                           'bookings', 'booking_items', 'booking_item_inventory']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_delete ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_audit_delete AFTER DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.audit_record_delete()', t);
  END LOOP;
END $$;

-- ==============================================================================
-- 3. Super-admin functions
-- ==============================================================================
CREATE OR REPLACE FUNCTION public._require_super_admin(p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_active BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role, is_active INTO v_role, v_active FROM public.profiles WHERE id = v_uid;

  IF v_role IS DISTINCT FROM 'super_admin' OR v_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Only a super admin can do this';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'A reason (at least 3 characters) is required';
  END IF;

  -- picked up by audit_record_delete for the rest of this transaction
  PERFORM set_config('app.audit_reason', btrim(p_reason), true);
  RETURN v_uid;
END;
$$;

REVOKE ALL ON FUNCTION public._require_super_admin(text) FROM PUBLIC, anon, authenticated;

-- ---- edit a payment: amount and method; the rental balance is recalculated ----
CREATE OR REPLACE FUNCTION public.admin_update_payment(
  p_payment_id uuid,
  p_amount numeric,
  p_method text,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid UUID;
  v_pay RECORD;
  v_rental RECORD;
  v_new_advance NUMERIC;
  v_status TEXT;
BEGIN
  v_uid := public._require_super_admin(p_reason);

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;

  IF p_method IS NULL OR p_method NOT IN ('cash', 'upi', 'card', 'bank_transfer') THEN
    RAISE EXCEPTION 'Invalid payment method: %', COALESCE(p_method, 'NULL');
  END IF;

  SELECT * INTO v_pay FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  SELECT * INTO v_rental FROM public.rentals WHERE id = v_pay.rental_id FOR UPDATE;

  v_new_advance := COALESCE(v_rental.advance, 0) - v_pay.amount + p_amount;

  IF v_new_advance > v_rental.total THEN
    RAISE EXCEPTION 'New amount would make the rental overpaid (paid % of total %)', v_new_advance, v_rental.total;
  END IF;

  v_status := CASE
    WHEN v_new_advance >= v_rental.total THEN 'paid'
    WHEN v_new_advance > 0 THEN 'partial'
    ELSE 'unpaid'
  END;

  UPDATE public.payments SET amount = p_amount, method = p_method WHERE id = p_payment_id;

  UPDATE public.rentals
  SET advance = v_new_advance, payment_status = v_status, updated_at = NOW()
  WHERE id = v_pay.rental_id;

  INSERT INTO public.audit_log (performed_by, via, action, table_name, record_id, reason, old_data, new_data)
  VALUES (
    v_uid, 'app', 'update', 'payments', p_payment_id, btrim(p_reason),
    jsonb_build_object('amount', v_pay.amount, 'method', v_pay.method, 'rental_id', v_pay.rental_id,
                       'rental_advance', v_rental.advance, 'rental_payment_status', v_rental.payment_status),
    jsonb_build_object('amount', p_amount, 'method', p_method,
                       'rental_advance', v_new_advance, 'rental_payment_status', v_status)
  );

  RETURN jsonb_build_object('success', true, 'advance', v_new_advance, 'payment_status', v_status);
END;
$$;

-- ---- delete a payment; the rental balance is recalculated ----
CREATE OR REPLACE FUNCTION public.admin_delete_payment(
  p_payment_id uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_pay RECORD;
  v_rental RECORD;
  v_new_advance NUMERIC;
  v_status TEXT;
BEGIN
  PERFORM public._require_super_admin(p_reason);

  SELECT * INTO v_pay FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  SELECT * INTO v_rental FROM public.rentals WHERE id = v_pay.rental_id FOR UPDATE;

  v_new_advance := GREATEST(0, COALESCE(v_rental.advance, 0) - v_pay.amount);

  v_status := CASE
    WHEN v_new_advance >= v_rental.total THEN 'paid'
    WHEN v_new_advance > 0 THEN 'partial'
    ELSE 'unpaid'
  END;

  DELETE FROM public.payments WHERE id = p_payment_id;   -- logged by trg_audit_delete

  UPDATE public.rentals
  SET advance = v_new_advance, payment_status = v_status, updated_at = NOW()
  WHERE id = v_pay.rental_id;

  RETURN jsonb_build_object('success', true, 'advance', v_new_advance, 'payment_status', v_status);
END;
$$;

-- ---- correct a rental's total, deposit or notes ----
CREATE OR REPLACE FUNCTION public.admin_update_rental(
  p_rental_id uuid,
  p_total numeric,
  p_security_deposit numeric,
  p_notes text,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid UUID;
  v_rental RECORD;
  v_status TEXT;
BEGIN
  v_uid := public._require_super_admin(p_reason);

  SELECT * INTO v_rental FROM public.rentals WHERE id = p_rental_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental not found';
  END IF;

  IF p_total IS NULL OR p_total < 0 THEN
    RAISE EXCEPTION 'Total must be zero or more';
  END IF;

  IF p_security_deposit IS NULL OR p_security_deposit < 0 THEN
    RAISE EXCEPTION 'Security deposit must be zero or more';
  END IF;

  IF p_total < COALESCE(v_rental.advance, 0) THEN
    RAISE EXCEPTION 'Total (%) cannot be less than the amount already paid (%). Correct the payment first.', p_total, v_rental.advance;
  END IF;

  v_status := CASE
    WHEN COALESCE(v_rental.advance, 0) >= p_total THEN 'paid'
    WHEN COALESCE(v_rental.advance, 0) > 0 THEN 'partial'
    ELSE 'unpaid'
  END;

  UPDATE public.rentals
  SET total = p_total,
      security_deposit = p_security_deposit,
      notes = COALESCE(p_notes, notes),
      payment_status = v_status,
      updated_at = NOW()
  WHERE id = p_rental_id;

  INSERT INTO public.audit_log (performed_by, via, action, table_name, record_id, reason, old_data, new_data)
  VALUES (
    v_uid, 'app', 'update', 'rentals', p_rental_id, btrim(p_reason),
    jsonb_build_object('total', v_rental.total, 'security_deposit', v_rental.security_deposit,
                       'notes', v_rental.notes, 'payment_status', v_rental.payment_status),
    jsonb_build_object('total', p_total, 'security_deposit', p_security_deposit,
                       'notes', COALESCE(p_notes, v_rental.notes), 'payment_status', v_status)
  );

  RETURN jsonb_build_object('success', true, 'payment_status', v_status);
END;
$$;

-- ---- delete a rental with its payments and items ----
-- An active rental must be returned first: the return flow is what puts the units and stock back.
CREATE OR REPLACE FUNCTION public.admin_delete_rental(
  p_rental_id uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_rental RECORD;
  v_payments INT;
BEGIN
  PERFORM public._require_super_admin(p_reason);

  SELECT * INTO v_rental FROM public.rentals WHERE id = p_rental_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental not found';
  END IF;

  IF v_rental.status = 'out' THEN
    RAISE EXCEPTION 'This rental is still out. Mark it as returned first, then delete it.';
  END IF;

  DELETE FROM public.payments WHERE rental_id = p_rental_id;
  GET DIAGNOSTICS v_payments = ROW_COUNT;

  DELETE FROM public.rental_item_inventory
  WHERE rental_item_id IN (SELECT id FROM public.rental_items WHERE rental_id = p_rental_id);

  DELETE FROM public.rental_items WHERE rental_id = p_rental_id;
  DELETE FROM public.rentals WHERE id = p_rental_id;

  RETURN jsonb_build_object('success', true, 'payments_deleted', v_payments);
END;
$$;

-- ---- delete a booking with its items and unit assignments ----
CREATE OR REPLACE FUNCTION public.admin_delete_booking(
  p_booking_id uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_booking RECORD;
BEGIN
  PERFORM public._require_super_admin(p_reason);

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  DELETE FROM public.booking_item_inventory
  WHERE booking_item_id IN (SELECT id FROM public.booking_items WHERE booking_id = p_booking_id);

  DELETE FROM public.booking_items WHERE booking_id = p_booking_id;
  DELETE FROM public.bookings WHERE id = p_booking_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ==============================================================================
-- 4. Products: delete when there is no history, otherwise deactivate
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.delete_or_deactivate_product(p_product_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_active BOOLEAN;
  v_has_history BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role, is_active INTO v_role, v_active FROM public.profiles WHERE id = v_uid;

  IF v_role IS NULL OR v_active IS NOT TRUE OR v_role NOT IN ('super_admin', 'owner') THEN
    RAISE EXCEPTION 'Only a super admin or owner can delete products';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id) THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  v_has_history :=
       EXISTS (SELECT 1 FROM public.rental_items WHERE product_id = p_product_id)
    OR EXISTS (SELECT 1 FROM public.booking_items WHERE product_id = p_product_id)
    OR EXISTS (SELECT 1 FROM public.rental_items ri
               JOIN public.product_variations pv ON pv.id = ri.variation_id WHERE pv.product_id = p_product_id)
    OR EXISTS (SELECT 1 FROM public.booking_items bi
               JOIN public.product_variations pv ON pv.id = bi.variation_id WHERE pv.product_id = p_product_id)
    OR EXISTS (SELECT 1 FROM public.rental_item_inventory rii
               JOIN public.inventory_items ii ON ii.id = rii.inventory_item_id WHERE ii.product_id = p_product_id)
    OR EXISTS (SELECT 1 FROM public.booking_item_inventory bii
               JOIN public.inventory_items ii ON ii.id = bii.inventory_item_id WHERE ii.product_id = p_product_id);

  IF v_has_history THEN
    UPDATE public.products SET is_active = false, updated_at = NOW() WHERE id = p_product_id;
    UPDATE public.product_variations SET is_enabled = false WHERE product_id = p_product_id;
    RETURN jsonb_build_object('result', 'deactivated');
  END IF;

  DELETE FROM public.inventory_items WHERE product_id = p_product_id;
  DELETE FROM public.product_stock WHERE product_id = p_product_id;
  DELETE FROM public.product_variations WHERE product_id = p_product_id;
  DELETE FROM public.products WHERE id = p_product_id;

  RETURN jsonb_build_object('result', 'deleted');
END;
$$;

-- An inactive product (or a disabled variation) cannot be booked, whatever the client sends.
CREATE OR REPLACE FUNCTION public.block_inactive_product_booking()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.product_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.products WHERE id = NEW.product_id AND is_active IS FALSE) THEN
    RAISE EXCEPTION 'Product "%" is inactive and cannot be booked', NEW.product_name;
  END IF;

  IF NEW.variation_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.product_variations WHERE id = NEW.variation_id AND is_enabled IS FALSE) THEN
    RAISE EXCEPTION 'Variation of "%" is disabled and cannot be booked', NEW.product_name;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_inactive_product_booking ON public.booking_items;
CREATE TRIGGER trg_block_inactive_product_booking
  BEFORE INSERT ON public.booking_items
  FOR EACH ROW
  EXECUTE FUNCTION public.block_inactive_product_booking();

-- ==============================================================================
-- Grants: logged-in users only (each function checks the role itself)
-- ==============================================================================
REVOKE ALL ON FUNCTION public.admin_update_payment(uuid, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_payment(uuid, numeric, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_delete_payment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_payment(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_update_rental(uuid, numeric, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_rental(uuid, numeric, numeric, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_delete_rental(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_rental(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_delete_booking(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_booking(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.delete_or_deactivate_product(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_or_deactivate_product(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
