# Overbooked

Rental management for clothing and costume rental shops: stock across branches, bookings, pickups,
returns, deposits, payments and a money ledger, with roles for owners, managers and staff.

Built and proven in production at TRENDZ (Kerala), now being turned into a product for many shops.

## Features
- **Catalog**: products with variations (color/size), per-variation daily rate, CSV bulk import, photos
- **Physical units**: every item has its own SKU and status (available, rented, maintenance, lost)
- **Bookings**: reserve exact units for future dates; overlapping bookings of the same unit are refused
- **Pickup → rental**: booking becomes an active rental; extend, record payments, return with condition
- **Money**: negotiated price, discount, advance, security deposit, late/damage fees, deposit settlement
- **Ledger**: append-only record of every rupee in and out; monthly collected vs earned
- **Roles**: super admin, owner (all branches), manager and staff (own branch only), enforced in the database
- **Records are permanent**: corrections only by a super admin, with a reason, in an audit log
- **WhatsApp**: pre-filled confirmation and reminder messages; PDF receipts

## Tech stack
Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · shadcn/radix UI · Supabase (Postgres, Auth, RLS,
RPC functions, Storage, Realtime) · Playwright

## Quick start (local, free, no cloud account needed)
Needs Node.js 22+ and Docker Desktop (running).

```bash
npm install
npx supabase start          # local Postgres + Auth + Storage in Docker; prints URL and anon key
cp .env.example .env.local  # paste the API URL and anon key from the previous step
npm run dev                 # http://localhost:3000
```

Demo logins are listed at the top of [supabase/seed.sql](supabase/seed.sql).
Full step-by-step guide: [docs/SETUP.md](docs/SETUP.md).

## Documentation
| Doc | What's in it |
| --- | --- |
| [docs/SETUP.md](docs/SETUP.md) | Install, run, reset, test, common errors |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the pieces fit, main flows, business rules |
| [docs/DATABASE.md](docs/DATABASE.md) | Tables, database functions, migrations |
| [docs/ROADMAP.md](docs/ROADMAP.md) | From single shop to multi-shop product |
| [docs/BUSINESS.md](docs/BUSINESS.md) | How low-price SaaS works, pricing notes |
