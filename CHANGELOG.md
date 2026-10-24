# Changelog

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
