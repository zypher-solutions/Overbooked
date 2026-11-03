# Setup guide

The three of us develop against **one shared cloud Supabase project**, so a database change made by one person is
there for everyone at once. Docker (local Supabase) is only for throwaway checks: tests, bulk data, load and cost
estimates. See [Local checks with Docker](#local-checks-with-docker-only).

## What you need (once)
1. **Node.js 22+**: `node --version`
2. **Git**
3. Access to the shared Overbooked Supabase project (ask a teammate to invite you)
4. **Docker Desktop**, only if you will run the local checks below

The Supabase CLI is not installed globally. `npx supabase ...` downloads and runs it.

## First run
```bash
npm install
```
Create `.env.local` from `.env.example` and fill it from the shared project's dashboard (Project Settings, API):
```
NEXT_PUBLIC_SUPABASE_URL=<the shared project's URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<its anon / publishable key>
SUPABASE_SERVICE_ROLE_KEY=<its service-role key, needed for invites; server only, never in client code>
```
`.env.local` is never committed. Never paste these keys in chat, issues or screenshots.

```bash
npm run dev
```
Open http://localhost:3000 and sign in with your own login on the shared project.

## Everyday commands
| Command | What it does |
| --- | --- |
| `npm run dev` | Run the app with hot reload, connected to the shared cloud project |
| `npm run build` | Production build (catches type errors) |
| `npm run typecheck`, `npm run lint` | Type and lint checks (lint also stops one business module importing another) |

## Rules for the shared database
- It holds everyone's work. Never run `npx supabase db reset`, `supabase/seed.sql`, `npm run test:fixtures`,
  `scripts/load-data.sql`, bulk inserts or destructive SQL against it.
- Tell the others before you apply a database change, so two people do not change the same thing at once.

## Changing the database
Never edit the database by hand and leave it there. Every change is a migration file, committed to git:
```bash
npx supabase migration new add_something   # creates supabase/migrations/<timestamp>_add_something.sql
# write the SQL
```
Before applying it, prove it on a local copy if Docker is available (`npx supabase db reset` builds the whole chain
from zero; see below). Then apply it to the shared project and commit the file:
```bash
npx supabase link --project-ref <shared-project-ref>   # once per computer
npx supabase db push                                   # applies migrations the shared project has not had yet
```
After a database change, regenerate the types against the shared project
(`npx supabase gen types typescript --project-id <shared-project-ref> > src/lib/database.types.ts`).
`npm run types` reads the local Docker database instead.

## Local checks with Docker (only)
For anything that wipes or floods a database: browser and database tests, bulk shop data, load tests and
estimating what Supabase will cost. Nothing done here reaches the shared project.

Start Docker Desktop (whale icon in the tray) first, then:
```bash
npx supabase start
```
It builds a local database from `supabase/migrations/` (in filename order), loads `supabase/seed.sql`, and prints
a local API URL (http://127.0.0.1:54321), Studio URL (http://127.0.0.1:54323) and keys.

To point the app at it, swap `.env.local` to the local URL and keys for the session (keep a copy of the shared ones),
and swap back afterwards. The tests and load scripts talk to the local database directly.

| Command | What it does |
| --- | --- |
| `npx supabase start` / `stop` | Start / stop the local backend; data is kept between them |
| `npx supabase status` | Show the local URLs and keys again |
| `npx supabase db reset` | Wipe the LOCAL database, re-run all migrations and the seed |

**Supabase Studio** (http://127.0.0.1:54323) is a local admin UI: browse tables, run SQL, see auth users.

### Tests
Run them in this order. A plain `db reset` gives EMPTY shops (only the logins, branches and categories).
The tests need demo products, pieces and bookings, so `npm run test:reset` resets and then loads
`supabase/test_fixtures.sql`. The database tests count bookings and check booking numbers, and the browser
tests add bookings of their own:
```bash
npm run test:reset      # reset + test fixtures (demo products, pieces, customers, one booking per shop)
npx supabase test db    # engine, isolation, roles, money rules, console (supabase/tests)
npx playwright test     # browser: menus per role, Zypher console, a full bridal booking (tests/)
```
The browser tests sign in with the local demo password from `supabase/seed.sql` (or `DEMO_PASSWORD` if set).

### Load test and cost estimate
Measures database size per busy shop-year and how fast the main screens load, signed in as a shop owner with
the security rules on. It refuses to run against anything but the local database.
```bash
npx supabase db reset
docker exec -i supabase_db_overbooked psql -U postgres -q < scripts/load-data.sql   # a busy year for Kalyani Bridal (~3 min)
node scripts/load-test.mjs .
npx supabase db reset                                                               # back to the demo data
```
Result on 25 Oct 2026 (v2): 35 MB per busy shop-year (6,000 bookings), 216 screens per second with five people
working at once, 62 KB per screen on average.

### Demo shops and logins (local only)
The seed creates one shop per business type, plus one Zypher admin. Logins are at the top of `supabase/seed.sql`.

| Shop | Business type | Plan |
| --- | --- | --- |
| Kalyani Bridal | Bridal wear (2 branches) | Pro |
| Raja Groom Wear | Groom wear | Starter |
| Green Valley Resort | Resort | Starter |
| Kochi Drive Cars | Car rental | Starter |
| Munnar Bike Rentals | Bike rental (payment overdue) | Starter |

`support@bridal.test` is the support login of Kalyani Bridal.

## Who signs in where
- **Zypher admin:** signs in to the console at `/zypher`: shops, plans and fees, feature switches, bank
  payments, pausing a shop, new shops from business types, and, on each shop's page, Branches and Staff tabs to set
  it up. Zypher never sees a shop's bookings, customers or money.
- **Owners:** invite staff from **Staff**. They get a one-hour link to send on WhatsApp; the person opens
  it and chooses a password. The same screen makes a new link for a forgotten password.
  Invites need `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` (server only).

## Common problems
| Symptom | Fix |
| --- | --- |
| Login works but says "deactivated" | The profile is inactive or has no shop. People join a shop through an invite link |
| A teammate's new screen errors about a missing column or function | Their migration is not on the shared project yet: ask them to `db push` it |
| `failed to connect to the docker API` (local checks) | Docker Desktop is not running. Start it and wait for "Engine running" |
| Port 54321/54322 already in use (local checks) | Another Supabase project is running: `npx supabase stop --project-id <name>` |
| Changed a migration and the local DB did not change | Run `npx supabase db reset` (local only) |
| "Could not embed because more than one relationship was found" after a local reset | The API kept an old table map: `docker restart supabase_rest_overbooked` |

## Going live (not yet)
The live Overbooked deployment will get **its own** Supabase project and Vercel project, separate from the shared
development one. `npx supabase link --project-ref <live-project>` then `npx supabase db push` deploys the same
migrations. Never link this repo to a TRENDZ project.
