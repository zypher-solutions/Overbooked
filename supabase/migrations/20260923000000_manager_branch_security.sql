-- Migration: Manager Branch Security
-- Description: Implement strictly isolated branch security for Managers while preserving Owner/Super Admin global access.

-- 1. Update profiles_role_check
ALTER TABLE "public"."profiles" DROP CONSTRAINT IF EXISTS "profiles_role_check";
ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['super_admin'::text, 'owner'::text, 'manager'::text, 'staff'::text])));

-- 2. Clean out old overly permissive or incomplete policies

-- product_stock
DROP POLICY IF EXISTS "manage_stock" ON "public"."product_stock";
DROP POLICY IF EXISTS "read_stock" ON "public"."product_stock";
DROP POLICY IF EXISTS "staff_update_stock" ON "public"."product_stock";

-- inventory_items
DROP POLICY IF EXISTS "Enable delete for authenticated users only" ON "public"."inventory_items";
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON "public"."inventory_items";
DROP POLICY IF EXISTS "Enable read access for all users" ON "public"."inventory_items";
DROP POLICY IF EXISTS "Enable update for authenticated users only" ON "public"."inventory_items";
DROP POLICY IF EXISTS "update_inventory_items_authenticated" ON "public"."inventory_items";

-- bookings
DROP POLICY IF EXISTS "bookings_insert_authenticated" ON "public"."bookings";
DROP POLICY IF EXISTS "bookings_select_authenticated" ON "public"."bookings";
DROP POLICY IF EXISTS "bookings_update_authenticated" ON "public"."bookings";

-- booking_items
DROP POLICY IF EXISTS "booking_items_insert_authenticated" ON "public"."booking_items";
DROP POLICY IF EXISTS "booking_items_select_authenticated" ON "public"."booking_items";

-- booking_item_inventory
DROP POLICY IF EXISTS "booking_item_inventory_insert_authenticated" ON "public"."booking_item_inventory";
DROP POLICY IF EXISTS "booking_item_inventory_select_authenticated" ON "public"."booking_item_inventory";

-- rentals
DROP POLICY IF EXISTS "update_rentals_authenticated" ON "public"."rentals";
DROP POLICY IF EXISTS "staff_create_rental" ON "public"."rentals";
DROP POLICY IF EXISTS "staff_read_rentals" ON "public"."rentals";
DROP POLICY IF EXISTS "staff_update_rental" ON "public"."rentals";
DROP POLICY IF EXISTS "boss_all_rentals" ON "public"."rentals";

-- rental_items
DROP POLICY IF EXISTS "create_rental_items" ON "public"."rental_items";
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON "public"."rental_items";

-- rental_item_inventory
DROP POLICY IF EXISTS "insert_rental_item_inventory_authenticated" ON "public"."rental_item_inventory";
DROP POLICY IF EXISTS "update_rental_item_inventory_authenticated" ON "public"."rental_item_inventory";
DROP POLICY IF EXISTS "read_rental_item_inventory_authenticated" ON "public"."rental_item_inventory";

-- payments
DROP POLICY IF EXISTS "boss_all_payments" ON "public"."payments";
DROP POLICY IF EXISTS "staff_read_payments" ON "public"."payments";
DROP POLICY IF EXISTS "staff_record_payment" ON "public"."payments";

-- 3. Add strict branch-scoped policies by operation and role

-- Helper logic mapped:
-- Boss = super_admin, owner
-- Mgr = manager
-- Staff = staff

-- product_stock
-- SELECT, UPDATE: Boss(Global) OR Mgr/Staff(Branch)
CREATE POLICY "stock_read" ON "public"."product_stock" FOR SELECT USING ((public.get_my_role() IN ('super_admin', 'owner', 'manager')) OR (public.get_my_role() = 'staff' AND branch_id = public.get_my_branch()));
CREATE POLICY "stock_update" ON "public"."product_stock" FOR UPDATE USING ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() IN ('manager', 'staff') AND branch_id = public.get_my_branch())) WITH CHECK ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() IN ('manager', 'staff') AND branch_id = public.get_my_branch()));
-- INSERT, DELETE: Boss(Global) OR Mgr(Branch)
CREATE POLICY "stock_insert" ON "public"."product_stock" FOR INSERT WITH CHECK ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() = 'manager' AND branch_id = public.get_my_branch()));
CREATE POLICY "stock_delete" ON "public"."product_stock" FOR DELETE USING ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() = 'manager' AND branch_id = public.get_my_branch()));


