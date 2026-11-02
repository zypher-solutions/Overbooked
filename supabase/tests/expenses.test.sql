-- Expenses: who may add, see, change and delete them, and that the totals match the records.
-- Run: npx supabase db reset && npx supabase test db   (uses the seeded demo shops; everything is rolled back)
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(22);

\set bridal_owner '''aaaaaaaa-0000-0000-0000-000000000011'''
\set bridal_manager '''aaaaaaaa-0000-0000-0000-000000000012'''
\set bridal_staff '''aaaaaaaa-0000-0000-0000-000000000013'''
\set groom_owner '''aaaaaaaa-0000-0000-0000-000000000021'''
\set zypher '''aaaaaaaa-0000-0000-0000-000000000001'''
\set mg_road '''b0000000-0000-0000-0000-000000000001'''
\set thrissur '''b0000000-0000-0000-0000-000000000002'''

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
GRANT EXECUTE ON FUNCTION pg_temp.act_as(uuid), pg_temp.as_postgres() TO authenticated;
CREATE TEMP TABLE t_ids (name text PRIMARY KEY, id uuid);
GRANT ALL ON t_ids TO authenticated;

-- staff cannot add
SELECT pg_temp.act_as(:bridal_staff);
SELECT throws_like($$ SELECT public.add_expense('{"branch_id": "b0000000-0000-0000-0000-000000000001", "spent_on": "2026-01-05", "category": "Rent", "amount": 100}') $$,
  'Your role (staff) cannot do this', 'counter staff cannot add an expense');

-- a manager adds in their own branch only
SELECT pg_temp.act_as(:bridal_manager);
SELECT lives_ok($$ SELECT public.add_expense('{"branch_id": "b0000000-0000-0000-0000-000000000001", "spent_on": "2026-01-05", "category": "Dry-cleaning", "amount": 250.50, "note": "QA"}') $$,
  'a manager adds an expense for their branch');
INSERT INTO t_ids SELECT 'mg', id FROM expenses WHERE note = 'QA';
SELECT throws_like($$ SELECT public.add_expense('{"branch_id": "b0000000-0000-0000-0000-000000000002", "spent_on": "2026-01-05", "category": "Rent", "amount": 100}') $$,
  'You can only work with your own branch', 'but not for another branch');
SELECT throws_like($$ SELECT public.add_expense('{"branch_id": "b0000000-0000-0000-0000-000000000001", "spent_on": "2026-01-05", "category": "Rent", "amount": 0}') $$,
  'Enter an amount above zero', 'the amount must be above zero');
SELECT throws_like($$ SELECT public.add_expense('{"branch_id": "b0000000-0000-0000-0000-000000000001", "spent_on": "2999-01-05", "category": "Rent", "amount": 10}') $$,
  'Choose the date it was spent%', 'not in the future');
SELECT throws_like($$ SELECT public.add_expense('{"branch_id": "b0000000-0000-0000-0000-000000000001", "spent_on": "2026-01-05", "category": " ", "amount": 10}') $$,
  'Choose a category', 'a category is needed');

-- the owner adds for the other branch
SELECT pg_temp.act_as(:bridal_owner);
SELECT lives_ok($$ SELECT public.add_expense('{"branch_id": "b0000000-0000-0000-0000-000000000002", "spent_on": "2026-01-06", "category": "Rent", "amount": 1000, "note": "QA2"}') $$,
  'the owner adds an expense for any branch');
INSERT INTO t_ids SELECT 'th', id FROM expenses WHERE note = 'QA2';

-- who sees what
SELECT is((SELECT count(*) FROM expenses), 2::bigint, 'the owner sees every branch');
SELECT pg_temp.act_as(:bridal_manager);
SELECT is((SELECT count(*) FROM expenses), 1::bigint, 'a manager sees their own branch');
SELECT pg_temp.act_as(:bridal_staff);
SELECT is((SELECT count(*) FROM expenses), 0::bigint, 'counter staff see none');
SELECT pg_temp.act_as(:groom_owner);
SELECT is((SELECT count(*) FROM expenses), 0::bigint, 'another shop sees none');
SELECT pg_temp.act_as(:zypher);
SELECT is((SELECT count(*) FROM expenses), 0::bigint, 'Zypher sees none');
SELECT pg_temp.act_as(:bridal_owner);
SELECT throws_like($$ INSERT INTO expenses (shop_id, branch_id, spent_on, category, amount)
  VALUES ('5a000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '2026-01-05', 'Rent', 1) $$,
  'permission denied%', 'nothing is written to the table directly');

-- totals equal the records
SELECT is((public.expense_summary('2026-01-01', '2026-01-31') ->> 'total')::numeric, 1250.50::numeric, 'the total for all branches');
SELECT is((public.expense_summary('2026-01-01', '2026-01-31', :mg_road) ->> 'total')::numeric, 250.50::numeric, 'the total for one branch');
SELECT is((SELECT sum((x ->> 'amount')::numeric) FROM jsonb_array_elements(public.expense_summary('2026-01-01', '2026-01-31') -> 'by_category') x),
  1250.50::numeric, 'the categories add up to the total');
SELECT is((public.expense_summary('2026-02-01', '2026-02-28') ->> 'total')::numeric, 0::numeric, 'a month without expenses is zero');

-- only the owner changes or deletes, with a reason, and it is audited
SELECT pg_temp.act_as(:bridal_manager);
SELECT throws_like(format($f$ SELECT public.delete_expense(%L, 'wrong entry') $f$, (SELECT id FROM t_ids WHERE name = 'mg')),
  'Your role (manager) cannot do this', 'a manager cannot delete an expense');
SELECT pg_temp.act_as(:bridal_owner);
SELECT throws_like(format($f$ SELECT public.update_expense(%L, '{"amount": 300}', '') $f$, (SELECT id FROM t_ids WHERE name = 'mg')),
  'A reason%', 'a correction needs a reason');
SELECT lives_ok(format($f$ SELECT public.update_expense(%L, '{"amount": 300}', 'typed the wrong amount') $f$, (SELECT id FROM t_ids WHERE name = 'mg')),
  'the owner corrects an amount');
SELECT lives_ok(format($f$ SELECT public.delete_expense(%L, 'entered twice') $f$, (SELECT id FROM t_ids WHERE name = 'th')),
  'the owner deletes an expense');
SELECT pg_temp.as_postgres();
SELECT is((SELECT count(*) FROM audit_log WHERE table_name = 'expenses'), 2::bigint, 'both are in the audit log');

SELECT * FROM finish();
ROLLBACK;
