# Overbooked: launch plan for bridal and groom (clothing) shops

## Context
Overbooked is Zypher's multi-shop rental software, grown from TRENDZ. The bridal and groom screens now copy TRENDZ.
Launch is planned in a few days, and a mistake in front of shops is expensive. The owner asked for six things:
- An honest check of the code, the database and Git.
- What is done and what is missing.
- Fixes for logic and UX gaps.
- How the Zypher console and per-shop customisation should work.
- A backup approach.
- One final pricing and sales story against BookieBuddy.

Sources:
- docs/HANDOVER.md, BUSINESS.md, ROADMAP.md, BRANCHING.md, RUNBOOKS.md, ARCHITECTURE.md, DATABASE.md, TRENDZ_PARITY.md.
- The earlier chats in the trendz-admin-panel project.
- Three read-only audits of the code (29 Oct 2026).

## 1. Where we stand

**Done and solid:**
- **Multi-shop database:** every row carries `shop_id`, and row-level security is on every table.
- **The rental engine** runs in database functions, and every security-definer function sets `search_path`.
- **Money rules held by the database:**
  - total = lines + add-ons + charges − discount
  - 0 ≤ paid ≤ total
  - deposit refunded + kept ≤ deposit received
  - no overlapping use of a piece (exclusion constraint)
- **Bridal and groom screens:** Dashboard, Finance, Bookings, Inventory Search, All Rentals, All Products, the 3-step product wizard, cart, booking form and piece-by-piece return.
- **Zypher console:** shops, plan and fee, pause, feature switches, branches, staff, billing and receipts, audit log, 2FA for Zypher and support logins, one support login per shop.
- **Tests:** 287 database assertions and 19 browser tests. CI runs three jobs (app, database, browser). An encrypted daily backup workflow is written.

**Not done:**
- Nothing is hosted: no Supabase or Vercel projects, no domain, and no email sender for invite mails.
- The latest work exists only on this laptop. `development` and `feature/safe-foundations` (14 commits ahead of `main`) are not on GitHub.
- The business-rule gaps in section 3.
- Partial returns (designed in docs, not built).
- Trial state.
- A full data export per shop.
- Shop offboarding.
- Automatic WhatsApp.
- The mobile app (contract v1 is written).

## 2. Verdict on the code and the repository
The foundation is right. Business rules live in the database, so the web app and the friend's mobile app get the same rules.
**Do not restructure the code before launch**: a big move now risks new bugs for no gain to shops. Do targeted cleanup only.

