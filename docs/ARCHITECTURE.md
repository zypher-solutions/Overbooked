# Architecture

## The big picture
```
 Browser
   │  Next.js app: shop app (src/app/(shop)) and Zypher console (src/app/zypher)
   │  reads tables directly, changes everything through database functions
   ▼
 Supabase
   ├─ Auth: email + password; invite links (server actions with the service key)
   ├─ Postgres: tables, row-level security, the rental engine (plpgsql functions)
   ├─ Storage: product photos (public), handover photos (private), one folder per shop
   └─ Realtime: rentals, payments, units, reservations
```
There is no separate backend. Business rules live in the database (`supabase/migrations`), so the web
app, the coming mobile app and anything else get the same rules. Every function checks who is calling,
their shop, role and branch. The screens only make it pleasant; the database has the final say.

## Many shops in one database
- Every business row carries `shop_id`. A restrictive rule on every table keeps a person inside
  `current_shop_id()`: their own shop, or for Zypher staff the shop they opened.
- Composite foreign keys (`shop_id, x_id`) make it impossible to link rows of two shops.
- Shop functions run as the role `app_rpc`, which the same rules bind, so even a bug inside one cannot
  reach another shop. Zypher functions (console) run as the owner and check `is_platform_admin()`.

## Roles
| Role | Who | Can |
| --- | --- | --- |
| super_admin | Zypher staff | The console; open any shop and act as its owner |
| owner | Shop owner | Everything in the shop: all branches, money, corrections, staff, settings |
| manager | Branch manager | Own branch: bookings, catalog and units there, money reports for the branch |
| staff | Counter staff | Own branch: bookings, handovers, returns, customers; no money reports |

## Business types
A business type (template) decides how time is counted (by day, by hour/day with km, by night with
guests), the wording, fields, prices, pickup/return checks, turnaround and optional features. A shop has
one or more types; each category belongs to one. The shop app reads the templates and adapts: a resort
says "Check-in" and asks for guests, a car shop asks for odometer, fuel and licence. See docs/DATABASE.md.

## The shop app (src/app/(shop))
| Screen | What it does |
| --- | --- |
| Today | Handovers and returns due (with missed ones), coming week, search by name, phone, booking no. or unit code, scan a tag |
| New booking | Period, items with live free counts, guests, driver, whole property, extras, customer, live price, advance and deposit |
| Bookings | Lists by status (booked, out, overdue, returned, cancelled), search, branch filter |
| Calendar | A timeline per room, vehicle or piece: bookings, out, cleaning/service time; click to open or book |
| Appointments | Fittings, trials, deliveries, collections (optional feature) |
| Print pages (src/app/print) | Customer receipt / GST tax invoice, QR sticker tags for units, Zypher receipts to shops |
| Booking page | Change the booking before pickup; hand over / check in with per-unit checks and photos; return / check out with suggested charges (late, extra km); money; extend; give another unit; cancel / no-show; owner corrections with reasons; WhatsApp messages |
| Customers | Search, history, what they owe, ID and licence, block |
| Catalog | Items by category with prices per rate type, units per branch and their status, extras, categories, CSV import |
| Money and reports | Money in by method, booked value, owed, deposits held, every money record (CSV), stock right now |
| Branches, Staff, Settings | Owner only: branches, invite links, roles, shop rules (grace time, check-in/out times, licence rule) |

### Bridal and groom shops: the TRENDZ screens
A shop whose business types are all clothes (`trendz` in `ShopContext`) gets the screens of TRENDZ, the
admin panel Overbooked grew from. Cars, bikes and resorts keep the screens above.

| Menu | Screen | What it does |
| --- | --- | --- |
| | Dashboard (`/`) | Pickups today / Returns due today / Overdue cards that pick the list below (Hand over, Return, WhatsApp); To collect; all rentals out, sortable and filtered |
| | Finance | Earned, collected, outstanding, deposits held (vs the previous period); daily close per payment method; by branch; ledger CSV |
| Rentals | Bookings | Cards by upcoming pickup; pickups today / tomorrow / a date; status, branch, search incl. SKU; pieces kept |
| | Inventory Search (`/scan`) | Scan a tag (camera or USB scanner) or type a name, SKU, piece code or booking no. Find and book: stock per branch (Total / Avail / Rented), Add to Cart. Receive back: a scanned piece opens its return with that piece ticked |
| | All Rentals | Products with stock per branch; tap for Add to Cart per size and branch, and who has it out |
| Products | All Products, Add New Product, Categories | Add New Product is a 3-step form: basic info, attributes (Colour, Size...), variations and pieces per branch (pieces are created with codes for QR tags). Changing a product uses the same form |
| Admin | Branch / Staff Management, Stock Locations, CSV Import, Shop settings | Stock Locations: pieces per branch (free, out, service, lost) |

The cart (`src/lib/shop/cart.tsx`) keeps items per person and shop on the device; a floating Checkout (n)
opens the booking form with them. On a return, clothes are ticked piece by piece (scanned, typed or tapped);
a missing piece must be marked lost.

Shared code: `src/lib/shop` (types, formats in the shop's time zone, data helpers, WhatsApp texts),
`src/components/shop` (dialogs and parts). Sign-in and the current shop: `src/lib/overbooked/AuthContext.tsx`.

## The Zypher console (src/app/zypher)
Guarded on the server. Overview (fees, collections, overdue, unused shops), shops and shop page (plan,
monthly fee, notes, pause, business types, feature switches, people, payments), new-shop wizard, billing
(receipts, WhatsApp reminders), business types, audit log, Zypher team, settings (company and bank
details, automatic pause of long-overdue shops).

## The mobile app
Built separately against the same database. Everything it may use is in docs/APP_CONTRACT.md (contract v1).

## Main flow of a rental
1. **Book** (`create_rental`): the quote is recalculated in the database, units are reserved for the
   period plus turnaround. Overlapping use of a unit is impossible (exclusion constraint).
2. **Hand over / check in** (`start_rental`): checks per unit, licence for vehicles, money taken.
3. **Return / check out** (`complete_rental`): checks, charges (suggested by `return_suggestions`),
   deposit kept or given back, unit freed after its turnaround, damaged units go to service.
4. Later: charges that arrive afterwards (a challan), payments, owner corrections, all logged.

## Business invariants (the database enforces them)
- total = lines + extras + charges − discount (a cancelled booking's total is its fee)
- 0 ≤ paid ≤ total, so the balance is never negative
- deposit given back + kept ≤ deposit received
- end after start; no negative amounts; no overlapping use of a unit
- the dashboard sums the money records themselves, so it always matches them
