-- Migration: 20261011000000_sequential_booking_references.sql
-- Purpose:
--   1. Replace randomly generated booking references with global sequential references (BK-0001, BK-0002...).
--   2. Establish database trigger as the single source of truth for reference generation.
--   3. Make sequence initialization safe against re-application (never moving backwards).
--   4. Ensure create_booking_atomic inserts without redundant sequence consumption.
--   5. Maintain uniqueness constraint, global sequence across branches, and proper grants.

-- Step 1: Ensure PostgreSQL sequence exists
CREATE SEQUENCE IF NOT EXISTS public.booking_reference_seq
    INCREMENT BY 1
    MINVALUE 1
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.booking_reference_seq OWNER TO postgres;

-- Step 2: Initialize sequence safely (cannot move an already-advanced sequence backwards)
-- Uses the greatest of:
--   - 8204 (highest historical random suffix)
--   - current sequence last_value (if sequence already advanced)
--   - highest BK- suffix present in public.bookings
DO $$
DECLARE
    v_current_seq BIGINT;
    v_is_called BOOLEAN;
    v_max_booking_num BIGINT := 0;
    v_target_seq BIGINT := 8204;
BEGIN
    -- Read current sequence state directly from the sequence relation
    BEGIN
        SELECT last_value, is_called 
        INTO STRICT v_current_seq, v_is_called 
        FROM public.booking_reference_seq;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Cannot verify state of public.booking_reference_seq directly: %', SQLERRM;
    END;

    -- If sequence was newly created (is_called is false and last_value is 1), treat as 0 so 8204 baseline applies
    IF v_is_called IS FALSE AND v_current_seq = 1 THEN
        v_current_seq := 0;
    END IF;

    -- Scan existing public.bookings for the highest numeric BK- reference
    SELECT COALESCE(MAX(SUBSTRING(token FROM '^BK-([0-9]+)$')::bigint), 0)
    INTO v_max_booking_num
    FROM public.bookings
    WHERE token ~ '^BK-[0-9]+$';

    -- Sequence must never move backwards below 8204, existing sequence progress, or highest booking token
    v_target_seq := GREATEST(v_target_seq, v_current_seq, v_max_booking_num);

    PERFORM setval('public.booking_reference_seq', v_target_seq, true);
END $$;

-- Step 3: Trigger function as the SINGLE source of truth for reference generation
CREATE OR REPLACE FUNCTION public.assign_booking_reference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_seq_val BIGINT;
BEGIN
    -- Every newly created booking MUST receive a database-generated sequential reference.
    -- Client-supplied tokens are unconditionally overridden to guarantee sequence integrity.
    v_seq_val := nextval('public.booking_reference_seq');
    NEW.token := 'BK-' || lpad(v_seq_val::text, GREATEST(4, length(v_seq_val::text)), '0');
    RETURN NEW;
END;
$$;

ALTER FUNCTION public.assign_booking_reference() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_assign_booking_reference ON public.bookings;
CREATE TRIGGER trg_assign_booking_reference
    BEFORE INSERT ON public.bookings
    FOR EACH ROW
    EXECUTE FUNCTION public.assign_booking_reference();

-- Step 4: Update create_booking_atomic (10 parameters)
-- Notice: Does NOT call nextval() itself; inserts NULL so the trigger assigns the sequential reference.
CREATE OR REPLACE FUNCTION public.create_booking_atomic(
    p_token text,
    p_customer_id uuid,
    p_branch_id uuid,
    p_booking_date date,
    p_notes text,
    p_created_by uuid,
    p_total numeric,
    p_advance numeric,
    p_security_deposit numeric,
    p_items jsonb
) RETURNS uuid
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_catalog
    AS $$
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
        SELECT role, branch_id INTO v_caller_role, v_caller_branch
        FROM public.profiles
        WHERE id = v_auth_uid;

        IF v_caller_role IS NULL THEN
            RAISE EXCEPTION 'Unauthorized: Caller profile not found';
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
        security_deposit
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
        COALESCE(p_security_deposit, 0)
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

        IF v_qty <= 0 THEN
            RAISE EXCEPTION 'Quantity must be greater than zero for %', v_product_name;
        END IF;

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

    RETURN v_booking_id;