**Before launch (cheap, safe):**
- Push the work to GitHub. Then delete the stale branches `multi-shop`, `v2-engine` and `feature/trendz-screens` (already merged in PR #1). Drop `feature/safe-foundations`, which points at the same commit as `development`. Pull `main`.
- Put the real GitHub name in `.github/CODEOWNERS`. Rename `package.json` "tanstack_start_ts" to "overbooked". Add the `typecheck`, `test:db` and `test:e2e` scripts.
- Turn on branch protection for `main` and `development` (PR required, CI must pass, no force push).
- Route guards: bridal shops are sent from `/rentals` and `/dashboard` to their TRENDZ screens, and car shops cannot open `/finance` or `/scan`. Today any shop can reach either set by typing the URL.

**After launch (one cleanup PR per week, never mixed with features):**
1. Use the generated `src/lib/database.types.ts` in `src/lib/supabase/client.ts` (`createBrowserClient<Database>`). Then remove the 34 `as unknown as` casts one file at a time.
2. Delete the 33 unused shadcn components and the packages only they use (recharts, embla, vaul, cmdk, input-otp, react-hook-form, react-resizable-panels). This removes packages, it does not add any.
3. Split the god files when they are next touched: `book/page.tsx` (802 lines), `catalog/page.tsx`, `finance/page.tsx`.
4. Move queries into `src/lib/shop/api.ts`, or a per-module `data.ts`. Make every read show its error.
5. Rename `lib/overbooked` to `lib/auth`. Keep moving code into `src/modules/{core,clothing,vehicle,stay}` (started).
6. Put the money format in one place (`lib/shop/format.ts`). Copies are in `zypher/kit.tsx` and `print/zypher-receipt`. Use the shop's time zone in the console, not a hard-coded Asia/Kolkata.

**How GitHub should be kept** (docs/BRANCHING.md is already right, so keep it):
- `main` is production. `development` is staging. Each piece of work gets a `feature/…` or `fix/…` branch from `development`, and a `hotfix/…` branch from `main` for emergencies.
- One pull request per change, and CI must pass. Merge `development` into `main` only after testing on staging.
- Each release gets a tag `vX.Y.Z` and a CHANGELOG entry that lists the migrations it needs.
- After the first production deploy, never edit an old migration. Every change is a new migration file.

## 3. Launch blockers in the bridal flow (database first, then screens, each with a test)
Each fix gets a new migration, a database test, and a check in the browser.

1. **Double booking after a late return.** A piece kept past its return date counts as free, because its hold ends on the planned date.
   - Fix: while a rental is out, its pieces stay held until they come back.
   - Where: `find_available_units`, `branch_availability` and the piece check in `create_rental`/`update_rental`, all in migration 000012.
2. **Price cuts with no trace.** Any role can type any discount or agreed price at booking.
   - Negotiated prices are the model, so keep them, but record who changed the price and why.
   - Show these changes to the owner on Finance as "Price changes".
   - Assumption: there is no cap per role at launch. Ask the owner whether staff should have a maximum discount.
3. **Deposit given back while the piece is still out.** Allow a deposit refund only at return or on cancellation, or by the owner with a reason. Staff can then see the payments of that rental.
4. **Backdated return time removes the late fee.** No time before pickup. More than 2 hours back needs owner or manager, and is written to the audit log.
5. **Closing a return with money still due or the deposit still held.** Ask for confirmation, and show it on the Dashboard under "To collect".
6. **Bookings never picked up.** Add a "No-show" action with a cancellation fee, kept from what was paid. The deposit is returned. Optional: a shop setting for an automatic no-show after N days.
7. **Lost piece.** Suggest a charge from `products.replacement_value`. Staff can change the amount.
8. **Receipt or invoice.**
   - Shops without a GSTIN print a "Receipt" with its own number.
   - "Tax invoice" only when the shop has a GSTIN, with an invoice number per shop that never changes, the date of issue (not the print date), and HSN/SAC.
   - A cancelled booking prints as cancelled. Use the shop logo.
   - Decided: both, chosen per shop by entering a GSTIN in Shop settings.
9. **New shops paused on day one.** `pause_overdue_shops` pauses a shop with a fee and no `paid_until`.
   - Decided: a 14-day trial. `create_shop` sets `trial_ends`, and the pause skips shops still in their trial.
   - The console shows "Trial, N days left".
10. **Database tightening.**
    - Settings: `update_my_shop` accepts only known keys (an allow-list).
    - Rights: revoke `CREATE` on `public` from `app_rpc`, and remove the direct update of `units.status`.
    - Unblocking a customer: owner or manager only.
    - Missing indexes: `customer_measurements`, `appointments`, `staff_invites`.
    - Owner invite: write it to the audit log and give a clear message when the plan's login limit is reached.
12. **Expenses and profit/loss (new, before launch).** Finance today only has money coming in (payments, deposits). Nothing records money going out.
    - Table `expenses` (shop, branch, date, category, amount, note, who added it), with row-level security and an audit entry for edits and deletes. Amounts cannot be negative.
    - Functions `add_expense`, `update_expense`, `delete_expense`. Owner and manager can add; only the owner can edit or delete.
    - Default categories for clothing shops: shop rent, salaries, dry-cleaning and laundry, tailoring and alterations, repairs, electricity and internet, marketing, transport, other. The shop can add its own.
    - Finance gets an "Expenses" tab, and a Profit line next to Earned: Profit = earned − expenses for the chosen dates and branch. Expenses are in the Finance CSV.
    - Tests: expense totals match their records; profit = earned − expenses; staff cannot see or add expenses.
11. **Product wizard.** Save the product and its pieces in one database function, so a failure cannot leave a product without pieces and two people cannot get the same piece codes. Today the pieces are inserted from the browser (`ProductWizard.tsx:186-219`).

**Questions to ask, not decide** (they go to docs/HANDOVER.md):
- Is the late fee charged at the catalogue day rate, or at the agreed price per day?
- A grace time for clothes?
- Partial returns: after launch, using docs/PARTIAL_RETURNS_DESIGN.md.

## 4. UX and flow check (every screen, every role, phone and desktop)
Method: one sheet per screen with:
- who uses it and what they come to do;
- the one main action, and why it sits where it sits;
- the order of fields;
- empty, loading and error states.

Fix anything that has no reason to be there. Rules:
- One main button per screen. On phones it stays at the bottom, in reach of the thumb.
- Actions that delete or give money back ask for confirmation and, for corrections, a reason.
- Money is always shown the same way: total, paid, balance, deposit held.
- A skeleton or spinner instead of a bare "Loading…" (41 places). No silent errors (11 reads ignore them).

Do the walk in the browser as owner, manager and staff of the bridal shop and of the groom shop, at 375 px and on desktop.

**Bridal flow tests to add:**
- Playwright, owner and staff: book → advance → hand over → part payment → return late → late fee → deposit partly kept → Finance figures equal the records.
- Cancel and no-show.
- Extend and swap a piece.
- Double booking after a late return (blocker 1).
- Database tests for every rule in section 3.

## 5. Zypher console and per-shop customisation
**Zypher's powers** (setup and billing only, never a shop's business data):
- Shops: create, plan, fee, pause, trial end.
- Business types and feature switches per shop.
- Branches, staff and roles.
- Zypher payments and receipts, audit log, support login on request.

