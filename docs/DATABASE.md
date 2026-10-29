# Database

All schema lives in `supabase/migrations/`, applied in filename order. `npx supabase db reset` rebuilds
from zero; `npx supabase test db` then runs the database tests in `supabase/tests/`.

| Migration | What it holds |
| --- | --- |
| `20261101000000_platform.sql` | business templates, shops, branches, profiles, invites, Zypher billing, counters, audit log, plan limits |
| `20261101000001_catalog.sql` | categories, products, variations, rates, units, sets, add-ons |
| `20261101000002_rentals.sql` | customers, rentals, lines, reservations, add-ons, charges, checks, payments, appointments, money triggers |
| `20261101000003_security.sql` | row-level security, storage buckets, realtime |
| `20261101000004_templates.sql` | the five business types: bridal, groom, resort, car, bike |
| `20261101000005_engine_pricing.sql` | quotes and availability |
| `20261101000006_engine_workflow.sql` | book, pick up, return, charges, payments, extend, cancel |
| `20261101000007_engine_admin.sql` | corrections, catalog tools, reports, staff, Zypher console actions |
| `20261101000008_console.sql` | Zypher console reads: overview numbers and the shop page |
| `20261101000009_app.sql` | Shop app helpers: free counts for the booking picker, saving a product in one go |
| `20261101000010_operations.sql` | Changing a booking, sets, reminders log, Zypher company details and receipts, automatic pause, measurement fields |

## Business types are data
A **template** (`business_templates`) describes a type of business: its kind (`wearable` by day,
`vehicle` by hour/day with km, `room` by night with guests), labels, fields, pickup/return checks, rate
types, turnaround time, default features and add-ons. A shop has one or more types; each category
belongs to one. A new business type later is a new row, plus engine code only if its time or price
logic is new.

Optional features (sets, measurements, alterations, appointments, guests, meal plans, whole property,
with driver) are switched per shop in `shops.settings.features`, defaulting to the template.

## Catalog
`category → product → variation → unit`. A variation (a size, a room type, a car variant) has its rates
in `variation_rates` (hour, day, night, extra_km, extra_hour, extra_person, driver_day, late_penalty).
A unit is one physical thing: a dress piece, room 104, a car by registration number.

## One rental, from booking to return
`rentals.status`: `reserved → active → completed`, or `cancelled` / `no_show`. One token per rental,
`<PREFIX>-YYYY-NNNN`, numbered per shop.

- `rental_lines`: what is rented, with the rate used; `is_override` marks a negotiated price.
- `unit_reservations`: which unit, for which time range (rental time + turnaround). An exclusion
  constraint makes overlapping use of a unit impossible.
- `rental_add_ons`, `rental_charges` (late, extra km, fuel, damage, toll, challan, ...), `rental_checks`
  (condition, odometer, fuel, photos at pickup and return).
- `payments`: every rupee in or out, typed (payment, refund, deposit, deposit_refund, deposit_applied).
  The rental's money columns are kept from it by triggers; `total` is computed.

Checks in the database: total = lines + add-ons + charges − discount (a cancelled rental's total is its
fee); 0 ≤ paid ≤ total; deposit given back + kept ≤ deposit received; end after start; no negative amounts.

## Functions the app calls
| Area | Functions |
| --- | --- |
| Booking | `quote_rental`, `branch_availability`, `find_available_units`, `create_rental`, `update_rental`, `extend_rental`, `cancel_rental`, `swap_unit`, `update_rental_notes`, `mark_reminder_sent` |
| Pickup / return | `start_rental`, `return_suggestions`, `complete_rental` |
| Money | `record_rental_payment`, `add_rental_charge` |
| Corrections (owner, with a reason) | `admin_set_discount`, `admin_set_line_amount`, `admin_update_payment`, `admin_delete_payment`, `admin_delete_charge`, `admin_delete_rental` |
| Catalog | `save_product`, `save_set_items`, `import_catalog`, `delete_or_deactivate_product`, `set_unit_status` |
| Reports | `inventory_status`, `dashboard_summary` |
| Setup (Zypher only, each names the shop) | `setup_branches`, `setup_save_branch`, `setup_delete_branch`, `setup_people`, `setup_set_person`, `setup_check_invite`, `setup_check_person` |
| Shop details (owner) | `update_my_shop` |
| Zypher only | `create_shop`, `update_shop`, `record_shop_payment`, `platform_overview`, `console_summary`, `shop_detail`, `pause_overdue_shops` (also nightly) |

Each function checks the caller's role, branch and shop itself. Shop functions are owned by `app_rpc`,
which is bound by the shop rules, so even a mistake inside one cannot reach another shop.

## Rules of thumb
- Nothing is deployed yet, so migrations can still be edited. After the first deploy: new change = new
  migration file, never edit an old one.
- Money is `numeric(14,2)`, never floats.
- Change rentals and money only through the functions above.