END;
$$;

ALTER FUNCTION public.create_booking_atomic(text, uuid, uuid, date, text, uuid, numeric, numeric, numeric, jsonb) OWNER TO postgres;

-- Step 5: Update create_booking_atomic (8 parameters overload) for consistency
CREATE OR REPLACE FUNCTION public.create_booking_atomic(
    p_token text,
    p_customer_id uuid,
    p_branch_id uuid,
    p_booking_date date,
    p_status text,
    p_notes text,
    p_created_by uuid,
    p_items jsonb
) RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_catalog
    AS $$
DECLARE
    v_auth_uid UUID;
    v_caller_role TEXT;
    v_caller_branch UUID;
    v_effective_created_by UUID;

    v_item JSONB;
    v_var_id UUID;
    v_qty INTEGER;
    v_pickup DATE;
    v_return DATE;
    v_buffer INTEGER;
    v_booking_id UUID;
    v_booking_item_id UUID;
    v_days INTEGER;
    v_daily_rate NUMERIC;
    v_subtotal NUMERIC;
    v_inv_id_text TEXT;
    v_inv_id UUID;
    v_inv_sku TEXT;
    v_conflict_count INTEGER;
    v_assigned_inv_ids JSONB;
    v_seen_inv_ids UUID[] := '{}';
    v_persisted_token TEXT;
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
        SELECT role, branch_id INTO v_caller_role, v_caller_branch
        FROM public.profiles
        WHERE id = v_auth_uid;

        IF v_caller_role IS NULL THEN
            RAISE EXCEPTION 'Unauthorized: Caller profile not found';
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

    -- Concurrency Lock per branch (matches 10-parameter overload)
    PERFORM pg_advisory_xact_lock(
        hashtextextended('trendz-booking:' || p_branch_id::TEXT, 0)
    );

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_var_id := (v_item->>'variation_id')::uuid;
        v_qty := (v_item->>'qty')::integer;
        v_pickup := (v_item->>'pickup_date')::date;
        v_return := (v_item->>'return_date')::date;
        v_buffer := COALESCE((v_item->>'buffer_days')::integer, 0);
        v_assigned_inv_ids := v_item->'inventory_item_ids';

        IF v_assigned_inv_ids IS NULL OR jsonb_array_length(v_assigned_inv_ids) != v_qty THEN
            RAISE EXCEPTION 'Exactly % physical unit(s) must be explicitly selected for item %', v_qty, (v_item->>'sku');
        END IF;

        FOR v_inv_id_text IN SELECT * FROM jsonb_array_elements_text(v_assigned_inv_ids)
        LOOP
            v_inv_id := v_inv_id_text::uuid;
            IF v_inv_id = ANY(v_seen_inv_ids) THEN
                RAISE EXCEPTION 'Duplicate physical unit selection detected for item %', (v_item->>'sku');
            END IF;
            v_seen_inv_ids := array_append(v_seen_inv_ids, v_inv_id);

            SELECT item_sku INTO v_inv_sku
            FROM public.inventory_items
            WHERE id = v_inv_id
              AND variation_id = v_var_id
              AND branch_id = p_branch_id
              AND status NOT IN ('lost', 'maintenance');

            IF v_inv_sku IS NULL THEN
                RAISE EXCEPTION 'Physical unit % is lost, under maintenance, or invalid for selected branch', v_inv_id;
            END IF;

            SELECT COUNT(*) INTO v_conflict_count
            FROM public.booking_item_inventory bii
            JOIN public.booking_items bi ON bi.id = bii.booking_item_id
            JOIN public.bookings b ON b.id = bi.booking_id
            WHERE bii.inventory_item_id = v_inv_id
              AND b.status IN ('confirmed', 'pending')
              AND bi.pickup_date <= (v_return + v_buffer)
              AND (bi.return_date + bi.buffer_days) >= v_pickup;

            IF v_conflict_count > 0 THEN
                RAISE EXCEPTION 'This physical unit (%) is no longer available for the selected dates. Please select another unit.', v_inv_sku;
            END IF;

            SELECT COUNT(*) INTO v_conflict_count
            FROM public.rental_item_inventory rii
            JOIN public.rental_items ri ON ri.id = rii.rental_item_id
            JOIN public.rentals r ON r.id = ri.rental_id
            WHERE rii.inventory_item_id = v_inv_id
              AND r.status = 'out'
              AND r.rent_date <= (v_return + v_buffer)
              AND (r.due_date + COALESCE(r.buffer_days, 0)) >= v_pickup;

            IF v_conflict_count > 0 THEN
                RAISE EXCEPTION 'This physical unit (%) is currently rented on the selected dates. Please select another unit.', v_inv_sku;
            END IF;
        END LOOP;
    END LOOP;

    -- Create booking (trigger assigns reference)
    INSERT INTO public.bookings (
        token,
        customer_id,
        branch_id,
        booking_date,
        status,
        notes,
        created_by
    )
    VALUES (
        NULL, -- Trigger trg_assign_booking_reference assigns sequential reference
        p_customer_id,
        p_branch_id,
        COALESCE(p_booking_date, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE),
        COALESCE(p_status, 'pending'),
        p_notes,
        v_effective_created_by
    )
    RETURNING id, token INTO v_booking_id, v_persisted_token;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_pickup := (v_item->>'pickup_date')::date;
        v_return := (v_item->>'return_date')::date;
        v_days := GREATEST(1, v_return - v_pickup + 1);
        v_daily_rate := (v_item->>'daily_rate')::numeric;
        v_qty := (v_item->>'qty')::integer;
        v_subtotal := COALESCE((v_item->>'subtotal')::numeric, v_qty * v_daily_rate * v_days);
        v_assigned_inv_ids := v_item->'inventory_item_ids';

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
            (v_item->>'product_id')::uuid,
            (v_item->>'variation_id')::uuid,
            v_item->>'product_name',
            v_item->>'sku',
            v_item->>'image_url',
            v_qty,
            v_daily_rate,
            v_pickup,
            v_return,
            COALESCE((v_item->>'buffer_days')::integer, 0),
            v_subtotal
        )
        RETURNING id INTO v_booking_item_id;

        FOR v_inv_id_text IN SELECT * FROM jsonb_array_elements_text(v_assigned_inv_ids)
        LOOP
            INSERT INTO public.booking_item_inventory (
                booking_item_id,
                inventory_item_id
            )
            VALUES (
                v_booking_item_id,
                v_inv_id_text::uuid
            );
        END LOOP;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'booking_id', v_booking_id,
        'token', v_persisted_token
    );