**Add before or soon after launch:**
- Trial and "paid until" per shop (Q4).
- A full data export of a shop (CSV zip) for the owner and for offboarding.
- Fix a wrong Zypher payment (void with a reason).
- Usage page per shop: bookings in 30 days, pieces, last sign-in.
- Announcement banner to shops.
- Shop offboarding: export, then switch off. No hard delete.

**Customisation without touching other shops.** One codebase, never a copy per client. In order of preference:
1. **Setting**: a value per shop (grace time, GST, receipt note, WhatsApp texts, logo, token prefix).
2. **Feature switch**: per shop in `shops.settings.features`. It is off by default and tested both on and off.
3. **Business type template**: wording, fields, checks and rates shared by all shops of that type.
4. **Module behind a switch**: new code, last resort. It is built once and can be sold to every shop.

**Needed so this works:**
- **Feature list**: one file listing every feature key, its default, the plan it belongs to, and who may switch it.
- **Store only what differs**: a shop stores only its own overrides. Today one toggle copies every switch and freezes the template defaults for that shop.
- **Checked settings**: settings are checked against the feature list in the database.
- **Move fixed texts into settings**: WhatsApp texts, receipt fields and token prefix become per-shop settings.

**Path for a shop's request:**
1. Write it down and pick the lowest layer that fits.
2. Build it on a branch behind a switch, test it on staging, and switch it on for that shop only.
3. Price it: settings are free; a new feature is quoted once and then becomes a switch other shops can buy.

## 6. Hosting, backups and go-live
**Accounts:**
- Separate Overbooked accounts (not TRENDZ): Supabase Pro for production and a free staging project, Vercel, a domain.
- An email sender (SMTP) for invite mails. Supabase's built-in mail is limited to a few per hour.

