-- Migration: Booking Cancellation Accounting & Ledger Reconciliation
-- Description:
--   1. Add non-destructive cancellation accounting fields to public.bookings
--   2. Deploy cancel_booking_atomic RPC with row locking, idempotency, role/branch isolation, and strict validations
--   3. Grant execute permissions to authenticated and service_role

-- Step 1: Add cancellation accounting and audit columns to public.bookings
ALTER TABLE public.bookings
    ADD COLUMN IF NOT EXISTS cancellation_fee NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS advance_refund NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS security_deposit_refund NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS refund_payment_method TEXT,
    ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
    ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES public.profiles(id);

-- Drop legacy 5-argument overload if previously created in testing to prevent PostgREST signature ambiguity
DROP FUNCTION IF EXISTS public.cancel_booking_atomic(UUID, NUMERIC, TEXT, TEXT, UUID);

-- Step 2: Create atomic cancellation RPC function
CREATE OR REPLACE FUNCTION public.cancel_booking_atomic(
    p_booking_id UUID,
    p_cancellation_fee NUMERIC,
    p_refund_payment_method TEXT,
    p_cancellation_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_auth_uid UUID;
    v_caller_role TEXT;
    v_caller_branch UUID;
    v_is_active BOOLEAN;
    v_booking RECORD;
    v_advance NUMERIC;
    v_security_deposit NUMERIC;
    v_advance_refund NUMERIC;
    v_deposit_refund NUMERIC;
    v_clean_method TEXT;
    v_clean_reason TEXT;
BEGIN
    -- 1. Authentication and Authorization Verification
    v_auth_uid := auth.uid();
    IF v_auth_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    SELECT role, is_active, branch_id INTO v_caller_role, v_is_active, v_caller_branch
    FROM public.profiles WHERE id = v_auth_uid;

    IF v_caller_role IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Caller profile not found';
    END IF;

    IF NOT COALESCE(v_is_active, false) THEN
        RAISE EXCEPTION 'Unauthorized: Caller profile is inactive';
    END IF;

    IF v_caller_role NOT IN ('super_admin', 'owner', 'manager', 'staff') THEN
        RAISE EXCEPTION 'Unauthorized: Role % cannot cancel bookings', v_caller_role;
    END IF;

    -- 2. Concurrency Lock: Lock the booking row against concurrent requests (FOR UPDATE)
    SELECT * INTO v_booking
    FROM public.bookings
    WHERE id = p_booking_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Booking not found';
    END IF;

    -- Branch isolation check for manager & staff
    IF v_caller_role IN ('manager', 'staff') AND (v_caller_branch IS NULL OR v_booking.branch_id != v_caller_branch) THEN
        RAISE EXCEPTION 'Unauthorized: Cannot cancel booking belonging to another branch';
    END IF;

    -- Idempotency check: if already cancelled, return existing cancellation details safely
    IF v_booking.status = 'cancelled' THEN
        RETURN jsonb_build_object(
            'success', true,
            'already_cancelled', true,
            'booking_id', v_booking.id,
            'token', v_booking.token,
            'cancellation_fee', COALESCE(v_booking.cancellation_fee, 0),
            'advance_refund', COALESCE(v_booking.advance_refund, 0),
            'security_deposit_refund', COALESCE(v_booking.security_deposit_refund, 0)
        );
    END IF;

    -- Explicitly reject NULL or un-cancellable booking statuses
    IF v_booking.status IS NULL OR v_booking.status NOT IN ('confirmed', 'pending') THEN
        RAISE EXCEPTION 'Booking cannot be cancelled (current status: %)', COALESCE(v_booking.status, 'NULL');
    END IF;

    -- 3. Financial validations
    IF p_cancellation_fee IS NULL THEN
        RAISE EXCEPTION 'Cancellation fee cannot be null';
    END IF;

    IF p_cancellation_fee < 0 THEN
        RAISE EXCEPTION 'Cancellation fee cannot be negative';
    END IF;

    v_advance := COALESCE(v_booking.advance, 0);
    v_security_deposit := COALESCE(v_booking.security_deposit, 0);

    IF p_cancellation_fee > v_advance THEN
        RAISE EXCEPTION 'Cancellation fee (%) cannot exceed advance payment received (%)', p_cancellation_fee, v_advance;
    END IF;

    v_advance_refund := v_advance - p_cancellation_fee;
    v_deposit_refund := v_security_deposit;

    v_clean_method := NULLIF(TRIM(p_refund_payment_method), '');
    v_clean_reason := NULLIF(TRIM(p_cancellation_reason), '');

    IF (v_advance_refund > 0 OR v_deposit_refund > 0) AND v_clean_method IS NULL THEN
        RAISE EXCEPTION 'Refund payment method is required when a refund is due';
    END IF;

    IF v_clean_method IS NOT NULL AND v_clean_method NOT IN ('cash', 'upi', 'card', 'bank_transfer') THEN
        RAISE EXCEPTION 'Invalid refund payment method: %', v_clean_method;
    END IF;

    -- 4. Atomically update the booking record
    UPDATE public.bookings
    SET status = 'cancelled',
        cancellation_fee = p_cancellation_fee,
        advance_refund = v_advance_refund,
        security_deposit_refund = v_deposit_refund,
        refund_payment_method = v_clean_method,
        cancellation_reason = v_clean_reason,
        cancelled_at = NOW(),
        cancelled_by = v_auth_uid,
        updated_at = NOW()
    WHERE id = p_booking_id;

    -- 5. Release physical unit assignments in booking_item_inventory
    DELETE FROM public.booking_item_inventory
    WHERE booking_item_id IN (
        SELECT id FROM public.booking_items WHERE booking_id = p_booking_id
    );

    RETURN jsonb_build_object(
        'success', true,
        'already_cancelled', false,
        'booking_id', v_booking.id,
        'token', v_booking.token,
        'original_total', v_booking.total,
        'original_advance', v_advance,
        'cancellation_fee', p_cancellation_fee,
        'advance_refund', v_advance_refund,
        'security_deposit_refund', v_deposit_refund
    );
END;
$$;

-- Step 3: Permissions
REVOKE ALL ON FUNCTION public.cancel_booking_atomic(UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_booking_atomic(UUID, NUMERIC, TEXT, TEXT) TO authenticated;

-- Step 4: Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
