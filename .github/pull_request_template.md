## What and why

## Checklist
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run build` are clean
- [ ] `npx supabase db reset && npx supabase test db` pass; a new rule has a test
- [ ] `npx playwright test` passes; a changed screen was opened in the browser
- [ ] A database change is a new migration file, backward compatible, listed in CHANGELOG.md (APPLIED per environment)
- [ ] No keys, passwords or real customer data in the change
- [ ] Business-type code stays in its module (`src/modules/<name>`)
- [ ] Rollback: how do we undo this if it goes wrong?
