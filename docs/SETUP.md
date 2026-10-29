# Setup guide

Everything here runs on your own PC. It costs nothing and cannot touch any live shop's data.

## What you need (once)
1. **Node.js 22+**: `node --version`
2. **Docker Desktop**: must be *running* (whale icon in the tray) before any `supabase` command.
   Local Supabase is a set of Docker containers: Postgres, Auth, Storage, Realtime, REST API, Studio.
3. **Git**

The Supabase CLI is not installed globally. `npx supabase ...` downloads and runs it.

## First run
```bash
npm install
npx supabase start
```
`supabase start` builds the database from `supabase/migrations/` (in filename order), then loads
`supabase/seed.sql`. At the end it prints something like:

```
API URL:   http://127.0.0.1:54321
Studio URL: http://127.0.0.1:54323
anon key:  eyJ...
```

Create `.env.local` from `.env.example` and paste the **API URL** and **anon key**:
```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key printed above>
```
These local keys only work against your own Docker containers.

```bash
npm run dev
```
Open http://localhost:3000 and sign in with a demo login from the top of `supabase/seed.sql`.

## Everyday commands
| Command | What it does |
| --- | --- |
| `npx supabase start` | Start the local backend (after a reboot, start Docker Desktop first) |
| `npx supabase stop` | Stop it; data is kept |
| `npx supabase status` | Show URLs and keys again |
| `npx supabase db reset` | Wipe the local DB, re-run all migrations and the seed |
| `npm run dev` | Run the app with hot reload |
| `npm run build` | Production build (catches type errors) |
| `npx playwright test` | Browser tests (uses the demo logins from the seed) |

**Supabase Studio** (http://127.0.0.1:54323) is a local admin UI. You can browse tables, run SQL and see
auth users there.

## Changing the database
Never edit the database by hand and leave it there. Every change is a migration file:
```bash
npx supabase migration new add_something   # creates supabase/migrations/<timestamp>_add_something.sql
# write the SQL, then
npx supabase db reset                      # proves the whole chain still builds from zero
```

## Tests
Run them in this order. The database tests expect freshly reset demo data (they count bookings and
check booking numbers), and the browser tests add bookings of their own:
```bash
npx supabase db reset   # fresh demo data: one shop per business type + Zypher
npx supabase test db    # engine, isolation, roles, money rules, console (supabase/tests)
npx playwright test     # browser: menus per role, Zypher console, a full bridal booking (tests/)
```
The browser tests sign in with the local demo password from `supabase/seed.sql` (or `DEMO_PASSWORD` if set).

## Load test (local only)
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

## Shops and logins (local)
- The seed creates one shop per business type, plus one Zypher admin. Logins are at the top of `supabase/seed.sql`.

  | Shop | Business type | Plan |
  | --- | --- | --- |
  | Kalyani Bridal | Bridal wear (2 branches) | Pro |
  | Raja Groom Wear | Groom wear | Starter |
  | Green Valley Resort | Resort | Starter |
  | Kochi Drive Cars | Car rental | Starter |
  | Munnar Bike Rentals | Bike rental (payment overdue) | Starter |
- **Zypher admin:** signs in to the console at `/zypher`: shops, plans and fees, feature switches, bank
  payments, pausing a shop, new shops from business types, and "Open shop" to set a shop up (branches, staff, stock location counts). Zypher never sees a shop's bookings, customers or money; `support@bridal.test` is the support login of Kalyani Bridal.
- **Owners:** invite staff from **Staff**. They get a one-hour link to send on WhatsApp; the person opens
  it and chooses a password. The same screen makes a new link for a forgotten password.
- `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` is needed for invites (server only; value from `npx supabase status`).

## Common problems
| Symptom | Fix |
| --- | --- |
| `failed to connect to the docker API` | Docker Desktop is not running. Start it and wait for "Engine running" |
| Port 54321/54322 already in use | Another Supabase project is running: `npx supabase stop --project-id <name>` |
| Login works but says "deactivated" | The profile is inactive or has no shop. People join a shop through an invite link |
| Changed a migration and nothing happened | Run `npx supabase db reset` |
| "Could not embed because more than one relationship was found" after a reset | The API kept an old table map: `docker restart supabase_rest_overbooked` |

## Going online later (not yet)
When there is a real Overbooked deployment, it will use **its own new** Supabase project and Vercel project.
`npx supabase link --project-ref <new-project>` then `npx supabase db push` deploys the same migrations.
Never link this repo to a TRENDZ project.
