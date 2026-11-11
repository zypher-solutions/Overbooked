# Changelog

## 0.3.0 (unreleased): v2 rental engine
- Staff controls and voiding payments (migration 39, 11 Nov 2026; APPLIED to the shared cloud project and checked there in rolled-back
  transactions; pgTAP not yet run; tests: supabase/tests/staff_controls; plan: docs/LAUNCH_PACK_1_PLAN.md part C):
  - Settings > Staff controls (whole shop; every default is the old behaviour, every rule checked in the database): most discount
    staff and managers may give (discount plus prices agreed below the list price, as % of the price), who may void a payment, lower
    the suggested late fee, cancel a booking that has payments, give a deposit back before the return, and after how many hours a
    back-dated return needs a manager (2, 6 or 24)
  - a wrong payment is voided with a reason: it stays on the booking, struck through, and counts nowhere (booking, Finance,
    dashboard, printed receipt); the correct payment can be entered in the same step; Delete is no longer offered in the app and
    "Change how it was paid" changes only the method
  - activity log: voids are important entries with the reason; a "Money changes" button filters to them
  - fixed the same day on the shared project: for a few minutes after 39 was applied, the discount check crashed any booking saved
    with a discount or an agreed price
- Settings page with a branch switch (migration 38, 11 Nov 2026; APPLIED to the shared cloud project and checked there in
  rolled-back transactions; pgTAP not yet run; tests: supabase/tests/branch_settings; plan: docs/SETTINGS_PAGE_PLAN.md):
  - new Admin > Settings page (owner): every setting in one searchable table (setting, value, applies to, edit); each row is
    edited in a small dialog and saved on its own
  - "Settings for" switch: All branches (the shop's values) or one branch; a branch can give itself its own value for the
    receipt note, the late-return rules, grace time and check-in/out times ("Branch only"), and go back with "Use shop
    default"; GST %, SAC and the licence rule stay for the whole shop
  - bookings use their branch's values: the late rules copied onto a new booking, the grace time at return, the receipt
    note on the print, the usual check-in/out times on a new booking, the order of the late-piece buttons
  - Branch management keeps the branches and the shop's details only; the owner can now rename the shop; the shop and each
    branch get city, state (list of states and UTs) and PIN code; the settings tabs added earlier the same day moved to Settings
- Late returns (migration 37, 11 Nov 2026; APPLIED to the shared cloud project and checked there in rolled-back transactions;
  pgTAP not yet run, Docker would not start; tests: supabase/tests/late_returns;
  plan: docs/LAUNCH_PACK_1_PLAN.md parts A and B):
  - Branch management shows its settings in tabs (Shop details, Receipts & tax, and for clothing shops Late returns); one Save as before
  - Late returns: late fee on or off; a % of the piece's day price (catalogue rate or agreed price, 0 to 300%) or a fixed amount
    per piece per day; calendar days with an optional latest return time, or 24-hour blocks; optional maximum (% of the rent or
    the replacement value); a live example. Defaults are the old rule, so nothing changes until the owner changes it
  - each new booking keeps a copy of the rules (`rentals.late_terms`); bookings made earlier keep the old formula
  - the return screen's late-fee suggestion shows the working ("2 days late x ₹800 ... = ₹1,600"); staff still confirm it
  - a product can have its own late fee per day (product form; kept apart from its prices so other saves never clear it)
  - a piece still out late with one customer: its next booking shows a warning with "Swap piece" and "Hold hand over" (the shop
    setting picks which comes first); a held booking cannot be handed over until the hold is removed; the lists show
    "Piece still out late" and "Next booking waiting"; holds and product late fees are in the activity log
- Zypher support with your own login (migration 36, 11 Nov 2026; APPLIED to the shared cloud project; tests: supabase/tests/support_visits, activity):
  - a Zypher admin opens a shop with "Enter shop as support" in the console, only while its owner allows Zypher support and after two-step sign-in
  - inside the shop they have exactly the limits of a support login (no money corrections, no consent switch, no staff changes, no activity log)
  - the owner switching support off ends every visit at once; "Leave shop" and signing out end it too; entering and leaving are in the owner's activity log
  - several admins may be in one shop; the per-shop support logins still work
  - the Stock Locations page (support only, carried over from TRENDZ) is removed; piece counts per branch stay on the product screens
- Admin section (migrations 30 and 31, 9 Nov 2026; tests: supabase/tests/attributes, scripts/check-bulk):
  - each shop has its own attributes (`shop_attributes`: Colour, Size, Length ...) instead of the fixed business-type list; Admin > Attributes adds, renames, reorders and archives them
  - one Admin page per attribute for its preferred values (`shop_attribute_values`), suggested on the product form and in bulk add; a new value saved on a product joins the list
  - Admin > SKU: which attributes go into system-made variation SKUs and in what order (category + number first, piece number last); saved SKUs never change
- Pre-launch rules (migrations 22 to 25, 29 Oct 2026), each with database tests (supabase/tests/launch, expenses, products,
  invoice) and browser tests (tests/launch.spec.ts):
  - a piece still out past its return date is no longer offered to new bookings (free counts, piece picker, chosen pieces, swaps)
  - the deposit is given back at return or cancellation; only the owner can hand it back while the piece is out
  - a return time more than 2 hours in the past needs a manager or the owner and is written to the audit log
  - 14-day free trial for new shops (`shops.trial_ends`); a shop in its trial is not paused for a missing payment
  - `update_my_shop` accepts only known settings; only a manager or the owner unblocks a customer
  - price changes (discount, agreed price) are logged with who made them (`price_changes`, owner and manager read)
  - bug fixed: creating a clothing shop from the Zypher console failed (its first category had no base SKU); it now starts with CL
  - expenses and profit: `expenses` table, `add_expense` (owner, manager), `update_expense` and `delete_expense` (owner, with a reason, audited),
    `expense_summary`; Finance shows Expenses and Profit (earned minus expenses) and an Expenses list with CSV
  - `save_product` makes the pieces in the same step (variation `stock` per branch), so a product is never left without its pieces
  - tax invoices: own number (PREFIX/YYMM-style financial year/NNNN) and date, fixed when issued after the return (`issue_invoice`);
    a shop without GSTIN prints a plain receipt; a cancelled booking prints a cancellation receipt; optional SAC code in Shop settings
  - each kind of shop is sent to its own screens (bridal shops never land on the old lists, car shops never on the clothing screens)
  - the app can be added to a phone's home screen (web app manifest and icons)
  - the return screen asks before closing a rental that leaves money unpaid or a deposit held, and a piece marked lost gets a
    "Lost item" charge of its replacement value (staff can change it)
  - the console shows "Trial, N days left" (migration 26); a shop in its trial is not counted as overdue; the owner invite checks the
    plan's login limit first and is written to the audit log
  - Finance loads only the rentals in the dates plus those with money still open (`finance_open_money`, migration 27), not every rental
  - load test on today's code: one busy shop-year (6,000 bookings) adds 35 MB; screens load in 6 to 31 ms, 62 KB on average
    (scripts/load-data.sql was updated for the SKU rule)
- New database designed from scratch for bridal, groom, resort, car and bike rentals; the inherited TRENDZ
  migrations and QA history are removed
- One rental record from booking to return, time ranges, double booking blocked by the database, business
  templates, rates, add-ons, charges, pickup/return checks, payments as the single money record
- Demo data: one shop per business type plus a Zypher admin; 114 database tests
- Zypher console moved to its own area, `/zypher`, checked on the server: overview (fees, collections, overdue
  shops, shops not using it), shops list with billing filters, shop page (plan, monthly fee, notes, pause/resume,
  business types, feature switches, branches, people, invites, payments), new-shop wizard from business types,
  billing, business types and audit log. Shops have an agreed monthly fee. Zypher staff sign in to the console
- Shop app rebuilt on v2 as separate pages: Today, New booking (live price and free counts), Bookings,
  booking page (handover and return with checks, photos, suggested charges, extend, swap, cancel, corrections,
  WhatsApp), Customers, Catalog (items, prices, units, extras, categories, CSV import), Money and reports,
  Branches, Staff, Settings. Wording and fields follow each shop's business types
- The TRENDZ-era screens, store and PDF ledger are removed
- Browser tests rewritten for v2 (tests/v2-shop.spec.ts)
- Receipts and GST tax invoices, changing a booking before pickup, a calendar per unit, printable QR tags,
  the owner's plan and payment reminders, Zypher receipts, payment kinds, an optional automatic pause of
  long-overdue shops, Zypher team logins, one-tap customer reminders on Today
- Optional features: sets, measurements, alterations, appointments
- Hand-over pack for the mobile app: docs/APP_CONTRACT.md (contract v1) and generated types
  (src/lib/database.types.ts, regenerated with `npm run types`)
- Bridal and groom shops get the TRENDZ screens: sidebar, cart with Checkout, Inventory Search (scan or type, receive back),
  Dashboard, Finance, Bookings, All Rentals, All Products, 3-step Add New Product, Stock Locations; other business types keep their menu
- Branches, staff and stock locations are Zypher-only (database policies and functions, not just the menu); migration 20261101000011
- Paged lists use a unique order; CSV exports escape formulas
- Bridal and groom booking form follows TRENDZ: customer and payment stay closed until the dates are valid and every item
  is free; every booked piece is chosen (the first free one is pre-selected, staff can change it); cleaning days are typed
  per booking
- SKUs of bridal and groom shops follow TRENDZ: category base SKU (2 to 6 capital letters), product `BR-001` numbered for
  you (not typable), variation `BR-001-GOLD-M`; checked in the forms, the CSV import and the database. Demo SKUs renamed
- Dashboard and Finance of bridal and groom shops completed to match TRENDZ: Filter panel with chips, Completed Rentals,
  Ledger Records with Record payment, Export PDF and Records CSV, search in place, phone cards. Audit kept in the git history (docs/TRENDZ_PARITY.md, removed on 30 Oct 2026)
- Bookings (Buffer, Available, Completed Bookings) and All Products (stock filter, Delete, Reactivate, phone cards) match TRENDZ
- One "Clothing rental" business type replaces Bridal wear and Groom wear (they were identical); Colour and Size attributes offer
  clickable suggestions, the attribute name is a dropdown with Custom, the "Can be booked" tick box is removed (Delete and Reactivate in All Products cover it)
- **Setup lives in the console**: each shop's page has Branches (one list: Branch Management and Stock Locations are the same thing) and Staff tabs. The "Open shop" step is gone; every setup action names the shop, so two tabs can work on two shops and nothing stays switched on after sign-out. Zypher admins no longer reach any shop screen (they are sent back to the console)
- **Zypher is setup and billing only**: the console and Open shop can no longer read or change a shop's bookings, customers, money,
  products or photos (the database refuses, not just the menu). A per-shop Zypher login (role `support`) works inside one shop for
  debugging, without money corrections. Closed: a recovery link could be made for any user; billing, shops and business types could be
  edited with free-form writes. Setup changes are written to the audit log
- GitHub Actions: CI (types, lint, build, database tests, browser tests) and an encrypted daily database backup, both off until the
  secrets exist; docs/RUNBOOKS.md
- Two-step sign-in (authenticator app) is required for Zypher admins and support logins, enforced in the database (`require_mfa`, nobody can switch
  it off from the app); optional for everyone else (Change password > Set up two-step sign-in). New /mfa page, show-password eye, Caps Lock
  warning and password rules checklist on login, welcome and change password; login errors no longer say which part was wrong
- Attack tests (supabase/tests/security.test.sql): cross-shop, role escalation, signed-out, paused shop, audit log, and rules about the database
  itself. Found and fixed: open self sign-up, signed-out and signed-in roles had every table right (TRUNCATE is not covered by row rules),
  a leftover image host of the TRENDZ production project in next.config, no size or type limit on photo buckets, no security headers beyond
  the basics (now a Content Security Policy)
- Code structure: clothing-only code moved to `src/modules/clothing`; lint rules stop modules importing each other and stop client code importing
  the service-role key; menus per module (`nav.ts`); GitHub templates, CODEOWNERS, dependabot, docs/BRANCHING.md; local `development` branch
- Also found and fixed by attack testing: a shop could read Zypher's private notes about it; Zypher's audit view showed money corrections
  (now setup and billing changes only); `npm audit` reported Next.js (critical), sharp and source-map-js: updated within their ranges, unused
  `zod` removed, now 0 vulnerabilities; password change now needs a recent sign-in (`secure_password_change`)
- A smoke crawl (tests/smoke.spec.ts) opens every main screen for a clothing owner, resort owner, car staff and Zypher and fails on any page
  error, React warning or failed data request
- 287 database tests, 19 browser tests

### Database
- `20261101000021_setup_in_console.sql`: setup by shop id (`setup_branches`, `setup_save_branch`, `setup_delete_branch`, `setup_people`, `setup_set_person`, `setup_check_invite`, `setup_check_person`); drops `switch_shop`, `setup_shop_id`, `profiles.active_shop_id` and the old staff functions; Zypher reads no shop table directly. NOT APPLIED to any hosted database
- `20261101000020_shop_notes_private.sql`: `shops.notes` unreadable by shop people; Zypher audit view limited to setup and billing. NOT APPLIED to any hosted database
- `20261101000019_storage_limits.sql`: photo buckets accept only jpeg/png/webp, 5 MB (products) and 10 MB (handover photos). NOT APPLIED to any hosted database
- `20261101000018_least_privilege.sql`: signed-out role loses all table rights; signed-in role loses TRUNCATE/TRIGGER/REFERENCES and write rights where no write rule exists. NOT APPLIED to any hosted database
- `20261101000017_two_factor.sql`: `platform_settings.require_mfa` (default on), `mfa_required()`, privileged roles need aal2. NOT APPLIED to any hosted database
- `20261101000016_zypher_setup_only.sql`: Zypher setup-only (`setup_shop_id`, `current_shop_id` empty for Zypher), role `support`, audit of setup changes, billing/shops/types by function only. NOT APPLIED to any hosted database
- `20261101000015_clothing_template.sql`: one `clothing` business type replaces `bridal` and `groom` (categories, shops, add-ons re-pointed), suggestions in the attribute list. NOT APPLIED to any hosted database
- `20261101000014_reactivate_product.sql`: `reactivate_product(uuid)` for owners and managers. APPLIED to local only
- `20261101000012_cleaning_days_per_booking.sql`: `rentals.cleaning_days`; optional `p_cleaning_days` on `branch_availability`
  and `find_available_units` (old calls unchanged); create, change, return and extend use it. APPLIED to local only
- `20261101000013_sku_format_clothes.sql`: SKU format triggers for clothes shops, checked when a SKU is added or changed.
  APPLIED to local only

## 0.2.0 (2026-10-24): many shops
- One database serves many shops. Isolation is enforced by a restrictive policy, composite foreign keys
  and `app_rpc`-owned functions; 31 database tests cover it (`supabase/tests`)
- Zypher console: create shops, open any shop, plans, pause, manual bank payments and paid-until
- Staff invites and forgotten-password links to share on WhatsApp (`/welcome`); owners manage their own staff and branches
- Per-shop numbering, SKUs, plan limits, photo folders and branding (sidebar, WhatsApp texts, PDF)
- Data loads page by page (no silent 1,000-row cut-off), stock counts come summed from the database,
  and live updates are per shop
- Security rules evaluate their checks once per query: a screen load with the rules on is 23× faster

## 0.1.0 (2026-10-22): forked from TRENDZ
- Copied from TRENDZ `main` @ 54a190e into a new, unlinked repository
- Removed the TRENDZ database backup workflow; archived TRENDZ QA reports in `docs/trendz-history/`
- Added `supabase/migrations/20260901000000_baseline.sql`: base tables rebuilt from code (TRENDZ never committed them)
- Added local Supabase config, demo seed data, `.env.example`, and the docs set