-- inventory_items
-- SELECT: Boss(Global) OR Mgr/Staff(Branch)
CREATE POLICY "inv_read" ON "public"."inventory_items" FOR SELECT USING ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() IN ('manager', 'staff') AND branch_id = public.get_my_branch()));
-- INSERT, UPDATE, DELETE: Boss(Global) OR Mgr(Branch)
CREATE POLICY "inv_insert" ON "public"."inventory_items" FOR INSERT WITH CHECK ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() = 'manager' AND branch_id = public.get_my_branch()));
CREATE POLICY "inv_update" ON "public"."inventory_items" FOR UPDATE USING ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() = 'manager' AND branch_id = public.get_my_branch())) WITH CHECK ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() = 'manager' AND branch_id = public.get_my_branch()));
CREATE POLICY "inv_delete" ON "public"."inventory_items" FOR DELETE USING ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() = 'manager' AND branch_id = public.get_my_branch()));


-- bookings
-- SELECT, INSERT, UPDATE: Boss(Global) OR Mgr/Staff(Branch)
CREATE POLICY "book_read" ON "public"."bookings" FOR SELECT USING ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() IN ('manager', 'staff') AND branch_id = public.get_my_branch()));
CREATE POLICY "book_insert" ON "public"."bookings" FOR INSERT WITH CHECK ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() IN ('manager', 'staff') AND branch_id = public.get_my_branch()));
CREATE POLICY "book_update" ON "public"."bookings" FOR UPDATE USING ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() IN ('manager', 'staff') AND branch_id = public.get_my_branch())) WITH CHECK ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() IN ('manager', 'staff') AND branch_id = public.get_my_branch()));
-- DELETE: Boss(Global) OR Mgr(Branch)
CREATE POLICY "book_delete" ON "public"."bookings" FOR DELETE USING ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() = 'manager' AND branch_id = public.get_my_branch()));


-- booking_items
-- SELECT, INSERT: Boss(Global) OR Mgr/Staff(Branch via parent)
CREATE POLICY "bitem_read" ON "public"."booking_items" FOR SELECT USING ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() IN ('manager', 'staff') AND EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = booking_items.booking_id AND b.branch_id = public.get_my_branch())));
CREATE POLICY "bitem_insert" ON "public"."booking_items" FOR INSERT WITH CHECK ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() IN ('manager', 'staff') AND EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = booking_items.booking_id AND b.branch_id = public.get_my_branch())));
-- UPDATE, DELETE: Boss(Global) OR Mgr(Branch via parent)
CREATE POLICY "bitem_update" ON "public"."booking_items" FOR UPDATE USING ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() = 'manager' AND EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = booking_items.booking_id AND b.branch_id = public.get_my_branch()))) WITH CHECK ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() = 'manager' AND EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = booking_items.booking_id AND b.branch_id = public.get_my_branch())));
CREATE POLICY "bitem_delete" ON "public"."booking_items" FOR DELETE USING ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() = 'manager' AND EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = booking_items.booking_id AND b.branch_id = public.get_my_branch())));


-- booking_item_inventory
-- SELECT, INSERT: Boss(Global) OR Mgr/Staff(Branch via parent)
CREATE POLICY "biteminv_read" ON "public"."booking_item_inventory" FOR SELECT USING ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() IN ('manager', 'staff') AND EXISTS (SELECT 1 FROM public.booking_items bi JOIN public.bookings b ON b.id = bi.booking_id WHERE bi.id = booking_item_inventory.booking_item_id AND b.branch_id = public.get_my_branch())));
CREATE POLICY "biteminv_insert" ON "public"."booking_item_inventory" FOR INSERT WITH CHECK ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() IN ('manager', 'staff') AND EXISTS (SELECT 1 FROM public.booking_items bi JOIN public.bookings b ON b.id = bi.booking_id WHERE bi.id = booking_item_inventory.booking_item_id AND b.branch_id = public.get_my_branch())));
-- UPDATE, DELETE: Boss(Global) OR Mgr(Branch via parent)
CREATE POLICY "biteminv_update" ON "public"."booking_item_inventory" FOR UPDATE USING ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() = 'manager' AND EXISTS (SELECT 1 FROM public.booking_items bi JOIN public.bookings b ON b.id = bi.booking_id WHERE bi.id = booking_item_inventory.booking_item_id AND b.branch_id = public.get_my_branch()))) WITH CHECK ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() = 'manager' AND EXISTS (SELECT 1 FROM public.booking_items bi JOIN public.bookings b ON b.id = bi.booking_id WHERE bi.id = booking_item_inventory.booking_item_id AND b.branch_id = public.get_my_branch())));
CREATE POLICY "biteminv_delete" ON "public"."booking_item_inventory" FOR DELETE USING ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() = 'manager' AND EXISTS (SELECT 1 FROM public.booking_items bi JOIN public.bookings b ON b.id = bi.booking_id WHERE bi.id = booking_item_inventory.booking_item_id AND b.branch_id = public.get_my_branch())));


