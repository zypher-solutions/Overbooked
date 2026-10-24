-- A busy shop-year for Kalyani Bridal (local only): 300 more pieces, 3,000 customers, 6,000 finished bookings.
\set shop '''5a000000-0000-0000-0000-000000000001'''
\set branch '''b0000000-0000-0000-0000-000000000001'''

CREATE TEMP TABLE size_before AS
SELECT sum(pg_total_relation_size(c.oid)) AS bytes FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r';

-- 30 products x 1 variation x 10 pieces
INSERT INTO products (id, shop_id, category_id, name, sku)
SELECT ('d1000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, :shop, 'c0000000-0000-0000-0000-000000000001', 'Load outfit ' || g, 'LD-' || g
FROM generate_series(1, 30) g;
INSERT INTO product_variations (id, shop_id, product_id, name, sku, turnaround)
SELECT ('e1000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, :shop, ('d1000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'Std', 'LD-' || g || '-S', '1 day'
FROM generate_series(1, 30) g;
INSERT INTO variation_rates (shop_id, variation_id, rate_type, amount)
SELECT :shop, ('e1000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'day', 1000 + g * 50 FROM generate_series(1, 30) g;
INSERT INTO units (shop_id, product_id, variation_id, branch_id, code)
SELECT :shop, ('d1000000-0000-0000-0000-' || lpad(p::text, 12, '0'))::uuid, ('e1000000-0000-0000-0000-' || lpad(p::text, 12, '0'))::uuid, :branch, 'LD-' || p || '-S-' || u
FROM generate_series(1, 30) p, generate_series(1, 10) u;

INSERT INTO customers (shop_id, full_name, phone, address, id_type, id_number)
SELECT :shop, 'Load customer ' || g, '97' || lpad(g::text, 8, '0'), 'House ' || g || ', Kochi', 'aadhaar', 'XXXX-' || g
FROM generate_series(1, 3000) g;

-- 6,000 bookings across the past year, each with 2 pieces, 2 payments and pickup/return checks
DO $$
DECLARE
  v_units uuid[] := ARRAY(SELECT id FROM units WHERE code LIKE 'LD-%' ORDER BY code);
  v_custs uuid[] := ARRAY(SELECT id FROM customers WHERE full_name LIKE 'Load customer %' ORDER BY full_name);
  v_rental uuid;
  v_line uuid;
  v_u1 uuid;
  v_u2 uuid;
  v_start timestamptz;
  i integer;
  k integer;
  v_var uuid;
  v_unit uuid;
  v_rate numeric;
BEGIN
  FOR i IN 0..5999 LOOP
    -- each piece gets a booking every ~18 days, so no two overlap
    v_start := now() - interval '365 days' + ((i / 150) * interval '9 days') + ((i % 150) * interval '1 minute');
    v_u1 := v_units[(i % 150) * 2 + 1];
    v_u2 := v_units[(i % 150) * 2 + 2];
    INSERT INTO rentals (shop_id, branch_id, customer_id, token, status, start_at, end_at, actual_start_at, actual_end_at, deposit_agreed, notes)
    VALUES ('5a000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', v_custs[(i % 3000) + 1], '', 'completed',
            v_start, v_start + interval '2 days', v_start, v_start + interval '2 days', 2000, CASE WHEN i % 5 = 0 THEN 'Wedding on Sunday' END)
    RETURNING id INTO v_rental;
    FOREACH v_unit IN ARRAY ARRAY[v_u1, v_u2] LOOP
      SELECT variation_id INTO v_var FROM units WHERE id = v_unit;
      SELECT amount INTO v_rate FROM variation_rates WHERE variation_id = v_var AND rate_type = 'day';
      INSERT INTO rental_lines (shop_id, rental_id, product_id, variation_id, kind, description, sku, qty, rate_type, rate, time_units, amount)
      SELECT '5a000000-0000-0000-0000-000000000001', v_rental, v.product_id, v.id, 'wearable', 'Load outfit - Std', v.sku, 1, 'day', v_rate, 2, v_rate * 2
      FROM product_variations v WHERE v.id = v_var
      RETURNING id INTO v_line;
      INSERT INTO unit_reservations (shop_id, rental_id, line_id, unit_id, period, state)
      VALUES ('5a000000-0000-0000-0000-000000000001', v_rental, v_line, v_unit, tstzrange(v_start, v_start + interval '3 days', '[)'), 'returned');
    END LOOP;
    INSERT INTO payments (shop_id, rental_id, kind, amount, method, paid_at, note)
    SELECT '5a000000-0000-0000-0000-000000000001', v_rental, 'payment', round(total / 2, 2), 'upi', v_start, 'Advance' FROM rentals WHERE id = v_rental;
    INSERT INTO payments (shop_id, rental_id, kind, amount, method, paid_at, note)
    SELECT '5a000000-0000-0000-0000-000000000001', v_rental, 'payment', total - paid, 'cash', v_start + interval '2 days', 'At return' FROM rentals WHERE id = v_rental;
    INSERT INTO payments (shop_id, rental_id, kind, amount, method, paid_at) VALUES
      ('5a000000-0000-0000-0000-000000000001', v_rental, 'deposit', 2000, 'cash', v_start),
      ('5a000000-0000-0000-0000-000000000001', v_rental, 'deposit_refund', 2000, 'cash', v_start + interval '2 days');
    FOR k IN 1..2 LOOP
      INSERT INTO rental_checks (shop_id, rental_id, unit_id, phase, condition, notes, photo_paths, checked_at)
      VALUES ('5a000000-0000-0000-0000-000000000001', v_rental, CASE WHEN k = 1 THEN v_u1 ELSE v_u2 END, 'pickup', 'good', NULL,
              ARRAY['5a000000-0000-0000-0000-000000000001/' || v_rental || '/p1.jpg'], v_start),
             ('5a000000-0000-0000-0000-000000000001', v_rental, CASE WHEN k = 1 THEN v_u1 ELSE v_u2 END, 'return', 'good', NULL,
              ARRAY['5a000000-0000-0000-0000-000000000001/' || v_rental || '/r1.jpg'], v_start + interval '2 days');
    END LOOP;
  END LOOP;
END $$;

ANALYZE;
SELECT round((sum(pg_total_relation_size(c.oid)) - (SELECT bytes FROM size_before)) / 1048576.0, 1) AS mb_added,
       (SELECT count(*) FROM rentals WHERE shop_id = '5a000000-0000-0000-0000-000000000001') AS rentals,
       (SELECT count(*) FROM payments WHERE shop_id = '5a000000-0000-0000-0000-000000000001') AS payments
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r';
