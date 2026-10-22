-- STATUS: APPLIED (live). Restored from qa/proposed-sql/005_discount_full.sql so the repo matches the live DB.
-- Replaces 002_rental_discount.sql (do NOT run 002). Owner decisions: discount is per
-- rental, given AT BOOKING; later change only by super_admin with a reason (admin_update_rental), never
-- below what is already paid. Fixes FIN-4, FIN-7, FIN-9.
--
-- Built mechanically from the live function bodies in qa/live-schema/functions.txt (exported 2026-10-14) by
-- exact-anchor replacement (the generator aborts if an anchor is missing), so only these lines differ from live:
--   create_booking_atomic  + p_discount arg (default 0, old calls keep working), stored on bookings.discount,
--                          p_total is the NET total, exact comparison at 2 decimals (0.01 tolerance removed),
--                          total and advance stored rounded to 2 decimals
--   pickup_booking_atomic  rental total = items - booking discount; rentals.discount copied from the booking
--   admin_update_rental    same signature; total may not exceed items + fees; a lower total is stored as discount
--   guard_*_direct_update  + discount cannot be changed through the API
-- The pickup rule "payment must equal remaining balance" is unchanged and now works on the net total.
-- Frontend (not in this file): RentalFormModal sends p_discount and the net p_total; EditRentalModal.tsx:20,28-29,40-42
-- (client-only discount) is removed; show "Discount" on the summary and in the PDF.

BEGIN;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS discount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0);
ALTER TABLE public.rentals  ADD COLUMN IF NOT EXISTS discount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0);

-- the old 10-arg signature must go, otherwise PostgREST sees two overloads
DROP FUNCTION IF EXISTS public.create_booking_atomic(text, uuid, uuid, date, text, uuid, numeric, numeric, numeric, jsonb);