-- rentals
-- SELECT, INSERT, UPDATE: Boss(Global) OR Mgr/Staff(Branch)
CREATE POLICY "rental_read" ON "public"."rentals" FOR SELECT USING ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() IN ('manager', 'staff') AND branch_id = public.get_my_branch()));
CREATE POLICY "rental_insert" ON "public"."rentals" FOR INSERT WITH CHECK ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() IN ('manager', 'staff') AND branch_id = public.get_my_branch()));
CREATE POLICY "rental_update" ON "public"."rentals" FOR UPDATE USING ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() IN ('manager', 'staff') AND branch_id = public.get_my_branch())) WITH CHECK ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() IN ('manager', 'staff') AND branch_id = public.get_my_branch()));
-- DELETE: Boss(Global) OR Mgr(Branch)
CREATE POLICY "rental_delete" ON "public"."rentals" FOR DELETE USING ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() = 'manager' AND branch_id = public.get_my_branch()));


-- rental_items
-- SELECT, INSERT: Boss(Global) OR Mgr/Staff(Branch via parent)
CREATE POLICY "ritem_read" ON "public"."rental_items" FOR SELECT USING ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() IN ('manager', 'staff') AND EXISTS (SELECT 1 FROM public.rentals r WHERE r.id = rental_items.rental_id AND r.branch_id = public.get_my_branch())));
CREATE POLICY "ritem_insert" ON "public"."rental_items" FOR INSERT WITH CHECK ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() IN ('manager', 'staff') AND EXISTS (SELECT 1 FROM public.rentals r WHERE r.id = rental_items.rental_id AND r.branch_id = public.get_my_branch())));
-- UPDATE, DELETE: Boss(Global) OR Mgr(Branch via parent)
CREATE POLICY "ritem_update" ON "public"."rental_items" FOR UPDATE USING ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() = 'manager' AND EXISTS (SELECT 1 FROM public.rentals r WHERE r.id = rental_items.rental_id AND r.branch_id = public.get_my_branch()))) WITH CHECK ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() = 'manager' AND EXISTS (SELECT 1 FROM public.rentals r WHERE r.id = rental_items.rental_id AND r.branch_id = public.get_my_branch())));
CREATE POLICY "ritem_delete" ON "public"."rental_items" FOR DELETE USING ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() = 'manager' AND EXISTS (SELECT 1 FROM public.rentals r WHERE r.id = rental_items.rental_id AND r.branch_id = public.get_my_branch())));


