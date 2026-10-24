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
| `npx playwright test` | Browser tests (needs `.env.test`, see below) |

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
Copy `.env.test.example` to `.env.test` and fill in the demo logins from `supabase/seed.sql`.
Keep a `.env.test` in this folder. Otherwise `playwright.config.ts` also looks one folder up.
```bash
npx playwright test
```

## Common problems
| Symptom | Fix |
| --- | --- |
| `failed to connect to the docker API` | Docker Desktop is not running. Start it and wait for "Engine running" |
| Port 54321/54322 already in use | Another Supabase project is running: `npx supabase stop --project-id <name>` |
| Login works but the app is empty / "deactivated" | The profile is inactive. New sign-ups start inactive; a super admin activates them in Staff Management |
| Changed a migration and nothing happened | Run `npx supabase db reset` |

## Going online later (not yet)
When there is a real Overbooked deployment, it will use **its own new** Supabase project and Vercel project.
`npx supabase link --project-ref <new-project>` then `npx supabase db push` deploys the same migrations.
Never link this repo to a TRENDZ project.
