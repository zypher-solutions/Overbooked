# Handover for the next session

Read this first, then `CLAUDE.md`, then `src/modules/README.md`. Updated 3 Nov 2026. For the complete picture read
`docs/PROJECT_REPORT.md`.

## The goal
Overbooked is Zypher's rental software for many kinds of shop: clothes now, then cars, bikes and resorts, each as its
own module on one shared engine, database and Zypher console. It grew from TRENDZ, the owner's uncle's admin panel for a
bridal and groom rental business. Right now we are finishing the **clothing module** (bridal and groom shops working
exactly like TRENDZ). Car development starts only when clothing is done properly.

## Rules that never change
- **Never touch TRENDZ**: not its repo (read only, used as the reference), not its Supabase projects.
  "Do not touch anything of my uncle."
- Never read or print `.env*` files or keys.
- Three people develop against **one shared cloud Supabase project**. Never reset, seed, load fixtures or bulk-insert
  into it. Docker (local Supabase) is only for throwaway checks: tests, bulk data, load and cost estimates.
- Every database change is a migration file committed to git. Ask the person how to apply it (by hand, `db push`,
  or Claude through their connected Supabase account).
- Plan first and wait for approval before editing; no new dependencies without asking.
- Ask when a business rule is unclear; do not decide quietly (see "Lessons").
- Commit and push only when asked. Branch first; merge into `main` only when told.
- Windows 11. Use the Edit tool for exact edits; shell heredocs with backticks or `$$` get mangled.

## Where things stand
- `main` on GitHub (`zypher-solutions/Overbooked`) has everything, up to the module restructure (merge `2309b61`,
  3 Nov 2026). Nothing is deployed; staging and production do not exist yet.
- **Module layout** (3 Nov): code for one kind of business lives in `src/modules/<name>`; `src/modules/registry.ts` picks
  a shop's module (`businessModule` in `ShopContext`: `"clothing"` or `"standard"`). Lint stops one module importing
  another. Shared screens ask the registry instead of checking for clothing. Rules: `src/modules/README.md`.
- Checks at last run (3 Nov 2026): `npm run typecheck`, `npm run lint` and `npm run build` clean. The clothing screens
  were clicked through on the shared project with the ZEEZ RENTAL shop, including a full booking, hand over and return.
  The database tests and Playwright tests have **not** been run since the move to the shared cloud project (they need
  Docker; last green 29 Oct: 358 database tests, 25 browser tests).
- **Activity log** (10 Nov 2026, branch `feature/activity-log`): Admin > Activity log for the owner, written by the
  database (migration 034). Every new feature that changes shop data must log: see "Activity log" in `CLAUDE.md`.
  Database tests run on Docker that day: 429 passing, including `activity.test.sql`.
- Test data on the shared project: booking `ZR-2026-0003` for "Claude Test" (9000000001), returned and paid ₹400.
  Delete or cancel it when it gets in the way.
- Not done yet, on purpose: shop data export, voiding a wrong Zypher payment, usage page, announcements, offboarding, the
  per-shop customisation tidy-up, code clean-up (typed queries, unused components), hosting, email sender, backups beyond
  Supabase's 7 days, the price list in the console, `docs/SALES.md`.
- Open for the owner: the GitHub handle for `.github/CODEOWNERS` (still a placeholder); deleting old branches on GitHub
  (`feature/safe-foundations`, `feature/trendz-screens`, `refactor/modules-stage1`, `refactor/modules-stage2`).

## What the clothing module has (`src/modules/clothing`)
A shop whose business types are all clothes uses it; other shops use the shared ("standard") screens.
- **Menu** (`nav.ts`): Dashboard, Finance; Rentals (Bookings, Inventory Search, All Rentals, Calendar, Customers,
  Appointments); Products (All Products, Add New Product, Categories, Extras, CSV Import); Admin (Staff management and Branch management, which holds the shop settings: owner). Zypher sets
  up a new shop's first owner in its console; after the owner signs in, the owner runs staff and branches (migration 033).
- **Screens** (`screens/`): Bookings, Inventory Search, All Rentals, Finance, and Create Booking
  (`BookingForm.tsx`). The booking state and rules are shared (`src/components/shop/useBookingForm.ts`); the clothing
  rules there (dates first, each piece chosen, cleaning days, no pickup in the past) switch on `bookingByPiece`.
- **Components**: the dashboard (`TrendzDashboard.tsx`), product wizard (3 steps, creates the pieces), All Products
  table, stock cards, expenses, Pieces received on a return (`ReturnPieces.tsx`: each piece scanned, typed or ticked;
  a missing one must be marked lost).
- **Rules and helpers**: SKU format and CSV numbering (`sku.ts`: category base SKU, `BR-001`, `BR-001-GOLD-M`),
  ledger PDF, cart (`cart.tsx`: per person and shop, kept on the device; the booking form reads its items from it).
  The cart is also used by shared code, so it moves to `src/lib/shop` when a second module needs it.
- **Zypher-only admin** (migration `20261101000011`): only Zypher writes branches, invites staff and changes roles,
  enforced in the database.

## Open questions for the owner (ask, do not assume)
1. **Partial returns**: wanted (some pieces back now, the rest later), but TRENDZ has none. Needs a written design
   first (`docs/PARTIAL_RETURNS_DESIGN.md` is a proposal): rental status while pieces are out, deposit, late fees, money
   records. Not started.
2. **Late returns**: a piece still out is unavailable for any future date until it comes back. Confirm.
3. **Late fee**: the agreed price or the catalogue day rate?
4. **Tax invoice**: issued after the return? The SAC code? Confirm with an accountant.
5. Decided: deleting a booking stays "cancel with a reason" (audit log), not a real delete. Finance is its own page
   (not yet confirmed). The four TRENDZ differences (cleaning days per booking, exact piece at checkout, customer and
   payment locked until every item is free, SKU format) are built the TRENDZ way.
6. Older product decisions: free trial vs overdue handling, removing a business type from a shop, children as extra
   guests, plan-change history and proration.

## Likely next work (propose a plan, wait for approval)
- Check the other roles in the browser: manager and staff of a clothing shop, not only the owner.
- Phone widths for the clothing screens.
- Compare each TRENDZ screen to ours once more, button by button (the booking form is done).
- Run the database and Playwright tests on Docker after the module move.
- Finance loads the money of every rental in the chosen range in the browser; move that to a database function when a
  shop is large.
- When clothing is done: Stage 3, a `vehicle` module (odometer, fuel and licence parts now in `ProductEditor.tsx`,
  `UnitsPanel.tsx` and `HandoverDialogs.tsx`), then `stay` for resorts, then the mobile app (`docs/APP_CONTRACT.md`).

## How to run and test
See `docs/SETUP.md`. In short:
```bash
npm run dev          # http://localhost:3000, on the shared cloud project (.env.local)
npm run typecheck
npm run lint
npm run build
```
Database and browser tests run on Docker only (`npm run test:reset`, `npx supabase test db`, `npx playwright test`).

## Lessons from this project
- Do not copy a screen without asking who it is for. TRENDZ was read while signed in as the super admin,
  so its admin pages belong to Zypher, not to shop owners.
- Where Overbooked and TRENDZ differ, say so and ask; do not keep our way silently.
- Check the database as well as the menu when a role loses access (the policies and functions, not only
  hidden links).
- A passing test is not proof that it looks right: open the page in the browser.
- Testing on the shared project writes real records everyone sees: say what was created and leave it findable.