**Backups:**
- Primary: Supabase Pro daily backups, kept 7 days.
- Second: the encrypted daily dump workflow already in the repo (`.github/workflows/backup.yml`), the TRENDZ method plus encryption, kept 30 days.
- Photos: a weekly copy of the storage photos, which are not in a database dump.
- A monthly restore test into a scratch project. A backup never restored is not a backup.
- Point-in-time restore is skipped for now (~$100/month).
- **PARKED (29 Oct, owner's decision):** for now we rely on Supabase's own 7-day backups. The owner will discuss the rest of this section with the partner after development. Do not build it yet. The risk is stated plainly: a mistake found after 7 days cannot be undone.
- **Why 7 days is not enough:** Supabase's backup is only the safety net. If a shop notices a wrong entry two weeks later, a 7-day backup cannot help. So we keep more history ourselves, using the same GitHub method as TRENDZ (daily `supabase db dump`, which is the right method; the YouTube video could not be watched, so this is based on the workflow file):
  - Daily dump, kept 30 days (GitHub).
  - Every Sunday's dump, kept 12 weeks, and the first of each month's dump, kept 12 months (off-site storage).
  - Photos copied weekly.
- **GitHub space is the limit.** A free private repo has about 500 MB for workflow files, so 30 daily dumps will not fit for long.
  - Keep 7 daily dumps on GitHub.
  - Copy one dump a week, plus the photos, to cheap storage of our own (Cloudflare R2 or Backblaze B2, a few GB free). This needs an account, so you choose.
  - That gives 3 copies in 2 places, one outside Supabase.
- **Shop-level export**: the owner can download all their data (CSV zip) at any time. It is their own copy and a selling point ("your data is yours").

**Watching:** an uptime check, plus error tracking (Sentry is a new dependency, so ask first). Use the free tiers.

**Go-live:**
1. Apply the migrations to staging and test there with fake data.
2. Apply them to production. Keep sign-up off and never run the demo seed there.
3. Zypher creates the pilot shops and loads their stock from CSV.

## 7. Pricing and sales (final)

**Can we afford it?** Prices checked on 29 Oct 2026 on supabase.com/pricing and vercel.com/pricing.

| Item | Start (1–20 shops) | 180 shops |
|---|---|---|
| Supabase Pro (8 GB database, 100 GB files, 250 GB transfer, daily backups kept 7 days) | $25 | $25 |
| Bigger database computer: "Small" (about $5 extra; the 22 Oct load test says Small carries about 180 busy shops) | – | ~$5 |
| Extra files and transfer (handover photos, ~$0.02/GB) | – | ~$10 |
| Vercel Pro, 1 seat (Hobby is not allowed for business use) | $20 | $20 |
| Staging (free Supabase), email sender (free tier), domain | ~$1 | ~$4 |
| **Total** | **~$46 ≈ ₹4,000** | **~$64 ≈ ₹5,500** |
| Optional later: minute-by-minute restore (Point-in-Time Recovery) | – | +$100 ≈ ₹8,800 |

- Revenue at 180 shops with a 60/30/10 mix of Starter, Pro and Business: an average of about ₹800 a shop, so about ₹1.4 lakh a month.
  - Hosting is then about 4% of revenue. Razorpay fees are about 2% more.
  - The real cost is support time, not servers.
- Break-even on hosting is about 10 Starter shops.
- **The $25 Supabase plan is enough from 1 to about 150–180 shops.** This comes from the load test in the 22 Oct PDF (100 busy shops with a year of data each): the included server carries about 80 shops, and "Small" (about ₹450 more a month, a setting inside Pro) carries about 180. Total stays about ₹5,000–6,000 a month. We re-check the real bill at 50 shops.
- Conditions from the same test: load one page at a time, precalculate dashboard totals, no 1,000-row cut-off, and Supabase's Spend Cap switched off. Finance still loads every rental's money columns (marked `shortcut` in `finance/page.tsx`); that must change before big shops arrive.
- So the ₹499 / ₹999 / ₹1,999 prices are affordable, and I stand by them.
- They keep the monthly price at or below BookieBuddy's (about ₹500–1,200) and drop its ₹12k–20k upfront fee.
- **Year one for a shop:** BookieBuddy about ₹19,000 (₹12k + ₹599 × 12). Overbooked Pro yearly ₹9,999 (+ ₹2,999 setup if the shop had no software).
- **GST:** Zypher must register once turnover passes ₹20 lakh a year, about 180 shops at this mix. Prices are quoted "+ GST if applicable". Check with an accountant.

**Prices** (before GST):

| Plan | Monthly | Yearly (2 months free) | Includes |
|---|---|---|---|
| Starter | ₹499 | ₹4,999 | 1 branch, 3 staff logins |
| Pro | ₹999 | ₹9,999 | up to 3 branches, unlimited staff, bridal extras (sets, measurements, alterations, fittings) |
| Business | ₹1,999 | ₹19,999 | unlimited branches and staff |

- **Every plan:** unlimited devices and items, bookings, calendar, deposits, receipts, QR tags, reports, WhatsApp links.
- **Setup:** ₹2,999 one time (stock loading, QR tags, staff training) for shops with no software.
  - Shops switching from other software: free move of their data and nothing to pay until their current plan ends.
  - First 10 founding shops: price locked for life and the setup fee waived, in return for being a reference.
- **14-day free trial**: the shop is not paused during it. After it, the existing overdue and auto-pause rules apply.
- **Plans differ only by branches and staff logins** at launch. Every feature is in every plan, so there is nothing to gate and it is easy to explain. This replaces "bridal extras on request" on Starter.
- **Sell yearly first**: 2 months free, money up front, fewer shops leaving.
- **To build in the console:** the plan prices. The fee is typed by hand today; store a price list and allow a negotiated override.

**Why us over BookieBuddy:**
- No ₹12k–20k upfront fee.
- No device limit.
- Branches included in the plan.
- Double booking blocked, including cleaning days.
- Exact deposit tracking.
- QR scan for hand-over and return.
- Staff locked to their branch who cannot see money.
- Every correction logged.
- Works in any browser.

**Be honest about what BookieBuddy has and we do not:** Android and iPhone apps (on Google Play and the App Store), expenses and profit/loss, automatic reminders, and claimed 5,000+ users (their own claim).
- Before launch: make Overbooked installable on the phone home screen (a web app manifest and icons, no new package). It opens like an app until the friend's mobile app is ready.
- Expenses and profit/loss: built before launch (blocker 12), so we match BookieBuddy.
- Confirm BookieBuddy's prices with a demo before quoting them.

**Sales:** use the two call scripts from 26 Oct (the shop already has BookieBuddy / the shop has no software), a 15-minute demo on a phone, and one reference shop before cold calls.
- Write the price sheet and both scripts into `docs/SALES.md`.
- Correct docs/BUSINESS.md, which still lists open questions that are now answered.

## 8. Order of work
1. Day 1:
   - Git: push, clean up branches, turn on branch protection.
   - Blockers 1, 2, 3, 4, 9 and 11, each with tests.
2. Day 2:
   - Blockers 5, 6, 7, 8, 10 and 12 (expenses).
   - Route guards and the installable phone app.
   - The role-by-role browser walk on phone and desktop, with fixes.
3. Day 3:
   - Hosting, email sender, backups switched on (with the off-site copy), staging test, production.
   - docs/SALES.md, the price list in the console, and updated docs.
4. Day 4 on: paid sales start (your choice).
   - The first 10 shops are founding shops: price locked for life, setup waived for a reference, close WhatsApp support.
   - Set each shop up from the console and load its stock from CSV.
   - Fix anything they hit within a day with a `hotfix/…` branch.
5. After launch: the cleanup PRs in section 2, the console additions in section 5, partial returns, expenses, then car, bike and resort, and the mobile app.

## Decisions taken on 29 Oct 2026
- Launch: proper paid business in the coming days.
- Prices as in section 7; Claude checked they are affordable.
- GST: a receipt by default, a tax invoice when the shop enters its GSTIN.
- 14-day free trial.

The first step of the work writes this plan to `docs/LAUNCH_PLAN.md`. It also corrects `docs/HANDOVER.md` and `docs/BUSINESS.md`, which are out of date: they show the wrong branch and list questions that are now answered.

## Verification (every step)
Run `npx supabase db reset`, then:
- `npx supabase test db`
- `npx tsc --noEmit`
- `npm run lint`
- `npm run build`
- `npx playwright test`

Also:
- Open every changed screen in the browser as owner, manager and staff, on phone and desktop.
- Before production, run the full bridal flow on staging with fake `QA-` data. Check that Finance matches the payment records.
- Restore one backup into a scratch project.
