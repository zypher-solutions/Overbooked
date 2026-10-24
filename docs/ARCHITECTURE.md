# Architecture

## The big picture
```
 Browser (staff on phone / PC)
   │  Next.js app (React UI): src/components/overbooked, src/lib/overbooked/store.tsx
   │
   │  supabase-js over HTTPS (anon key + the user's login token)
   ▼
 Supabase
   ├─ Auth          logins, sessions (JWT)
   ├─ PostgREST     turns tables and functions into a REST API automatically
   ├─ Postgres      the data AND the business rules
   │    ├─ Row Level Security (RLS): which rows each role/branch may see or change
   │    ├─ RPC functions (plpgsql): create booking, pickup, extend, return, payment, cancel ...
   │    └─ Triggers: tokens, ledger, audit log, "records are permanent" guards
   ├─ Storage       product photos (bucket product_images)
   └─ Realtime      pushes table changes so every open screen refreshes
```

There is **no separate backend server**. The browser talks to Supabase directly. Security is therefore
enforced **inside the database**: RLS policies plus `SECURITY DEFINER` functions that check the caller's
role and branch. Anything the browser does (store.tsx) is convenience. The database has the final say.

Next.js hosting (Vercel or similar) only serves the UI. Server actions: `src/app/actions/booking.ts`
(cancel booking) and `src/app/actions/staff.ts` (invites and new shops). The staff actions use the
service-role client (`src/lib/supabase/admin.ts`) only after checking the caller.

## Many shops in one database
Every business row has a `shop_id`, and a shop never sees another shop's data:
1. **Restrictive `shop_isolation` policy** on every table: `shop_id = current_shop_id()`. It is ANDed
   with the role and branch policies.
2. **Composite foreign keys** `(shop_id, x_id) → x(shop_id, id)`, so a row can only point at rows of
   the same shop.
3. **Workflow functions are owned by the role `app_rpc`.** It has no right to skip the rules, so the shop
   policy binds even the `SECURITY DEFINER` functions.

`current_shop_id()` is the user's own shop while that shop is active; for Zypher staff it is the shop
they opened with `switch_shop`. Policy helpers are written as `(SELECT fn())`, so they run once per
query rather than once per row (`20261025000002_rls_performance.sql`).

Per shop: numbering (`BK-0001`, `<PREFIX>-YYYY-NNNN` via `shop_counters`), SKUs, branch names, the
plan (Starter: 1 branch and 3 logins, Pro: 3 branches, Business: unlimited, enforced by triggers),
`paid_until`, and the bank payments Zypher records (`shop_payments`). Photos live under
`product_images/<shop_id>/`.

## Roles
| Role | Scope | Can |
| --- | --- | --- |
| super_admin | Zypher staff, any shop they open | Zypher console, record corrections (audit-logged), everything |
| owner | own shop, all branches | operations, catalog, ledger, branches, staff invites |
| manager | own branch | operations, catalog edits, stock for own branch |
| staff | own branch | bookings, pickups, returns, payments; no ledger, no catalog edits |

`get_my_role()` / `get_my_branch()` return NULL for inactive users, for staff of an inactive branch, and
for everyone in a paused shop, so every policy locks them out automatically.

## Data loading
The app loads every active rental and open booking, plus finished ones from the first day of last month.
Older history loads when the dashboard's From date asks for it. Every list is read in 1,000-row pages,
and stock counts come summed from `get_all_inventory_stats()`. Live updates subscribe to the user's own
shop and trigger one refresh 2 seconds after a burst of changes.

## Core data model
```
branches ─┬─ profiles (staff, role, branch)
          ├─ product_stock (total units per variation per branch)
          └─ inventory_items (one row per physical unit, status)

categories ─ products ─ product_variations ─ inventory_items

customers ─┬─ bookings ─ booking_items ─ booking_item_inventory → inventory_items
           └─ rentals  ─ rental_items  ─ rental_item_inventory  → inventory_items
                     └─ payments

ledger_entries (append-only money log)   audit_log (every delete / admin correction)
```

## Main flows
1. **Booking** (`create_booking_atomic`): the customer is resolved or created, exact units are chosen, and
   the database checks that no other booking or open rental holds those units for the overlapping dates
   (including buffer days for cleaning). Advance and deposit are recorded. The token is `BK-0001`.
2. **Pickup** (`pickup_booking_atomic`): booking → rental (`TRZ-YYYY-NNNN`), units → `rented`. The
   remaining balance must be paid. Early pickup re-prices to the longer period.
3. **Extend** (`extend_rental_atomic`): new due date, extra days are charged, conflicts are re-checked.
4. **Payment** (`record_rental_payment`): the only way to add money later. The amount must be ≤ balance.
5. **Return** (`mark_returned_atomic`): per-unit condition (good → available, damaged → maintenance,
   lost → lost), extra fees, deposit settlement (deducted against fees + refunded), optional final payment.
6. **Cancel booking** (`cancel_booking_atomic`): fee ≤ advance, refund the rest and the deposit, units released.

Every money movement fires a trigger that appends to `ledger_entries`. Dashboards read from it.

## Business invariants (must always hold)
- total = items − discount (+ fees after return)
- balance due = total − payments, never negative; payments never exceed the balance
- deposit refunded + deposit deducted = deposit held; deducted ≤ fees
- a physical unit is never in two overlapping bookings/rentals
- return date ≥ start date; due date ≥ start date
- no negative amounts; money stored in whole paise
- ledger and dashboard totals equal the underlying records

## Known single-tenant assumptions (to change for multi-shop, see ROADMAP)
- One database = one business. There is no `shop_id`, and all branches belong to the same owner.
- Token prefixes (`TRZ-`, `BK-`) and the `Asia/Kolkata` time zone are hard-coded in SQL.
- Branding (name, logo, WhatsApp text) is in the frontend code.