END;
$$;

ALTER FUNCTION public.create_booking_atomic(text, uuid, uuid, date, text, text, uuid, jsonb) OWNER TO postgres;

-- Step 6: Ensure uniqueness constraint exists on public.bookings(token)
DO $$
DECLARE
    v_has_single_unique BOOLEAN := false;
    v_null_count INTEGER;
    v_dup_count INTEGER;
BEGIN
    -- Check if a single-column unique constraint or single-column unique index already exists on public.bookings(token)
    SELECT EXISTS (
        -- 1. Check pg_constraint for a single-column UNIQUE constraint on public.bookings(token)
        SELECT 1
        FROM pg_catalog.pg_constraint c
        JOIN pg_catalog.pg_class t ON c.conrelid = t.oid
        JOIN pg_catalog.pg_namespace n ON t.relnamespace = n.oid
        JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid AND a.attname = 'token'
        WHERE n.nspname = 'public'
          AND t.relname = 'bookings'
          AND c.contype = 'u'
          AND c.conkey = ARRAY[a.attnum]
    ) OR EXISTS (
        -- 2. Check pg_index for a valid, non-partial, single-column UNIQUE index on public.bookings(token)
        SELECT 1
        FROM pg_catalog.pg_index i
        JOIN pg_catalog.pg_class t ON i.indrelid = t.oid
        JOIN pg_catalog.pg_namespace n ON t.relnamespace = n.oid
        JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid AND a.attname = 'token'
        WHERE n.nspname = 'public'
          AND t.relname = 'bookings'
          AND i.indisunique = true
          AND i.indisvalid = true
          AND i.indpred IS NULL
          AND i.indnatts = 1
          AND (i.indkey[0] = a.attnum OR i.indkey::text = a.attnum::text)
    ) INTO v_has_single_unique;

    IF NOT v_has_single_unique THEN
        -- Check if any NULL or empty/blank tokens exist before attempting to add constraint
        SELECT COUNT(*) INTO v_null_count
        FROM public.bookings
        WHERE token IS NULL OR BTRIM(token) = '';

        IF v_null_count > 0 THEN
            RAISE EXCEPTION 'Cannot add UNIQUE constraint: % booking records have NULL or empty/blank tokens. Please resolve manually without deleting records.', v_null_count;
        END IF;

        -- Check if any duplicate tokens exist before attempting to add constraint
        SELECT COUNT(*) INTO v_dup_count
        FROM (
            SELECT token
            FROM public.bookings
            GROUP BY token
            HAVING COUNT(*) > 1
        ) dups;

        IF v_dup_count > 0 THEN
            RAISE EXCEPTION 'Cannot add UNIQUE constraint: % duplicate booking token values detected in public.bookings. Please resolve duplicates manually without rewriting historical records.', v_dup_count;
        END IF;

        ALTER TABLE public.bookings ADD CONSTRAINT bookings_token_key UNIQUE (token);
    END IF;
