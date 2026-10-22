-- ==============================================================================
-- PHASE 1: Harden pickup_booking_atomic
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.pickup_booking_atomic(
    p_booking_id uuid,
    p_expected_return_date date,
    p_pickup_payment numeric,
    p_staff_id uuid,
    p_payment_method text
) RETURNS uuid
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_catalog
AS $$
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

  IF v_user_role IS NULL OR NOT v_is_active THEN
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
  IF v_user_role IN ('manager', 'staff') AND v_booking.branch_id != v_my_branch_id THEN
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
    total, advance, security_deposit, payment_status, status, notes
  ) VALUES (
    v_rental_token, v_booking.customer_id, v_booking.branch_id, v_actual_staff_id, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE, NOW(), 
    v_due_date, COALESCE(v_buffer_days, 0),
    v_new_rental_total, v_total_paid, v_booking.security_deposit, v_payment_status, 'out', v_booking.notes
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
$$;


-- ==============================================================================
-- PHASE 2: OBSOLETE DIRECT RENTAL
-- ==============================================================================

DROP FUNCTION IF EXISTS public.create_rental_atomic(uuid, uuid, date, date, numeric, numeric, numeric, text, text, int, text, jsonb);


-- ==============================================================================
-- PHASE 3: mark_returned_atomic
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.mark_returned_atomic(
    p_rental_id uuid,
    p_returned_on timestamp with time zone,
    p_payment_status text,
    p_condition text,
    p_notes text,
    p_total numeric,
    p_advance numeric,
    p_extra_fees numeric,
    p_extra_fees_reason text,
    p_items jsonb, -- Array of { rental_item_id, inventory_item_id, condition, return_notes }
    p_settlement_payment numeric,
    p_payment_method text
) RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_role TEXT;
  v_is_active BOOLEAN;
  v_my_branch_id UUID;
  v_actual_staff_id UUID;
  
  v_rental RECORD;
  v_item_record RECORD;
  v_ritem JSONB;
  v_ritem_id UUID;
  v_inv_id UUID;
  v_unit_condition TEXT;
  v_unit_notes TEXT;
  
  v_fallback_inv_ids UUID[];
  v_fallback_inv_id UUID;
  v_valid_mapping BOOLEAN;
  v_expected_mapping_count INT;
  v_provided_mapping_count INT;
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

  IF v_user_role IS NULL OR NOT v_is_active THEN
    RAISE EXCEPTION 'Unauthorized or inactive profile';
  END IF;

  -- 1. Load Rental securely
  SELECT * INTO v_rental FROM public.rentals WHERE id = p_rental_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental not found';
  END IF;

  -- Branch Authorization
  IF v_user_role IN ('manager', 'staff') AND v_rental.branch_id != v_my_branch_id THEN
    RAISE EXCEPTION 'Unauthorized branch operation';
  END IF;

  IF v_rental.status = 'returned' THEN
    RAISE EXCEPTION 'Rental is already returned';
  END IF;

  -- ========================================================
  -- CONCURRENCY LOCK
  -- ========================================================
  -- Lock branch to prevent simultaneous rentals/returns from scrambling inventory
  PERFORM pg_advisory_xact_lock(
      hashtextextended('trendz-rental:' || v_rental.branch_id::TEXT, 0)
  );

  -- ========================================================
  -- INVENTORY RESTORATION & VALIDATION
  -- ========================================================
  
  -- 1. Process LEGACY fallback for missing mappings 
  -- Find any rental_items that do NOT have rental_item_inventory mappings.
  -- We strictly FAIL instead of blindly guessing physical inventory.
  FOR v_item_record IN 
    SELECT ri.id
    FROM public.rental_items ri 
    WHERE ri.rental_id = p_rental_id 
    AND NOT EXISTS (
      SELECT 1 FROM public.rental_item_inventory rii WHERE rii.rental_item_id = ri.id
    )
  LOOP
    RAISE EXCEPTION 'Cannot return rental: physical inventory mapping is missing for rental item %.', v_item_record.id;
  END LOOP;

  -- 2. Validate completeness of p_items payload
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Cannot return rental: No physical inventory mappings supplied in payload.';
  END IF;

  SELECT COUNT(*) INTO v_expected_mapping_count 
  FROM public.rental_item_inventory rii
  JOIN public.rental_items ri ON ri.id = rii.rental_item_id
  WHERE ri.rental_id = p_rental_id;

  SELECT COUNT(DISTINCT CONCAT(value->>'rental_item_id', '-', value->>'inventory_item_id'))
  INTO v_provided_mapping_count
  FROM jsonb_array_elements(p_items) AS value;

  IF v_expected_mapping_count != v_provided_mapping_count OR jsonb_array_length(p_items) != v_expected_mapping_count THEN
    RAISE EXCEPTION 'Cannot return rental: Incomplete or duplicate physical inventory mappings. Expected % unique mappings, but payload contained % unique and % total items.', v_expected_mapping_count, v_provided_mapping_count, jsonb_array_length(p_items);
  END IF;

  -- 3. Process explicitly mapped items (from Return Modal)
  FOR v_ritem IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_ritem_id := NULLIF(v_ritem->>'rental_item_id', '')::UUID;
    v_inv_id := NULLIF(v_ritem->>'inventory_item_id', '')::UUID;
    v_unit_condition := v_ritem->>'condition';
    v_unit_notes := v_ritem->>'return_notes';
    
    IF v_ritem_id IS NULL OR v_inv_id IS NULL THEN
      RAISE EXCEPTION 'Cannot return rental: Missing rental_item_id or inventory_item_id in payload.';
    END IF;

    -- VALIDATION A: rental_item_id must belong to p_rental_id
    -- VALIDATION B: inventory_item_id must be mapped to that exact rental item
    SELECT EXISTS (
      SELECT 1
      FROM public.rental_item_inventory rii
      JOIN public.rental_items ri ON ri.id = rii.rental_item_id
      WHERE ri.rental_id = p_rental_id
        AND rii.rental_item_id = v_ritem_id
        AND rii.inventory_item_id = v_inv_id
    ) INTO v_valid_mapping;

    IF NOT v_valid_mapping THEN
      RAISE EXCEPTION 'Cannot return rental: Invalid or foreign inventory mapping supplied for rental item % and inventory item %.', v_ritem_id, v_inv_id;
    END IF;

    UPDATE public.rental_item_inventory SET 
      condition = v_unit_condition, 
      return_notes = v_unit_notes, 
      returned_at = p_returned_on
    WHERE rental_item_id = v_ritem_id AND inventory_item_id = v_inv_id;

    UPDATE public.inventory_items SET status = 'available' WHERE id = v_inv_id;
  END LOOP;

  -- ========================================================
  -- RENTAL UPDATE
  -- ========================================================
  UPDATE public.rentals SET 
    status = 'returned',
    payment_status = p_payment_status,
    condition = p_condition,
    returned_on = p_returned_on,
    total = p_total,
    advance = p_advance,
    notes = p_notes,
    extra_fees = p_extra_fees,
    extra_fees_reason = p_extra_fees_reason
  WHERE id = p_rental_id;

  -- Insert settlement payment if applicable
  IF COALESCE(p_settlement_payment, 0) > 0 THEN
    IF p_payment_method IS NULL OR p_payment_method = '' THEN
      RAISE EXCEPTION 'Payment method required for settlement payment';
    END IF;
    INSERT INTO public.payments (
      rental_id, amount, method, paid_at, recorded_by
    ) VALUES (
      p_rental_id, p_settlement_payment, p_payment_method, NOW(), v_actual_staff_id
    );
  END IF;

END;
$$;

-- Explicit grants
GRANT EXECUTE ON FUNCTION public.pickup_booking_atomic(uuid, date, numeric, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_returned_atomic(uuid, timestamp with time zone, text, text, text, numeric, numeric, numeric, text, jsonb, numeric, text) TO authenticated;
