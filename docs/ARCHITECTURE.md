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

Next.js hosting (Vercel or similar) only serves the UI. One server action exists:
`src/app/actions/booking.ts` (cancel booking).

## Roles
| Role | Scope | Can |
| --- | --- | --- |
| super_admin | all branches | everything, incl. staff management, record corrections (audit-logged) |
| owner | all branches | operations, catalog, ledger; no staff/record admin |
| manager | own branch | operations, catalog edits, stock for own branch |
| staff | own branch | bookings, pickups, returns, payments; no ledger, no catalog edits |

`get_my_role()` / `get_my_branch()` return NULL for inactive users and for staff of an inactive branch,
so every policy locks them out automatically.

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