END $$;

-- Step 7: Grants on sequence and functions
-- The trigger is SECURITY DEFINER owned by postgres; client roles (authenticated, anon)
-- do NOT need UPDATE or direct sequence access. This prevents clients from calling setval() or manipulating the counter.
REVOKE ALL ON SEQUENCE public.booking_reference_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.booking_reference_seq TO service_role;

REVOKE ALL ON FUNCTION public.assign_booking_reference() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_booking_reference() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_booking_atomic(text, uuid, uuid, date, text, uuid, numeric, numeric, numeric, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_booking_atomic(text, uuid, uuid, date, text, uuid, numeric, numeric, numeric, jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_booking_atomic(text, uuid, uuid, date, text, text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_booking_atomic(text, uuid, uuid, date, text, text, uuid, jsonb) TO authenticated, service_role;

-- Step 8: Secured helper function to retrieve booking token reliably
CREATE OR REPLACE FUNCTION public.get_booking_token(p_booking_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_token TEXT;
    v_role TEXT;
    v_branch UUID;
    v_user_id UUID;
BEGIN
    v_user_id := auth.uid();

    -- Deny unauthenticated callers immediately (no arbitrary access or auth bypass)
    IF v_user_id IS NULL THEN
        RETURN NULL;
    END IF;

    -- Fetch caller role and branch from profiles
    SELECT role, branch_id INTO v_role, v_branch
    FROM public.profiles
    WHERE id = v_user_id;

    -- Deny if user has no profile record
    IF v_role IS NULL THEN
        RETURN NULL;
    END IF;

    -- Retrieve token only if caller is authorized for this booking:
    -- 1. super_admin or owner can access any booking
    -- 2. manager or staff can access bookings for their assigned branch
    -- 3. The staff member who created the booking can access it
    SELECT b.token INTO v_token
    FROM public.bookings b
    WHERE b.id = p_booking_id
      AND (
          v_role IN ('super_admin', 'owner')
          OR (v_role IN ('manager', 'staff') AND (b.branch_id = v_branch OR b.branch_id = public.get_my_branch()))
          OR b.created_by = v_user_id
      );

    RETURN v_token;
END;
$$;

ALTER FUNCTION public.get_booking_token(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_booking_token(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_booking_token(uuid) TO authenticated;
