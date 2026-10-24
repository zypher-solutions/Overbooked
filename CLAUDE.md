# Overbooked: Rental Management SaaS

Product built from the TRENDZ admin panel (forked 22 Oct 2026 from TRENDZ `main` @ 54a190e).
Goal: turn it into a sellable product for many rental shops. See docs/ROADMAP.md.

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
- src/app: routes (login, main shell), server actions (src/app/actions)
- src/components/overbooked/pages: the app screens
- src/lib/overbooked/store.tsx: all data loading and mutations (calls Supabase tables and RPCs)
- supabase/migrations: database schema v2, in order (see docs/DATABASE.md); supabase/tests: database tests
- supabase/seed.sql: local demo data and logins
- docs/: setup, architecture, database, roadmap, business

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
- `npm run build`, `npm run lint`, `npx playwright test`
