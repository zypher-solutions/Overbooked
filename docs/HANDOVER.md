# Handover for the next session

Read this first, then `CLAUDE.md`, then `docs/ARCHITECTURE.md`. Written 29 Oct 2026.

## The goal
Overbooked is Zypher's multi-client rental software. It grew from TRENDZ, the owner's uncle's admin panel
for a bridal and groom rental business. Right now we are making the **bridal and groom shops work exactly
like TRENDZ** (same screens, same logic), on top of the v2 engine. Car, bike and resort shops are set
aside until this is right.

## Rules that never change
- **Never touch TRENDZ**: not its repo (`C:\Users\USER\Desktop\projects\trendz-admin-panel`, read only,
  used as the reference), not its Supabase projects. "Do not touch anything of my uncle."
- Never read or print `.env*` files or keys. Local Supabase in Docker only.
- Plan first and wait for approval before editing; no new dependencies without asking.
- Ask when a business rule is unclear; do not decide quietly. Two slips so far came from deciding alone
  (see "Lessons").
- Commit and push only when asked. Do not merge into `main` unless told.
- Windows 11, no Python. Use the Edit tool for exact edits; shell heredocs with backticks or `$$` get mangled.

## Where things stand
- Branch **`feature/trendz-screens`** (pushed to GitHub `zypher-solutions/Overbooked`), two commits on top of
  `main` (`263842e`). **Not merged.** Open a PR when the owner says so.
- Checks at last run (30 Oct 2026): `npx tsc --noEmit` clean, `npm run lint` 2 old warnings, `npm run build` ok,
  181 database tests, 9 browser tests, all passing. Migrations `...12` and `...13` are applied to local only.
  Changes since the two commits (booking form, SKU rules, cleaning days) are not committed yet.
- Local demo data and logins are in `supabase/seed.sql`; the demo password is the default in
  `tests/v2-shop.spec.ts`. `owner@bridal.test` opens the bridal shop, `zypher@overbooked.test` the console.

## What is built for bridal and groom shops (`trendz` flag in `ShopContext`)
A shop whose business types are all clothes gets the TRENDZ screens; other shops keep the old menu.
- **Sidebar** (`ShopShell.tsx`): Dashboard, Finance; Rentals (Bookings, Inventory Search, All Rentals,
  Calendar, Customers, Appointments); Products (All Products, Add New Product, Categories, CSV Import);
  Admin (Branch Management, Staff Management, Stock Locations: **Zypher only**; Shop settings: owner).
  Footer: name, role, branch, Change password, Sign out (warns about a full cart), "Staff panel v2.0".
- **Cart** (`src/lib/shop/cart.tsx`): per person and shop, kept on the device; floating "Checkout (n)";
  asks before mixing branches. The booking form (`/book`) reads its items from the cart.
- **Inventory Search** (`/scan`): scan (camera or USB scanner) or type a name, SKU, piece code or booking
  number. "Find and book" shows Total / Avail / Rented per branch with Add to Cart (`StockCard.tsx`);
  "Receive back" opens the return with the scanned piece ticked.
- **Return of clothes** (`HandoverDialogs.tsx`): each piece is scanned, typed or ticked; a missing piece
  must be marked lost.
- **Dashboard** (`TrendzDashboard.tsx`), **Finance** (`/finance`), **Bookings** (`/bookings`),
  **All Rentals** (`/all-rentals`), **All Products** table, **Stock Locations**, **Add New Product** as a
  3-step wizard that also creates the pieces (`ProductWizard.tsx`).
- **Zypher-only admin** (migration `20261101000011`): only Zypher, from the shop's page in the console, writes branches,
  invites staff, changes roles. Enforced in the database, not just the menu.
- Fixed on the way: paged lists use a unique order; CSV exports escape formulas.
- Full screen list: `docs/ARCHITECTURE.md` ("Bridal and groom shops: the TRENDZ screens").

## Open questions for the owner (ask, do not assume)
1. **The four differences from TRENDZ: answered 29 Oct, now built the TRENDZ way.** Cleaning days typed per
   booking; the exact piece chosen at checkout (TRENDZ pre-selects the first free piece and staff can change it,
   we do the same); customer and payment closed until the dates are valid and every item is free; SKU format
   enforced (category base SKU, product `BR-001` numbered for you and not typable, variation `BR-001-GOLD-M`).
   Demo SKUs were renamed to fit. Things to know: the product's own turnaround is ignored in bridal and groom
   shops (the booking's cleaning days, blank = 0, decide); old SKUs a real shop already has are left alone until
   they are changed; cleaning days are capped at 365 and the date is not allowed in the past (TRENDZ has no cap).
2. **Shop settings**: decided, owner and Zypher.
3. **Merge**: review the branch, then PR and merge to `main`? Still open.
4. Decided: deleting a booking stays "cancel with a reason" (audit log), not a real delete (differs from TRENDZ,
   chosen on purpose). Finance is its own page (not yet confirmed).
4b. **Partial returns**: the owner wants them (some pieces back now, the rest later), but TRENDZ has none (its
   returns are all-or-nothing). Needs a written design first: rental status while pieces are out, the deposit, late
   fees, the money records. Not started.
5. Older open product decisions: free trial vs overdue handling, removing a business type from a shop,
   children as extra guests, late-return rules, plan-change history and proration.

## Likely next work (propose a plan, wait for approval)
- Compare each TRENDZ screen to ours once more, button by button (the booking form is done).
- Check the other roles in the browser (manager and staff of the bridal shop; the groom shop), not only owner.
- Mobile phone widths for the new screens.
- Finance loads the money columns of every rental it has handed over (marked `shortcut` in
  `src/app/(shop)/finance/page.tsx`); move to a database function when a shop is large.
- Then car, bike and resort in the same TRENDZ-style way, and the mobile app for the friend (see
  `docs/APP_CONTRACT.md`; the invite rules in it already say Zypher invites).
- Business side lives in `docs/BUSINESS.md` (pricing: Starter 499, Pro 999, Business 1,999 a month).

## How to run and test
```bash
npx supabase start          # Docker Desktop must be running
npx supabase db reset       # rebuilds from migrations and seed (signs everyone out)
npm run dev                 # http://localhost:3000 (it may already be running)
npx tsc --noEmit
npm run lint
npx supabase test db        # reset first
npx playwright test --reporter=line
npm run build
```
Tests change local demo data: run `npx supabase db reset` before the database tests.

## Lessons from this project
- Do not copy a screen without asking who it is for. TRENDZ was read while signed in as the super admin,
  so its admin pages belong to Zypher, not to shop owners.
- Where Overbooked and TRENDZ differ, say so and ask; do not keep our way silently.
- Check the database as well as the menu when a role loses access (the policies and functions, not only
  hidden links).
- A passing test is not proof that it looks right: open the page in the browser.
