-- Accessories (migration 044): the count is a real limit over dates, an agreed price, product links in the activity log.
-- Run: npx supabase db reset && npx supabase test db   (uses the seeded demo shops; everything is rolled back)
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(14);

\set bridal_staff '''aaaaaaaa-0000-0000-0000-000000000013'''
\set bridal_shop '''5a000000-0000-0000-0000-000000000001'''

CREATE FUNCTION pg_temp.act_as(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;
CREATE FUNCTION pg_temp.as_postgres() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END $$;
CREATE FUNCTION pg_temp.ist(p_days integer, p_time text) RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$
  SELECT ((CURRENT_DATE + p_days) + p_time::time) AT TIME ZONE 'Asia/Kolkata';
$$;
-- a booking of one piece (gold saree, or the red lehenga with p_lehenga) with some ties
CREATE FUNCTION pg_temp.book(p_from integer, p_to integer, p_ties integer, p_phone text, p_lehenga boolean DEFAULT false) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.create_rental(jsonb_build_object(
    'branch_id', 'b0000000-0000-0000-0000-000000000001', 'start_at', pg_temp.ist(p_from, '10:00'), 'end_at', pg_temp.ist(p_to, '10:00'),
    'lines', jsonb_build_array(jsonb_build_object('variation_id', CASE WHEN p_lehenga THEN 'e0000000-0000-0000-0000-000000000011' ELSE 'e0000000-0000-0000-0000-000000000012' END, 'qty', 1)),
    'add_ons', jsonb_build_array(jsonb_build_object('add_on_id', (SELECT id FROM public.add_ons WHERE name = 'QA Tie'), 'quantity', p_ties)),
    'customer', jsonb_build_object('full_name', 'QA Tie ' || p_phone, 'phone', p_phone)));
$$;
GRANT EXECUTE ON FUNCTION pg_temp.act_as(uuid), pg_temp.as_postgres(), pg_temp.ist(integer, text),
  pg_temp.book(integer, integer, integer, text, boolean) TO authenticated;
-- the stock check runs when a change is saved; here, at once
SET CONSTRAINTS ALL IMMEDIATE;

-- the shop owns 3 ties
INSERT INTO add_ons (shop_id, name, basis, amount, quantity) VALUES (:bridal_shop, 'QA Tie', 'per_rental', 50, 3);

SELECT pg_temp.act_as(:bridal_staff);
SELECT lives_ok($$ SELECT pg_temp.book(70, 72, 2, '9000000091') $$, 'a booking takes 2 of the 3 ties');
SELECT throws_like($$ SELECT pg_temp.book(71, 73, 2, '9000000092') $$, 'Only 1 QA Tie is free for these dates%',
  'an overlapping booking cannot take 2 more');
SELECT lives_ok($$ SELECT pg_temp.book(71, 73, 1, '9000000093') $$, 'but it can take the last one');
SELECT throws_like($$ SELECT pg_temp.book(70, 71, 1, '9000000094', true) $$, 'Only 0 QA Tie are free%', 'none is left on day 71');
SELECT lives_ok($$ SELECT pg_temp.book(80, 81, 3, '9000000095') $$, 'later dates have all 3 again');
SELECT is((SELECT free FROM public.add_on_free(pg_temp.ist(70, '10:00'), pg_temp.ist(72, '10:00'))
           WHERE add_on_id = (SELECT id FROM add_ons WHERE name = 'QA Tie')), 0, 'the checkout sees none free on days 70 to 72');
SELECT is((SELECT free FROM public.add_on_free(pg_temp.ist(74, '10:00'), pg_temp.ist(76, '10:00'))
           WHERE add_on_id = (SELECT id FROM add_ons WHERE name = 'QA Tie')), 3, 'and all 3 free between the bookings');
SELECT is((SELECT pieces FROM rental_add_ons ra JOIN rentals r ON r.id = ra.rental_id JOIN customers c ON c.id = r.customer_id
           WHERE c.phone = '9000000091'), 2, 'the pieces are saved on the booking');

-- moving a booking onto other dates is checked too
SELECT pg_temp.as_postgres();
SELECT throws_like($$ UPDATE rentals SET end_at = pg_temp.ist(81, '10:00')
                      WHERE customer_id = (SELECT id FROM customers WHERE phone = '9000000091') $$,
  'Only 0 QA Tie%', 'stretching a booking into a day with no ties left is refused');

-- an agreed price for an accessory
SELECT pg_temp.act_as(:bridal_staff);
SELECT is((public.quote_rental(jsonb_build_object('branch_id', 'b0000000-0000-0000-0000-000000000001',
            'start_at', pg_temp.ist(90, '10:00'), 'end_at', pg_temp.ist(91, '10:00'),
            'lines', '[{"variation_id": "e0000000-0000-0000-0000-000000000012", "qty": 1}]'::jsonb,
            'add_ons', jsonb_build_array(jsonb_build_object('add_on_id', (SELECT id FROM add_ons WHERE name = 'QA Tie'), 'quantity', 2, 'amount_override', 30))))
           -> 'add_ons' -> 0 ->> 'amount')::numeric, 30::numeric, 'the agreed price replaces 2 x 50');
SELECT is((public.quote_rental(jsonb_build_object('branch_id', 'b0000000-0000-0000-0000-000000000001',
            'start_at', pg_temp.ist(90, '10:00'), 'end_at', pg_temp.ist(91, '10:00'),
            'lines', '[{"variation_id": "e0000000-0000-0000-0000-000000000012", "qty": 1}]'::jsonb,
            'add_ons', jsonb_build_array(jsonb_build_object('add_on_id', (SELECT id FROM add_ons WHERE name = 'QA Tie'), 'quantity', 2))))
           ->> 'total_before_discount')::numeric
        - (public.quote_rental(jsonb_build_object('branch_id', 'b0000000-0000-0000-0000-000000000001',
            'start_at', pg_temp.ist(90, '10:00'), 'end_at', pg_temp.ist(91, '10:00'),
            'lines', '[{"variation_id": "e0000000-0000-0000-0000-000000000012", "qty": 1}]'::jsonb)) ->> 'total_before_discount')::numeric,
  100::numeric, 'the total adds the accessories to the items');
SELECT throws_like($$ SELECT public.quote_rental(jsonb_build_object('branch_id', 'b0000000-0000-0000-0000-000000000001',
            'start_at', pg_temp.ist(90, '10:00'), 'end_at', pg_temp.ist(91, '10:00'),
            'lines', '[{"variation_id": "e0000000-0000-0000-0000-000000000012", "qty": 1}]'::jsonb,
            'add_ons', jsonb_build_array(jsonb_build_object('add_on_id', (SELECT id FROM add_ons WHERE name = 'QA Tie'), 'amount_override', -5)))) $$,
  'The price of QA Tie cannot be negative', 'a negative agreed price is refused');

-- an accessory without a count is never limited
SELECT pg_temp.as_postgres();
UPDATE add_ons SET quantity = NULL WHERE name = 'QA Tie';
SELECT pg_temp.act_as(:bridal_staff);
SELECT lives_ok($$ SELECT pg_temp.book(71, 72, 5, '9000000096', true) $$, 'with no count, any number can go');

-- linking it to a product is in the activity log
SELECT pg_temp.as_postgres();
UPDATE add_ons SET product_ids = ARRAY[(SELECT product_id FROM product_variations WHERE id = 'e0000000-0000-0000-0000-000000000012')]
WHERE name = 'QA Tie';
SELECT ok(EXISTS (SELECT 1 FROM activity_log WHERE action = 'extra_changed' AND record_label = 'QA Tie' AND changes ? 'Suggested with'),
  'what an accessory is suggested with is logged');

SELECT * FROM finish();
ROLLBACK;