-- rental_item_inventory
-- SELECT, INSERT: Boss(Global) OR Mgr/Staff(Branch via parent)
CREATE POLICY "riteminv_read" ON "public"."rental_item_inventory" FOR SELECT USING ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() IN ('manager', 'staff') AND EXISTS (SELECT 1 FROM public.rental_items ri JOIN public.rentals r ON r.id = ri.rental_id WHERE ri.id = rental_item_inventory.rental_item_id AND r.branch_id = public.get_my_branch())));
CREATE POLICY "riteminv_insert" ON "public"."rental_item_inventory" FOR INSERT WITH CHECK ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() IN ('manager', 'staff') AND EXISTS (SELECT 1 FROM public.rental_items ri JOIN public.rentals r ON r.id = ri.rental_id WHERE ri.id = rental_item_inventory.rental_item_id AND r.branch_id = public.get_my_branch())));
-- UPDATE, DELETE: Boss(Global) OR Mgr(Branch via parent)
CREATE POLICY "riteminv_update" ON "public"."rental_item_inventory" FOR UPDATE USING ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() = 'manager' AND EXISTS (SELECT 1 FROM public.rental_items ri JOIN public.rentals r ON r.id = ri.rental_id WHERE ri.id = rental_item_inventory.rental_item_id AND r.branch_id = public.get_my_branch()))) WITH CHECK ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() = 'manager' AND EXISTS (SELECT 1 FROM public.rental_items ri JOIN public.rentals r ON r.id = ri.rental_id WHERE ri.id = rental_item_inventory.rental_item_id AND r.branch_id = public.get_my_branch())));
CREATE POLICY "riteminv_delete" ON "public"."rental_item_inventory" FOR DELETE USING ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() = 'manager' AND EXISTS (SELECT 1 FROM public.rental_items ri JOIN public.rentals r ON r.id = ri.rental_id WHERE ri.id = rental_item_inventory.rental_item_id AND r.branch_id = public.get_my_branch())));


-- payments
-- SELECT: Boss(Global) OR Mgr(Branch via parent). Staff = NO SELECT
CREATE POLICY "pay_read" ON "public"."payments" FOR SELECT USING ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() = 'manager' AND EXISTS (SELECT 1 FROM public.rentals r WHERE r.id = payments.rental_id AND r.branch_id = public.get_my_branch())));
CREATE POLICY "pay_insert" ON "public"."payments" FOR INSERT WITH CHECK ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() IN ('manager', 'staff') AND EXISTS (SELECT 1 FROM public.rentals r WHERE r.id = payments.rental_id AND r.branch_id = public.get_my_branch())));
-- UPDATE, DELETE: Boss(Global) OR Mgr(Branch via parent)
CREATE POLICY "pay_update" ON "public"."payments" FOR UPDATE USING ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() = 'manager' AND EXISTS (SELECT 1 FROM public.rentals r WHERE r.id = payments.rental_id AND r.branch_id = public.get_my_branch()))) WITH CHECK ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() = 'manager' AND EXISTS (SELECT 1 FROM public.rentals r WHERE r.id = payments.rental_id AND r.branch_id = public.get_my_branch())));
CREATE POLICY "pay_delete" ON "public"."payments" FOR DELETE USING ((public.get_my_role() IN ('super_admin', 'owner')) OR (public.get_my_role() = 'manager' AND EXISTS (SELECT 1 FROM public.rentals r WHERE r.id = payments.rental_id AND r.branch_id = public.get_my_branch())));

-- categories
CREATE POLICY "mgr_cat_insert" ON "public"."categories" FOR INSERT WITH CHECK (public.get_my_role() = 'manager');

-- products
CREATE POLICY "mgr_prod_insert" ON "public"."products" FOR INSERT WITH CHECK (public.get_my_role() = 'manager');

-- product_variations
CREATE POLICY "mgr_var_insert" ON "public"."product_variations" FOR INSERT WITH CHECK (public.get_my_role() = 'manager');

-- 4. Re-create import_products_atomic with manager logic

CREATE OR REPLACE FUNCTION "public"."import_products_atomic"("p_payload" jsonb) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER SET search_path = public, pg_catalog
    AS $$
DECLARE
  v_cat JSONB;
  v_prod JSONB;
  v_var JSONB;
  v_cat_id UUID;
  v_prod_id UUID;
  v_var_id UUID;
  v_branch_id UUID;
  v_branch_name TEXT;
  v_stock_qty INTEGER;
  
  v_existing_prod RECORD;
  v_existing_var RECORD;
  
  v_existing_inv_count INTEGER;
  v_qty_to_create INTEGER;
  v_next_suffix INTEGER;
  v_max_suffix INTEGER;
  v_item_sku TEXT;
  
  v_cats_created INTEGER := 0;
  v_prods_created INTEGER := 0;
  v_vars_created INTEGER := 0;
  v_units_created INTEGER := 0;
  
  v_user_role TEXT;
  v_is_active BOOLEAN;
  v_my_branch_id UUID;
