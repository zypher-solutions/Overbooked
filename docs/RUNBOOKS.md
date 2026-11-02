# Runbooks

Short, step by step. Written 29 Oct 2026. Items marked **not set up yet** need accounts that do not exist yet.

## Environments and the release path
| Env | Database | Site | Data |
|---|---|---|---|
| Local | Docker (`npx supabase start`) | `npm run dev` | demo data from `supabase/seed.sql`, local only |
| Staging (**not set up yet**) | its own Supabase project | preview deployment of `development` | fake data, names start with `QA-` |
| Production (**not set up yet**) | its own Supabase project | production deployment of `main` | real shops |

A change: branch `feature/...` or `fix/...` from `development`, local tests, pull request to `development` (CI must pass),
test on staging, Mohammed approves, pull request `development` to `main`, tag `vX.Y.Z`. Mohammed does the merges.
A urgent fix on production: branch `hotfix/...` from `main`, then merge it back into `development` too.
Production keys are never on a laptop. Sign-up stays off and the demo seed is never run on staging or production.

## Database changes
1. New file in `supabase/migrations/` (`YYYYMMDDNNNNNN_name.sql`); never edit the schema in the dashboard.
2. `npx supabase db reset` and `npx supabase test db` locally; add a test for new rules.
3. Apply to staging, test the app on it.
4. Production only after a backup and Mohammed's go-ahead; make the change backward compatible (add before you remove),
   so the old code still works while the new code deploys.
5. Record it in CHANGELOG.md under Database with APPLIED per environment.

## Backups
- `.github/workflows/backup.yml`: daily encrypted dump (roles, schema, data) of the production database into a private
  workflow artifact, kept 30 days. Needs the secrets `SUPABASE_DB_URL` and `BACKUP_PASSPHRASE` and the variable
  `BACKUP_ENABLED=true` (**not set up yet**). Keep the passphrase in the password manager, never in the repository.
- Supabase's own daily backups exist on paid plans; photos in storage are not in a database dump (copy them separately).
- Restore into a **scratch** Supabase project first, never over production:
  `gpg --decrypt backup.tgz.gpg > backup.tgz`, `tar -xzf backup.tgz`, then
  `psql "<scratch connection string>" -f backup/roles.sql -f backup/schema.sql -f backup/data.sql`.
  Do this once a month and check the shop count and the latest bookings. A backup that was never restored is not a backup.

## Zypher access
- The console and "open shop" give **setup only**: branches, staff, roles, stock location counts, plan, billing, business types.
- One support login per shop (role `support`, e.g. `support+kalyani@<our domain>`), created from Staff Management by Zypher.
  It sees only that shop. Create it when the shop asks for help, switch it off afterwards, tell the owner.
  Own strong password in the password manager; never in chat, files or the repository.
- Anything beyond that (a fix by SQL) is Mohammed only: say why, what, and for which shop; take a backup first; write it in the audit log or the changelog.
- Not done yet: two-factor sign-in for Zypher and support logins (needs Supabase TOTP setup and a sign-in screen).

## A problem report from a shop
1. Ask which screen, what they did, and the booking number. 2. Try it on staging with fake data. 3. If it needs the shop's own data, enable its
support login, reproduce, fix on a branch, test on staging, release, switch the support login off.
