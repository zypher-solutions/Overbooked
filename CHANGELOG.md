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
