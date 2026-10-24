# Database

All schema lives in `supabase/migrations/`, applied in filename order. `npx supabase db reset` rebuilds
from zero, which is the test that the chain is complete.

## Where the schema came from
TRENDZ created its base tables in the Supabase dashboard, so its repo only had *changes* to them.
For Overbooked, `20260901000000_baseline.sql` **rebuilds those base tables** from what the app code and
the later migrations use. It was not copied from any TRENDZ database. Everything after it is the
TRENDZ migration history, unchanged.

Things the baseline had to guess (no source available), worth revisiting:
- `deduct_stock_on_rental`, `restore_stock_on_return`, `guard_inventory_direct_update` existed in TRENDZ
  but their bodies were never in the repo. Here they are inert placeholders and are not attached to any table.
- `check_availability` / `get_eligible_physical_units` are SQL versions of the logic in
  `src/lib/overbooked/availability.ts`. The app currently uses the TypeScript version.
- Unique keys: branch name/slug, category name (case-insensitive), product/variation/unit SKU.

## Tables
| Table | Purpose |
| --- | --- |
| branches | shop locations (`is_active` locks out its staff when false) |
| profiles | one per login: role, branch, active flag (created by trigger on sign-up, inactive) |
| customers | name + phone; same phone with a different name = a separate customer |
| categories | product groups, `base_sku` prefix (2–6 capitals) |
| products | catalog item, SKU `AB-001`, purchase price, active flag |
| product_variations | color/size combos, own SKU and daily rate |
| product_stock | total units per variation per branch |
| inventory_items | each physical unit: `item_sku`, status available/rented/maintenance/lost |
| bookings / booking_items / booking_item_inventory | future reservations of exact units |
| rentals / rental_items / rental_item_inventory | items out with a customer, return condition per unit |
| payments | money received against a rental (immutable except by super_admin) |
| ledger_entries | append-only money log (in, out, deposits, refunds, adjustments) |
| audit_log | every delete and admin correction, with reason |

Views: `v_collected_monthly`, `v_earned_monthly`.

## Functions the app calls (RPC)
`create_booking_atomic`, `cancel_booking_atomic`, `pickup_booking_atomic`, `extend_rental_atomic`,
`record_rental_payment`, `mark_returned_atomic`, `import_products_atomic`, `delete_or_deactivate_product`,
`get_my_role`, `get_staff_emails`, `get_booking_token`, `admin_set_staff_status`,
`admin_update_payment`, `admin_delete_payment`, `admin_update_rental`, `admin_delete_rental`,
`admin_delete_booking`.

All are `SECURITY DEFINER`: they run with owner rights, so each one checks `auth.uid()`, role, active
flag and branch itself.

## Rules of thumb
- New change = new migration file. Never edit an old migration once it has been deployed anywhere.
- Money: `numeric(14,2)`, never floats; checks enforce whole paise and non-negative values.
- Direct table UPDATE/DELETE of money, status and records is blocked by triggers. Go through the RPCs.
