# Changelog

## 0.3.0 (unreleased): v2 rental engine
- New database designed from scratch for bridal, groom, resort, car and bike rentals; the inherited TRENDZ
  migrations and QA history are removed
- One rental record from booking to return, time ranges, double booking blocked by the database, business
  templates, rates, add-ons, charges, pickup/return checks, payments as the single money record
- Demo data: one shop per business type plus a Zypher admin; 114 database tests
- Zypher console moved to its own area, `/zypher`, checked on the server: overview (fees, collections, overdue
  shops, shops not using it), shops list with billing filters, shop page (plan, monthly fee, notes, pause/resume,
  business types, feature switches, branches, people, invites, payments), new-shop wizard from business types,
  billing, business types and audit log. Shops have an agreed monthly fee. Zypher staff sign in to the console
- Shop app rebuilt on v2 as separate pages: Today, New booking (live price and free counts), Bookings,
  booking page (handover and return with checks, photos, suggested charges, extend, swap, cancel, corrections,
  WhatsApp), Customers, Catalog (items, prices, units, extras, categories, CSV import), Money and reports,
  Branches, Staff, Settings. Wording and fields follow each shop's business types
- The TRENDZ-era screens, store and PDF ledger are removed
- Browser tests rewritten for v2 (tests/v2-shop.spec.ts)
- Receipts and GST tax invoices, changing a booking before pickup, a calendar per unit, printable QR tags,
  the owner's plan and payment reminders, Zypher receipts, payment kinds, an optional automatic pause of
  long-overdue shops, Zypher team logins, one-tap customer reminders on Today
- Optional features: sets, measurements, alterations, appointments
- Hand-over pack for the mobile app: docs/APP_CONTRACT.md (contract v1) and generated types
  (src/lib/database.types.ts, regenerated with `npm run types`)
- Bridal and groom shops get the TRENDZ screens: sidebar, cart with Checkout, Inventory Search (scan or type, receive back),
  Dashboard, Finance, Bookings, All Rentals, All Products, 3-step Add New Product, Stock Locations; other business types keep their menu
- Branches, staff and stock locations are Zypher-only (database policies and functions, not just the menu); migration 20261101000011
- Paged lists use a unique order; CSV exports escape formulas
- Bridal and groom booking form follows TRENDZ: customer and payment stay closed until the dates are valid and every item
  is free; every booked piece is chosen (the first free one is pre-selected, staff can change it); cleaning days are typed
  per booking
- SKUs of bridal and groom shops follow TRENDZ: category base SKU (2 to 6 capital letters), product `BR-001` numbered for
  you (not typable), variation `BR-001-GOLD-M`; checked in the forms, the CSV import and the database. Demo SKUs renamed
- Dashboard and Finance of bridal and groom shops completed to match TRENDZ: Filter panel with chips, Completed Rentals,
  Ledger Records with Record payment, Export PDF and Records CSV, search in place, phone cards. Audit in docs/TRENDZ_PARITY.md
- Bookings (Buffer, Available, Completed Bookings) and All Products (stock filter, Delete, Reactivate, phone cards) match TRENDZ
- 187 database tests, 9 browser tests

### Database
- `20261101000014_reactivate_product.sql`: `reactivate_product(uuid)` for owners and managers. APPLIED to local only
- `20261101000012_cleaning_days_per_booking.sql`: `rentals.cleaning_days`; optional `p_cleaning_days` on `branch_availability`
  and `find_available_units` (old calls unchanged); create, change, return and extend use it. APPLIED to local only
- `20261101000013_sku_format_clothes.sql`: SKU format triggers for clothes shops, checked when a SKU is added or changed.
  APPLIED to local only

## 0.2.0 (2026-10-24): many shops
- One database serves many shops. Isolation is enforced by a restrictive policy, composite foreign keys
  and `app_rpc`-owned functions; 31 database tests cover it (`supabase/tests`)
- Zypher console: create shops, open any shop, plans, pause, manual bank payments and paid-until
- Staff invites and forgotten-password links to share on WhatsApp (`/welcome`); owners manage their own staff and branches
- Per-shop numbering, SKUs, plan limits, photo folders and branding (sidebar, WhatsApp texts, PDF)
- Data loads page by page (no silent 1,000-row cut-off), stock counts come summed from the database,
  and live updates are per shop
- Security rules evaluate their checks once per query: a screen load with the rules on is 23× faster

## 0.1.0 (2026-10-22): forked from TRENDZ
- Copied from TRENDZ `main` @ 54a190e into a new, unlinked repository
- Removed the TRENDZ database backup workflow; archived TRENDZ QA reports in `docs/trendz-history/`
- Added `supabase/migrations/20260901000000_baseline.sql`: base tables rebuilt from code (TRENDZ never committed them)
- Added local Supabase config, demo seed data, `.env.example`, and the docs set