BEGIN
  -- 0. Authorization Check
  SELECT role, is_active, branch_id INTO v_user_role, v_is_active, v_my_branch_id
  FROM public.profiles 
  WHERE id = auth.uid();

  IF v_user_role IS NULL OR v_is_active != true OR v_user_role NOT IN ('super_admin', 'owner', 'manager') THEN
    RAISE EXCEPTION 'You are not authorized to import products.';
  END IF;

  IF v_user_role = 'manager' AND v_my_branch_id IS NULL THEN
    RAISE EXCEPTION 'Manager must be assigned to a branch.';
  END IF;

  -- 1. Create categories that are listed in newCategories
  FOR v_cat IN SELECT * FROM jsonb_array_elements(p_payload->'newCategories') LOOP
    SELECT id INTO v_cat_id FROM categories WHERE lower(name) = lower(v_cat->>'name');
    IF v_cat_id IS NULL THEN
      INSERT INTO categories (id, name, base_sku) 
      VALUES (
        gen_random_uuid(), 
        v_cat->>'name', 
        v_cat->>'prefix'
      );
      v_cats_created := v_cats_created + 1;
    END IF;
  END LOOP;
  
  -- 2. Iterate products
  FOR v_prod IN SELECT * FROM jsonb_array_elements(p_payload->'products') LOOP
    SELECT id INTO v_cat_id FROM categories WHERE lower(name) = lower(v_prod->>'category');
    IF v_cat_id IS NULL THEN
      RAISE EXCEPTION 'Category % not found and was not created.', v_prod->>'category';
    END IF;
    
    -- Check for existing product by baseSku
    SELECT * INTO v_existing_prod FROM products WHERE sku = v_prod->>'baseSku';
    
    IF v_existing_prod.id IS NOT NULL THEN
      IF lower(v_existing_prod.name) != lower(v_prod->>'name') THEN
        RAISE EXCEPTION 'Product SKU % already exists with name "%" (mismatch with "%")', v_prod->>'baseSku', v_existing_prod.name, v_prod->>'name';
      END IF;
      
      IF v_existing_prod.category_id != v_cat_id THEN
        RAISE EXCEPTION 'Product SKU % already exists with a different category.', v_prod->>'baseSku';
      END IF;
      
      IF (v_prod->>'purchasePrice')::numeric != 0 THEN
        IF v_existing_prod.purchase_price != (v_prod->>'purchasePrice')::numeric THEN
          RAISE EXCEPTION 'Product SKU % already exists with a different purchase price.', v_prod->>'baseSku';
        END IF;
      END IF;
      
      IF v_prod->>'description' IS NOT NULL AND btrim(v_prod->>'description') != '' THEN
        IF COALESCE(v_existing_prod.description, '') != (v_prod->>'description') THEN
          RAISE EXCEPTION 'Product SKU % already exists with a different description.', v_prod->>'baseSku';
        END IF;
      END IF;

      v_prod_id := v_existing_prod.id;
    ELSE
      v_prod_id := gen_random_uuid();
      
      INSERT INTO products (
        id, sku, name, category_id, description, purchase_price, image_url, attributes
      ) VALUES (
        v_prod_id,
        v_prod->>'baseSku',
        v_prod->>'name',
        v_cat_id,
        COALESCE(v_prod->>'description', ''),
        COALESCE((v_prod->>'purchasePrice')::numeric, 0),
        'https://placehold.co/600x600/eeeeee/999999?text=No+Image',
        '[]'::jsonb
      );
      v_prods_created := v_prods_created + 1;
    END IF;
    
    -- 3. Iterate variations
    FOR v_var IN SELECT * FROM jsonb_array_elements(v_prod->'variations') LOOP
      SELECT * INTO v_existing_var FROM product_variations WHERE sku = v_var->>'sku';
      
      IF v_existing_var.id IS NOT NULL THEN
        IF v_existing_var.product_id != v_prod_id THEN
          RAISE EXCEPTION 'Variation SKU % already exists for a different product.', v_var->>'sku';
        END IF;
        
        IF (v_existing_var.attributes->>'Color') != (v_var->>'color') THEN
          RAISE EXCEPTION 'Variation SKU % already exists with a different Color.', v_var->>'sku';
        END IF;
        
        IF (v_existing_var.attributes->>'Size') != (v_var->>'size') THEN
          RAISE EXCEPTION 'Variation SKU % already exists with a different Size.', v_var->>'sku';
        END IF;
        
        IF v_existing_var.daily_rate != COALESCE((v_var->>'dailyRate')::numeric, 0) THEN
          RAISE EXCEPTION 'Variation SKU % already exists with a different daily rate (DB: %, CSV: %).', v_var->>'sku', v_existing_var.daily_rate, COALESCE((v_var->>'dailyRate')::numeric, 0);
        END IF;

        v_var_id := v_existing_var.id;
      ELSE
        v_var_id := gen_random_uuid();
        INSERT INTO product_variations (
          id, product_id, sku, name, daily_rate, is_enabled, attributes
        ) VALUES (
          v_var_id,
          v_prod_id,
          v_var->>'sku',
          (v_prod->>'name') || ' - ' || (v_var->>'color') || ' - ' || (v_var->>'size'),
          COALESCE((v_var->>'dailyRate')::numeric, 0),
          true,
          jsonb_build_object('Color', v_var->>'color', 'Size', v_var->>'size')
        );
        v_vars_created := v_vars_created + 1;
      END IF;
      
      -- Lock the variation for physical SKU generation
      PERFORM pg_advisory_xact_lock(hashtext('var_lock_' || (v_var->>'sku')));
      
      -- 4. Process branch stock
      FOR v_branch_name, v_stock_qty IN SELECT key, value::text::integer FROM jsonb_each(v_var->'stockByBranch') LOOP
        SELECT id INTO v_branch_id FROM branches WHERE lower(name) = lower(v_branch_name);
        IF v_branch_id IS NULL THEN
          RAISE EXCEPTION 'Branch "%" not found.', v_branch_name;
        END IF;
        
        IF v_user_role = 'manager' AND v_branch_id != v_my_branch_id THEN
          RAISE EXCEPTION 'Unauthorized branch "%" in CSV for Manager.', v_branch_name;
        END IF;

        -- Get existing physical units count for this variation AT THIS BRANCH
        SELECT COUNT(*) INTO v_existing_inv_count
        FROM inventory_items
        WHERE variation_id = v_var_id AND branch_id = v_branch_id;
        
        IF v_stock_qty < v_existing_inv_count THEN
          RAISE EXCEPTION 'CSV quantity (%) for variation % at branch % is lower than existing physical units (%). Cannot downsize.', 
            v_stock_qty, v_var->>'sku', v_branch_name, v_existing_inv_count;
        END IF;
        
        v_qty_to_create := v_stock_qty - v_existing_inv_count;
        
        IF v_qty_to_create > 0 THEN
          -- Calculate MAX suffix for the variation across ALL branches
          SELECT COALESCE(MAX(
            (substring(item_sku from char_length(v_var->>'sku') + 2))::integer
          ), 0) INTO v_max_suffix
          FROM inventory_items
          WHERE variation_id = v_var_id
            AND item_sku LIKE (v_var->>'sku') || '-%'
            AND substring(item_sku from char_length(v_var->>'sku') + 2) ~ '^[0-9]+$';
          
          v_next_suffix := v_max_suffix + 1;
          
          -- Insert new physical units
          FOR i IN 1..v_qty_to_create LOOP
            v_item_sku := (v_var->>'sku') || '-' || lpad(v_next_suffix::text, 3, '0');
            
            INSERT INTO inventory_items (
              id, product_id, variation_id, branch_id, item_sku, status
            ) VALUES (
              gen_random_uuid(), v_prod_id, v_var_id, v_branch_id, v_item_sku, 'available'
            );
            
            v_next_suffix := v_next_suffix + 1;
            v_units_created := v_units_created + 1;
          END LOOP;
        END IF;
        
        -- Upsert product_stock
        UPDATE product_stock 
        SET quantity = v_stock_qty 
        WHERE variation_id = v_var_id AND branch_id = v_branch_id;
        
        IF NOT FOUND THEN
          INSERT INTO product_stock (id, product_id, variation_id, branch_id, quantity)
          VALUES (gen_random_uuid(), v_prod_id, v_var_id, v_branch_id, v_stock_qty);
        END IF;
        
      END LOOP;
      
    END LOOP;
  END LOOP;
  
  RETURN jsonb_build_object(
    'success', true,
    'categoriesCreated', v_cats_created,
    'productsCreated', v_prods_created,
    'variationsCreated', v_vars_created,
    'physicalUnitsCreated', v_units_created
  );
END;
$$;