CREATE OR REPLACE FUNCTION public.create_booking_atomic(p_token text, p_customer_id uuid, p_branch_id uuid, p_booking_date date, p_notes text, p_created_by uuid, p_total numeric, p_advance numeric, p_security_deposit numeric, p_items jsonb, p_discount numeric DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
    v_auth_uid UUID;
    v_caller_role TEXT;
    v_caller_branch UUID;
    v_effective_created_by UUID;

    v_booking_id UUID;
    v_item JSONB;
    v_booking_item_id UUID;

    v_product_id UUID;
    v_variation_id UUID;

    v_product_name TEXT;
    v_sku TEXT;
    v_image_url TEXT;

    v_qty INTEGER;
    v_daily_rate NUMERIC;
    v_pickup_date DATE;
    v_return_date DATE;
    v_buffer_days INTEGER;
    v_subtotal NUMERIC;

    v_inventory_ids UUID[];
    v_inventory_id UUID;

    v_requested_end DATE;
    v_duplicate_count INTEGER;
    v_caller_active BOOLEAN;
    v_items_total NUMERIC := 0;
BEGIN
    -- Authentication and Authorization Verification
    v_auth_uid := auth.uid();

    IF v_auth_uid IS NULL THEN
        -- Allow service_role context (e.g. backend administrative tasks), but reject unauthenticated / anonymous
        IF COALESCE(auth.role(), '') <> 'service_role' THEN
            RAISE EXCEPTION 'Unauthorized: Authentication required to create bookings';
        END IF;
        v_effective_created_by := p_created_by;
    ELSE
        SELECT role, branch_id, is_active INTO v_caller_role, v_caller_branch, v_caller_active
        FROM public.profiles
        WHERE id = v_auth_uid;

        IF v_caller_role IS NULL THEN
            RAISE EXCEPTION 'Unauthorized: Caller profile not found';
        END IF;

        IF NOT COALESCE(v_caller_active, false) THEN
            RAISE EXCEPTION 'Unauthorized: Caller profile is inactive';
        END IF;

        IF v_caller_role IN ('manager', 'staff') THEN
            IF p_branch_id IS DISTINCT FROM v_caller_branch AND p_branch_id IS DISTINCT FROM public.get_my_branch() THEN
                RAISE EXCEPTION 'Unauthorized: Cannot create bookings for another branch';
            END IF;

            -- Prevent employee impersonation: staff and manager bookings must be attributed to the authenticated caller
            IF p_created_by IS NOT NULL AND p_created_by <> v_auth_uid THEN
                RAISE EXCEPTION 'Unauthorized: Cannot create bookings on behalf of another employee';
            END IF;

            v_effective_created_by := v_auth_uid;
        ELSIF v_caller_role IN ('super_admin', 'owner') THEN
            v_effective_created_by := COALESCE(p_created_by, v_auth_uid);
            IF v_effective_created_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_effective_created_by) THEN
                RAISE EXCEPTION 'Invalid created_by user ID';
            END IF;
        ELSE
            RAISE EXCEPTION 'Unauthorized: Role % not permitted to create bookings', v_caller_role;
        END IF;
    END IF;

    -- Input Validation
    IF p_customer_id IS NULL THEN
        RAISE EXCEPTION 'Customer is required';
    END IF;

    IF p_branch_id IS NULL THEN
        RAISE EXCEPTION 'Branch is required';
    END IF;

    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Booking must contain at least one item';
    END IF;

    IF COALESCE(p_total, 0) < 0 THEN
        RAISE EXCEPTION 'Total cannot be negative';
    END IF;

    IF COALESCE(p_discount, 0) < 0 THEN
        RAISE EXCEPTION 'Discount cannot be negative';
    END IF;

    IF COALESCE(p_advance, 0) < 0 THEN
        RAISE EXCEPTION 'Advance paid cannot be negative';
    END IF;

    IF COALESCE(p_security_deposit, 0) < 0 THEN
        RAISE EXCEPTION 'Security deposit cannot be negative';
    END IF;

    IF COALESCE(p_advance, 0) > COALESCE(p_total, 0) THEN
        RAISE EXCEPTION 'Advance paid cannot exceed total rental amount';
    END IF;

    -- Concurrency Lock per branch
    PERFORM pg_advisory_xact_lock(
        hashtextextended('trendz-booking:' || p_branch_id::TEXT, 0)
    );

    -- Create Booking (trigger trg_assign_booking_reference assigns sequential reference)
    INSERT INTO public.bookings (
        token,
        customer_id,
        branch_id,
        booking_date,
        status,
        notes,
        created_by,
        total,
        advance,
        security_deposit,
        discount
    )
    VALUES (
        NULL, -- Trigger trg_assign_booking_reference assigns sequential reference
        p_customer_id,
        p_branch_id,
        COALESCE(p_booking_date, CURRENT_DATE),
        'confirmed',
        p_notes,
        v_effective_created_by,
        COALESCE(p_total, 0),
        COALESCE(p_advance, 0),
        COALESCE(p_security_deposit, 0),
        COALESCE(p_discount, 0)
    )
    RETURNING id INTO v_booking_id;

    -- Process each cart item and physical unit assignments
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := NULLIF(v_item->>'product_id', '')::UUID;
        v_variation_id := NULLIF(v_item->>'variation_id', '')::UUID;
        v_product_name := v_item->>'product_name';
        v_sku := v_item->>'sku';
        v_image_url := v_item->>'image_url';
        v_qty := (v_item->>'qty')::INTEGER;
        v_daily_rate := (v_item->>'daily_rate')::NUMERIC;
        v_pickup_date := (v_item->>'pickup_date')::DATE;
        v_return_date := (v_item->>'return_date')::DATE;
        v_buffer_days := COALESCE((v_item->>'buffer_days')::INTEGER, 0);
        v_subtotal := (v_item->>'subtotal')::NUMERIC;

        IF v_qty IS NULL OR v_qty <= 0 THEN
            RAISE EXCEPTION 'Quantity must be greater than zero for %', v_product_name;
        END IF;

        -- Prices are negotiated per deal, but never negative
        IF v_daily_rate IS NULL OR v_daily_rate < 0 OR v_subtotal IS NULL OR v_subtotal < 0 THEN
            RAISE EXCEPTION 'Daily rate and subtotal must be zero or more for %', v_product_name;
        END IF;

        v_items_total := v_items_total + v_subtotal;

        IF v_pickup_date IS NULL OR v_return_date IS NULL THEN
            RAISE EXCEPTION 'Pickup and return dates are required for %', v_product_name;
        END IF;

        IF v_return_date < v_pickup_date THEN
            RAISE EXCEPTION 'Return date cannot be earlier than pickup date for %', v_product_name;
        END IF;

        IF v_item->'inventory_item_ids' IS NULL OR jsonb_array_length(v_item->'inventory_item_ids') <> v_qty THEN
            RAISE EXCEPTION 'Item "%" requires exactly % physical unit(s) assigned', v_product_name, v_qty;
        END IF;

        INSERT INTO public.booking_items (
            booking_id,
            product_id,
            variation_id,
            product_name,
            sku,
            image_url,
            qty,
            daily_rate,
            pickup_date,
            return_date,
            buffer_days,
            subtotal
        )
        VALUES (
            v_booking_id,
            v_product_id,
            v_variation_id,
            v_product_name,
            v_sku,
            v_image_url,
            v_qty,
            v_daily_rate,
            v_pickup_date,
            v_return_date,
            v_buffer_days,
            v_subtotal
        )
        RETURNING id INTO v_booking_item_id;

        -- Assign inventory units
        v_inventory_ids := ARRAY(
            SELECT jsonb_array_elements_text(v_item->'inventory_item_ids')::UUID
        );

        SELECT COUNT(*) - COUNT(DISTINCT id_val)
        INTO v_duplicate_count
        FROM unnest(v_inventory_ids) AS id_val;

        IF v_duplicate_count > 0 THEN
            RAISE EXCEPTION 'Duplicate physical units detected within the same item for %', v_product_name;
        END IF;

        v_requested_end := v_return_date + v_buffer_days;

        FOREACH v_inventory_id IN ARRAY v_inventory_ids
        LOOP
            IF NOT EXISTS (
                SELECT 1
                FROM public.inventory_items ii
                WHERE ii.id = v_inventory_id
                  AND ii.branch_id = p_branch_id
                  AND ii.variation_id = v_variation_id
                  AND ii.status <> 'lost'
                  AND ii.status <> 'maintenance'
            ) THEN
                RAISE EXCEPTION 'Physical unit % is lost, under maintenance, or invalid for this branch', v_inventory_id;
            END IF;

            IF EXISTS (
                SELECT 1
                FROM public.booking_item_inventory bii
                JOIN public.booking_items bi ON bi.id = bii.booking_item_id
                JOIN public.bookings b ON b.id = bi.booking_id
                WHERE bii.inventory_item_id = v_inventory_id
                  AND b.status IN ('pending', 'confirmed')
                  AND bi.pickup_date <= v_requested_end
                  AND (bi.return_date + bi.buffer_days) >= v_pickup_date
            ) THEN
                RAISE EXCEPTION 'Physical unit % is already booked for overlapping dates', v_inventory_id;
            END IF;

            IF EXISTS (
                SELECT 1
                FROM public.rental_item_inventory rii
                JOIN public.rental_items ri ON ri.id = rii.rental_item_id
                JOIN public.rentals r ON r.id = ri.rental_id
                WHERE rii.inventory_item_id = v_inventory_id
                  AND r.status = 'out'
                  AND r.rent_date <= v_requested_end
                  AND (r.due_date + COALESCE(r.buffer_days, 0)) >= v_pickup_date
            ) THEN
                RAISE EXCEPTION 'Physical unit % is currently rented out for overlapping dates', v_inventory_id;
            END IF;

            INSERT INTO public.booking_item_inventory (
                booking_item_id,
                inventory_item_id
            )
            VALUES (
                v_booking_item_id,
                v_inventory_id
            );
        END LOOP;
    END LOOP;

    -- p_total is the NET total: items - discount. Compared at 2 decimals (paise), so JS float noise cannot
    -- fail a valid booking, but a wrong total or an oversized discount always does.
    IF COALESCE(p_discount, 0) > v_items_total THEN
        RAISE EXCEPTION 'Discount (%) cannot exceed the items total (%)', p_discount, v_items_total;
    END IF;

    IF round(v_items_total - COALESCE(p_discount, 0), 2) <> round(COALESCE(p_total, 0), 2) THEN
        RAISE EXCEPTION 'Booking total (%) does not match items (%) minus discount (%)', p_total, v_items_total, COALESCE(p_discount, 0);
    END IF;

    -- store the exact 2-decimal amounts, not the client's float
    UPDATE public.bookings SET total = round(COALESCE(p_total, 0), 2), advance = round(COALESCE(p_advance, 0), 2)
    WHERE id = v_booking_id;

    RETURN v_booking_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.pickup_booking_atomic(p_booking_id uuid, p_expected_return_date date, p_pickup_payment numeric, p_staff_id uuid, p_payment_method text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_user_role TEXT;
  v_is_active BOOLEAN;
  v_my_branch_id UUID;
  v_actual_staff_id UUID;

  v_booking RECORD;
  v_rental_id UUID;
  v_rental_token TEXT;
  v_item RECORD;
  v_inv RECORD;
  v_inv_status TEXT;
  v_total_paid NUMERIC;
  v_payment_status TEXT;
  v_due_date DATE;
  v_buffer_days INT;
  v_days INT;
  v_assigned_count INT;
  v_conflict_count INT;
  v_raw_count INT;
  v_new_rental_total NUMERIC;
  v_subtotal NUMERIC;
  v_original_days INT;
  v_actual_days INT;
  v_rental_item_id UUID;
BEGIN
  -- ========================================================
  -- AUTHENTICATION & AUTHORIZATION
  -- ========================================================
  v_actual_staff_id := auth.uid();
  IF v_actual_staff_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role, is_active, branch_id INTO v_user_role, v_is_active, v_my_branch_id
  FROM public.profiles WHERE id = v_actual_staff_id;

  IF v_user_role IS NULL OR NOT COALESCE(v_is_active, false) THEN
    RAISE EXCEPTION 'Unauthorized or inactive profile';
  END IF;

  IF v_user_role NOT IN ('super_admin', 'owner', 'manager', 'staff') THEN
    RAISE EXCEPTION 'Invalid role for pickup operation';
  END IF;

  -- Validate expected return date
  IF p_expected_return_date < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE THEN
    RAISE EXCEPTION 'Expected return date cannot be in the past.';
  END IF;

  -- 1. Validate Booking exists (FOR UPDATE securely locks the row against concurrent pickups)
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  -- Branch Authorization
  IF v_user_role IN ('manager', 'staff') AND (v_my_branch_id IS NULL OR v_booking.branch_id <> v_my_branch_id) THEN
    RAISE EXCEPTION 'Unauthorized branch operation';
  END IF;

  -- 2 & 3. Validate Booking state (prevents double pickup)
  IF v_booking.status != 'confirmed' AND v_booking.status != 'pending' THEN
    RAISE EXCEPTION 'Booking cannot be picked up (Current status: %)', v_booking.status;
  END IF;

  IF p_payment_method NOT IN ('cash', 'upi', 'card', 'bank_transfer') THEN
    RAISE EXCEPTION 'Invalid payment method: %', p_payment_method;
  END IF;

  -- 4. Dynamically recalculate new rental total based on early pickup rule
  v_new_rental_total := 0;
  FOR v_item IN (SELECT * FROM public.booking_items WHERE booking_id = p_booking_id) LOOP
    v_original_days := GREATEST(1, (v_item.return_date::DATE - v_item.pickup_date::DATE));
    v_actual_days := GREATEST(1, (p_expected_return_date - (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE));
    v_days := GREATEST(v_original_days, v_actual_days);
    v_new_rental_total := v_new_rental_total + (v_item.daily_rate * v_item.qty * v_days);
  END LOOP;

  -- negotiated discount agreed at booking carries over (fixed amount, never below zero)
  v_new_rental_total := GREATEST(0, v_new_rental_total - COALESCE(v_booking.discount, 0));

  -- 5. Validate payment against the dynamically recalculated total
  IF p_pickup_payment < 0 THEN
    RAISE EXCEPTION 'Pickup payment cannot be negative';
  END IF;

  IF p_pickup_payment <> GREATEST(0::numeric, v_new_rental_total - COALESCE(v_booking.advance, 0)) THEN
    RAISE EXCEPTION 'Pickup payment must equal the remaining balance (Expected: %, Received: %)', GREATEST(0::numeric, v_new_rental_total - COALESCE(v_booking.advance, 0)), p_pickup_payment;
  END IF;

  -- Generate token RN-XXXX
  v_rental_token := 'RN-' || upper(substr(md5(random()::text), 1, 4));

  v_total_paid := v_booking.advance + p_pickup_payment;
  IF v_total_paid >= v_new_rental_total THEN
    v_payment_status := 'paid';
  ELSIF v_total_paid > 0 THEN
    v_payment_status := 'partial';
  ELSE
    v_payment_status := 'unpaid';
  END IF;

  -- Get buffer days from the first item (assuming common across booking)
  SELECT MAX(buffer_days) INTO v_buffer_days FROM public.booking_items WHERE booking_id = p_booking_id;
  v_due_date := p_expected_return_date;

  -- Create rental with ACTUAL pickup timestamps and secure staff_id
  INSERT INTO public.rentals (
    token, customer_id, branch_id, staff_id, rent_date, actual_pickup_at, due_date, buffer_days,
    total, advance, security_deposit, payment_status, status, notes, discount
  ) VALUES (
    v_rental_token, v_booking.customer_id, v_booking.branch_id, v_actual_staff_id, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE, NOW(), 
    v_due_date, COALESCE(v_buffer_days, 0),
    v_new_rental_total, v_total_paid, v_booking.security_deposit, v_payment_status, 'out', v_booking.notes,
    COALESCE(v_booking.discount, 0)
  ) RETURNING id INTO v_rental_id;

  -- Create payment record matching exactly the existing payments schema
  IF p_pickup_payment > 0 THEN
    INSERT INTO public.payments (
      rental_id, amount, method, paid_at, recorded_by
    ) VALUES (
      v_rental_id, p_pickup_payment, p_payment_method, NOW(), v_actual_staff_id
    );
  END IF;

  -- Create rental_items and rental_item_inventory
  FOR v_item IN (SELECT * FROM public.booking_items WHERE booking_id = p_booking_id) LOOP
    
    -- Validate exact physical units assigned matches qty uniquely and check for duplicates
    SELECT COUNT(*), COUNT(DISTINCT inventory_item_id) INTO v_raw_count, v_assigned_count FROM public.booking_item_inventory WHERE booking_item_id = v_item.id;
    IF v_raw_count != v_assigned_count THEN
      RAISE EXCEPTION 'Booking item % contains duplicate physical-unit assignments. Please correct inventory assignment before pickup.', v_item.id;
    END IF;
    IF v_assigned_count != v_item.qty THEN
      RAISE EXCEPTION 'Booking item % requires % unique physical units but has % assigned. Please complete unit assignment before pickup.', v_item.id, v_item.qty, v_assigned_count;
    END IF;

    -- Calculate billed days and subtotal based on dynamic early pickup pricing
    v_original_days := GREATEST(1, (v_item.return_date::DATE - v_item.pickup_date::DATE));
    v_actual_days := GREATEST(1, (p_expected_return_date - (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE));
    v_days := GREATEST(v_original_days, v_actual_days);
    v_subtotal := v_item.daily_rate * v_item.qty * v_days;
    
    INSERT INTO public.rental_items (
      rental_id, product_id, variation_id, product_name, sku, image_url, qty, daily_rate, subtotal, days
    ) VALUES (
      v_rental_id, v_item.product_id, v_item.variation_id, v_item.product_name, v_item.sku, v_item.image_url, v_item.qty, v_item.daily_rate, v_subtotal, v_days
    ) RETURNING id INTO v_rental_item_id;

    -- Process each assigned physical unit
    FOR v_inv IN (SELECT inventory_item_id FROM public.booking_item_inventory WHERE booking_item_id = v_item.id) LOOP
      
      -- Lock row and validate physical units exist and are in a valid state
      SELECT status INTO v_inv_status FROM public.inventory_items WHERE id = v_inv.inventory_item_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Assigned inventory item % not found', v_inv.inventory_item_id;
      END IF;

      IF v_inv_status IN ('rented', 'lost', 'maintenance') THEN
        RAISE EXCEPTION 'Assigned inventory item % is currently %, cannot be rented', v_inv.inventory_item_id, v_inv_status;
      END IF;

      -- Check for conflicts against future bookings based on early pickup and new expected return date
      SELECT COUNT(*) INTO v_conflict_count
      FROM public.booking_item_inventory bii
      JOIN public.booking_items bi ON bi.id = bii.booking_item_id
      JOIN public.bookings b ON b.id = bi.booking_id
      WHERE bii.inventory_item_id = v_inv.inventory_item_id
      AND b.status IN ('confirmed', 'pending')
      AND b.id != p_booking_id
      AND bi.pickup_date <= (p_expected_return_date + COALESCE(v_item.buffer_days, 0))
      AND (bi.return_date + COALESCE(bi.buffer_days, 0)) >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE;

      IF v_conflict_count > 0 THEN
        RAISE EXCEPTION 'Cannot use physical unit % until %. It is reserved for another booking during this interval.', v_inv.inventory_item_id, (p_expected_return_date + COALESCE(v_item.buffer_days, 0));
      END IF;

      INSERT INTO public.rental_item_inventory (rental_item_id, inventory_item_id)
      VALUES (v_rental_item_id, v_inv.inventory_item_id);

      -- Change physical inventory to rented within the transaction
      UPDATE public.inventory_items SET status = 'rented' WHERE id = v_inv.inventory_item_id;
    END LOOP;
  END LOOP;

  -- Update booking
  UPDATE public.bookings SET status = 'completed' WHERE id = p_booking_id;

  RETURN v_rental_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_booking_direct_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF current_user IN ('anon', 'authenticated') AND (
       NEW.status IS DISTINCT FROM OLD.status
    OR NEW.total IS DISTINCT FROM OLD.total
       OR NEW.discount IS DISTINCT FROM OLD.discount
    OR NEW.advance IS DISTINCT FROM OLD.advance
    OR NEW.security_deposit IS DISTINCT FROM OLD.security_deposit
    OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
    OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
    OR NEW.token IS DISTINCT FROM OLD.token
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.cancellation_fee IS DISTINCT FROM OLD.cancellation_fee
    OR NEW.advance_refund IS DISTINCT FROM OLD.advance_refund
    OR NEW.security_deposit_refund IS DISTINCT FROM OLD.security_deposit_refund
    OR NEW.refund_payment_method IS DISTINCT FROM OLD.refund_payment_method
    OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
    OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by
  ) THEN
    RAISE EXCEPTION 'Booking amounts and status can only be changed through the booking workflows';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_rental_direct_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF current_user IN ('anon', 'authenticated') AND (
       NEW.status IS DISTINCT FROM OLD.status
    OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
    OR NEW.total IS DISTINCT FROM OLD.total
       OR NEW.discount IS DISTINCT FROM OLD.discount
    OR NEW.advance IS DISTINCT FROM OLD.advance
    OR NEW.security_deposit IS DISTINCT FROM OLD.security_deposit
    OR NEW.extra_fees IS DISTINCT FROM OLD.extra_fees
    OR NEW.extra_fees_reason IS DISTINCT FROM OLD.extra_fees_reason
    OR NEW.deposit_deducted IS DISTINCT FROM OLD.deposit_deducted
    OR NEW.deposit_refunded IS DISTINCT FROM OLD.deposit_refunded
    OR NEW.deposit_refund_method IS DISTINCT FROM OLD.deposit_refund_method
    OR NEW.rent_date IS DISTINCT FROM OLD.rent_date
    OR NEW.due_date IS DISTINCT FROM OLD.due_date
    OR NEW.returned_on IS DISTINCT FROM OLD.returned_on
    OR NEW.condition IS DISTINCT FROM OLD.condition
    OR NEW.buffer_days IS DISTINCT FROM OLD.buffer_days
    OR NEW.actual_pickup_at IS DISTINCT FROM OLD.actual_pickup_at
    OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
    OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
    OR NEW.staff_id IS DISTINCT FROM OLD.staff_id
    OR NEW.token IS DISTINCT FROM OLD.token
  ) THEN
    RAISE EXCEPTION 'Rental amounts, dates and status can only be changed through the rental workflows';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_rental(p_rental_id uuid, p_total numeric, p_security_deposit numeric, p_notes text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid UUID;
  v_rental RECORD;
  v_status TEXT;
  v_gross NUMERIC;
  v_discount NUMERIC;
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

  -- books must stay consistent: total = items + fees - discount. A lower total is recorded as a discount;
  -- a total above items + fees is refused (fees are added through the return flow).
  SELECT COALESCE(SUM(subtotal), 0) + COALESCE(v_rental.extra_fees, 0) INTO v_gross
  FROM public.rental_items WHERE rental_id = p_rental_id;

  IF round(p_total, 2) > round(v_gross, 2) THEN
    RAISE EXCEPTION 'Total (%) cannot exceed items plus fees (%)', p_total, v_gross;
  END IF;
  v_discount := round(v_gross - p_total, 2);

  v_status := CASE
    WHEN COALESCE(v_rental.advance, 0) >= p_total THEN 'paid'
    WHEN COALESCE(v_rental.advance, 0) > 0 THEN 'partial'
    ELSE 'unpaid'
  END;

  UPDATE public.rentals
  SET total = round(p_total, 2),
      discount = v_discount,
      security_deposit = p_security_deposit,
      notes = COALESCE(p_notes, notes),
      payment_status = v_status,
      updated_at = NOW()
  WHERE id = p_rental_id;

  INSERT INTO public.audit_log (performed_by, via, action, table_name, record_id, reason, old_data, new_data)
  VALUES (
    v_uid, 'app', 'update', 'rentals', p_rental_id, btrim(p_reason),
    jsonb_build_object('total', v_rental.total, 'discount', v_rental.discount, 'security_deposit', v_rental.security_deposit,
                       'notes', v_rental.notes, 'payment_status', v_rental.payment_status),
    jsonb_build_object('total', p_total, 'discount', v_discount, 'security_deposit', p_security_deposit,
                       'notes', COALESCE(p_notes, v_rental.notes), 'payment_status', v_status)
  );

  RETURN jsonb_build_object('success', true, 'payment_status', v_status);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_booking_atomic(text, uuid, uuid, date, text, uuid, numeric, numeric, numeric, jsonb, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_booking_atomic(text, uuid, uuid, date, text, uuid, numeric, numeric, numeric, jsonb, numeric) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- After applying: run qa/reconcile.mjs (must still pass), then the Phase 3 discount tests (FINANCE_AUDIT F15):
--   items 5,000, discount 500, advance 1,000, deposit 1,500  ->  total 4,500, pickup payment must be 3,500
--   discount 6,000 on items 5,000 -> rejected;  discount -1 -> rejected;  direct API update of discount -> rejected
--   admin_update_rental total 4,000 on a 5,000-items rental -> discount 1,000;  total 5,500 -> rejected;  total < advance -> rejected
