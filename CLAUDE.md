# Overbooked: Rental Management SaaS

**Starting a session? Read docs/HANDOVER.md first** (current state, open questions, next steps).

Product built from the TRENDZ admin panel (forked 22 Oct 2026 from TRENDZ `main` @ 54a190e).
Goal: turn it into a sellable product for many rental shops. See docs/PROJECT_REPORT.md (Part 11: what is left).

## Hard rules
- This repo has NOTHING to do with the TRENDZ production or test Supabase projects. Never connect to,
  dump from, or copy keys of any TRENDZ project. Local development uses local Supabase (Docker) only.
- Never read or print .env files or keys. Only .env.example (names, no values) is committed.
- Plan first for non-trivial changes and wait for approval before editing.
- No new dependencies without asking.
- If a business rule is unclear, write the assumption down and ask.

## Stack
Next.js 16 (App Router) + React 19 + TypeScript + Tailwind 4 + shadcn/radix UI.
Supabase: Postgres, Auth, Row Level Security, RPCs (plpgsql), Storage, Realtime. No separate backend
server; business rules live in database functions (supabase/migrations). Windows 11, Docker Desktop.
There is no Python in this project.

## Layout
- src/app/(shop): the shop app (Today, booking, bookings, customers, catalog, money, branches, staff, settings)
- src/app/zypher: the Zypher console (server-guarded); src/app/actions: server actions (invites, new shops)
- src/components/shop, src/components/zypher: their components; src/lib/shop: types, formats, data helpers
- src/lib/overbooked/AuthContext.tsx: sign-in, profile, current shop
- supabase/migrations: database schema v2, in order (see docs/DATABASE.md); supabase/tests: database tests
- supabase/seed.sql: local demo data and logins
- docs/: start with PROJECT_REPORT.md (see docs/README.md for the list of documents)

## Business model (negotiated deals)
- Business types (bridal, groom, resort, car, bike) are templates; products have variations with their own rates; each physical unit is tracked.
- Price, security deposit and late fees are negotiated per rental, so test CONSISTENCY, not constants.
- Invariants: total = lines + add-ons + charges - discount; balance due = total - payments, never negative;
  deposit refund <= deposit held; no overlapping bookings of the same unit; return date >= start date;
  no negative amounts; dashboard/ledger figures equal the underlying records.

## Commands
- `npx supabase start` / `npx supabase stop`: local backend
- `npx supabase db reset`: rebuild local DB from migrations and seed
- `npm run dev`: app on http://localhost:3000
- `npm run build`, `npm run lint`, `npx supabase test db`, `npx playwright test` (reset first; see docs/SETUP.md)
