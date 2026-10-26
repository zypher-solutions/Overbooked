# Overbooked app contract, v1

For the developer building the Overbooked mobile app for **shop staff and owners** (the rental shops that
pay Zypher). Not an app for the shops' own customers.

The web app at `src/app/(shop)` is the reference: every screen there uses only what this document
describes, so when in doubt, read how the web app does it.

**Contract v1 is frozen.** Tables, columns, function names, inputs and outputs below will not change
without a new version (v2) and notice. Additions (new columns, new functions, new optional input keys)
can happen in v1 and must be ignored safely by the app.

---

## 1. Connecting

| Thing | Value |
| --- | --- |
| Backend | Supabase (Postgres + Auth + Storage + Realtime) |
| Client library | `@supabase/supabase-js` v2 (or the Supabase Flutter / Swift / Kotlin client) |
| URL and key | The project URL and the **anon (public) key** of the environment, from Zypher |
| Environments | `staging` for building and testing, `production` for real shops. Never point a test build at production |
| Types | `src/lib/database.types.ts` (generated; `npm run types` regenerates it) |

**Never** put the service-role key in the app. Everything the app needs works with the anon key plus the
signed-in user's session; the database decides what each person may see and do.

## 2. Signing in, the person and their shop

1. Sign in with email and password: `supabase.auth.signInWithPassword({ email, password })`.
   People get their account from an **invite link** created in the web app (Zypher invites owners and staff from the console;
   shops do not invite). The link opens the web page `/welcome`, where they set their password. The app does
   not create accounts.
2. Read the person: `profiles` where `id = auth.uid()`:
   `full_name, role ('owner' | 'manager' | 'staff' | 'super_admin'), shop_id, branch_id, is_active`.
3. Check they can work: `rpc('get_my_role')` returns the role, or `null` when the account is switched
   off, their branch is closed or the shop is paused. **If null, sign out and show:**
   - paused shop (`shops.status = 'suspended'`): "Your shop's Overbooked account is paused. Please contact Zypher."
   - otherwise: "Your account or your branch has been switched off. Contact the owner."
4. Read the shop: `shops` where `id = profile.shop_id`. Useful columns: `name, timezone ('Asia/Kolkata'),
   business_types[], settings, plan, paid_until, phone, address, gstin`.
5. Read the shop's setup once and cache it for the session:
   - `branches` (all of the shop's branches; `is_active`)
   - `categories` (`template_key` links each to a business type)
   - `business_templates` where `key` in `shop.business_types`
   - `add_ons` (extras) where `is_active`

`super_admin` (Zypher staff) should use the web console; the app can refuse them.

### Who can do what
| | Owner | Manager | Staff |
| --- | --- | --- | --- |
| Branches | All | Own branch only | Own branch only |
| Book, hand over, return, customers | Yes | Yes | Yes |
| Money records and reports | Yes | Own branch | **No** (payments are not readable) |
| Add charges after the fact, catalog, units | Yes | Yes (units: own branch) | No (read only) |
| Corrections (with a reason), delete | Yes | No | No |
| Staff, branches, shop settings | Yes | No | No |

A manager or staff member always works in `profile.branch_id`. Every function refuses other branches.

## 3. Business types: let the template drive the screens

`business_templates` describes each type. Read these fields; do not hard-code bridal, car or resort.

| Field | Use |
| --- | --- |
| `kind` | `wearable` (priced by day), `vehicle` (hour/day, km), `room` (night, guests) |
| `labels` | Words to show: `item, items, unit, units, start, end, variation, turnaround` (for example a resort says "Check-in", a car shop says "Drop-off") |
| `variation_fields` | Fields of a variation (size, colour, fuel, seats ...), stored in `product_variations.attributes` |
| `unit_fields` | Fields of a unit (registration no., floor ...), stored in `units.attributes` |
| `checks` | What to record at `pickup` and `return`: `condition, notes, photos, odometer, fuel_level, licence` |
| `rate_types` | Prices a variation can have (`hour, day, night, extra_km, extra_hour, extra_person, driver_day, late_penalty`) |
| `turnaround` | Default gap after each rental (cleaning, servicing, housekeeping) |
| `features` | Default optional features; the shop's own switch wins: `shops.settings.features[key]` |
| `measurement_fields` | Measurement names (bridal, groom) |

A feature is on when `shops.settings.features[key]` is `true`, or when it is not set and any of the
shop's templates has it `true`. Feature keys: `sets, measurements, alterations, appointments, guests,
meal_plans, whole_property, with_driver`. Hide what is off. The database also refuses sets, alterations,
whole-property and driver bookings when they are off; measurements and appointments are only hidden.

Shop policies in `shops.settings`: `grace_minutes` (default 60), `check_in_time` ("14:00"),
`check_out_time` ("11:00"), `require_licence` (default true), `gst_percent`, `receipt_note`.

## 4. The catalog (read)

```
categories ─< products ─< product_variations ─< variation_rates (rate_type, amount)
                                     └──────< units (one physical piece / room / vehicle, per branch)
```

Read with explicit relationship names (the tables are linked by shop as well, so PostgREST needs them):

```js
supabase.from('products')
  .select('*, product_variations!product_variations_shop_product_fkey(*, variation_rates!variation_rates_shop_variation_fkey(rate_type, amount))')
  .eq('is_active', true)
```

Units: `units` (`code, status ('available' | 'maintenance' | 'lost' | 'retired'), status_reason, branch_id,
variation_id, attributes, odometer`). A unit's QR tag contains just its `code`.

Sets (feature `sets`): `products.is_set = true`; its pieces are in `set_items (set_product_id,
variation_id, qty)`. Book a set like any item; the database reserves its pieces.

## 5. Bookings: one record from booking to return

`rentals.status`: `reserved` (booked) → `active` (out / checked in) → `completed` (returned / checked
out), or `cancelled` / `no_show`. One booking number: `rentals.token`, like `KAL-2026-0042`.

Money columns on `rentals` are kept by the database. **Never compute them yourself; read them.**

| Column | Meaning |
| --- | --- |
| `items_total, add_ons_total, charges_total, discount` | Parts of the price |
| `total` | What the customer owes in all (a cancelled booking's total is its fee) |
| `paid` | Payments + deposit kept − refunds |
| balance | `total - paid` (never negative) |
| `deposit_agreed, deposit_received, deposit_refunded, deposit_applied` | Security deposit; held now = `received - refunded - applied` |

Reading a booking with everything under it (this is what the web app does):

```js
supabase.from('rentals').select(
  '*, customers!rentals_shop_customer_fkey(*), rental_lines(*), rental_add_ons(*), rental_charges(*), rental_checks(*), ' +
  'unit_reservations(*, units!unit_reservations_shop_unit_fkey(id, code, odometer, status, status_reason, variation_id))'
).eq('id', id).maybeSingle()
// money records separately (owners and managers only; staff get an empty list)
supabase.from('payments').select('*').eq('rental_id', id).order('paid_at')
```

Lists: select the columns you show, page with `.range(from, to)` (the server returns at most 1,000 rows
per request), and filter by status and dates, for example:

```js
supabase.from('rentals')
  .select('id, token, status, start_at, end_at, total, paid, branch_id, customers!rentals_shop_customer_fkey(id, full_name, phone), rental_lines(description, qty, kind)')
  .eq('status', 'reserved').lt('start_at', endOfTodayIso).order('start_at')
```

`unit_reservations.period` is a time range (`["start","end")`) that includes the turnaround; `state` is
`held` (booked), `out`, `returned` or `released` (cancelled).

## 6. Functions (the only way to change bookings and money)

Call with `supabase.rpc(name, args)`. On a refusal the error `message` is a sentence written for the
person at the counter (for example "Only 0 of 1 available for Red bridal lehenga - M on these dates"):
show it as it is. All times are ISO 8601 with a time zone. Money is rupees with up to 2 decimals.
Payment `method`: `cash | upi | card | bank_transfer`.

### Booking
| Function | Input | Returns |
| --- | --- | --- |
| `quote_rental` | `p`: [quote input](#quote-input) | `{lines[], add_ons[], items_total, add_ons_total, total_before_discount, days, nights, hours}` |
| `branch_availability` | `p_branch_id, p_start, p_end` | rows `{variation_id, free, total}` (sets included) |
| `find_available_units` | `p_branch_id, p_variation_id, p_start, p_end` | rows `{unit_id, code}` |
| `create_rental` | `p`: quote input + `customer`, `discount`, `deposit_agreed`, `notes`, `advance`, `deposit` | `{rental_id, token, total}` |
| `update_rental` | `p_rental_id`, `p`: quote input (without `branch_id`) + `discount`, `deposit_agreed`, `notes` | `{total, paid, balance}`; only while `reserved` |
| `extend_rental` | `p_rental_id, p_new_end, p_payment?: {amount, method}` | `{end_at, total, paid, balance}` |
| `swap_unit` | `p_rental_id, p_old_unit_id, p_new_unit_id` | nothing; only `held` units |
| `cancel_rental` | `p_rental_id, p_fee, p_refund_method, p_reason, p_no_show` | `{status, fee, refunded, deposit_refunded}`; no-show only after the start |
| `update_rental_notes` | `p_rental_id, p_notes` | nothing |

<a id="quote-input"></a>**Quote input** `p`:
```json
{
  "branch_id": "uuid", "start_at": "2026-12-10T04:30:00Z", "end_at": "2026-12-12T12:30:00Z",
  "adults": 2, "children": 0, "with_driver": false, "whole_property": false,
  "lines": [{ "variation_id": "uuid", "qty": 1, "amount_override": 4000, "unit_ids": ["uuid"] }],
  "add_ons": [{ "add_on_id": "uuid", "quantity": 1 }]
}
```
`amount_override` (optional) is a negotiated price for the whole line. `unit_ids` (optional) picks exact
units and must have exactly `qty` entries; otherwise free units are chosen. `whole_property` books every
room of the branch and ignores `lines`.

`create_rental` extra keys: `customer: {id}` for a returning customer, or `{full_name, phone, email,
address, id_type, id_number, licence_number, licence_expiry}` for a new one (`id_type`: `aadhaar,
driving_licence, passport, voter_id, pan, other`); `advance` and `deposit`: `{amount, method}` or null.
The start may be earlier today (walk-ins) but not on a past day.

### Handover and return
| Function | Input | Returns |
| --- | --- | --- |
| `start_rental` | `p_rental_id`, `p: {id_verified, checks[], payment?, deposit?}` | `{status, total, paid, balance, deposit_held}` |
| `return_suggestions` | `p_rental_id, p_returned_at, p_odometers: [{unit_id, odometer}]` | `{charges: [{type, amount, note}]}` (late, penalty, extra km) |
| `complete_rental` | `p_rental_id`, `p: {returned_at, checks[], charges[], deposit_applied, payment?, deposit_refund?}` | `{status, total, paid, balance, deposit_held, warnings[]}` |

`checks[]`: one per unit, `{unit_id, condition ('good' | 'damaged' | 'lost'), odometer, fuel_level (0-8,
eighths of a tank), notes, photo_paths[]}`. Vehicles need `odometer` and `fuel_level` at both ends, and
at pickup the customer needs a valid licence on record and `id_verified: true` (unless the shop turned
`require_licence` off). `returned_at` cannot be in the future. Damaged units go to `maintenance`, lost
ones to `lost`. `charges[]`: `{type, amount, note}`; types: `late, extra_km, fuel, damage, lost,
cleaning, toll, parking, challan, alteration, extra_person, other`.

Show `return_suggestions` to the person and let them change the charges before `complete_rental`.

### Money
| Function | Who | Input |
| --- | --- | --- |
| `record_rental_payment` | everyone | `p_rental_id, p_kind ('payment' | 'deposit' | 'deposit_refund' | 'deposit_applied'), p_amount, p_method, p_note` |
| `add_rental_charge` | owner, manager | `p_rental_id, p_type, p_amount, p_note` (also after the return, e.g. a challan) |
| `admin_set_discount`, `admin_set_line_amount`, `admin_update_payment`, `admin_delete_payment`, `admin_delete_charge`, `admin_delete_rental` | owner | always with `p_reason` (logged) |

### Catalog, units, customers, other
| Function / table | Notes |
| --- | --- |
| `set_unit_status(p_unit_id, p_status, p_reason)` | `available, maintenance, alteration (feature), lost, retired`; returns bookings that now need another unit |
| `save_product(p)`, `save_set_items(p_product_id, p_items)`, `import_catalog(p)`, `delete_or_deactivate_product(p_product_id)` | Catalog editing (owner, manager); the web app is the better place for it |
| `customers` table | read, insert (with `shop_id`), update directly; `is_blocked` customers cannot book |
| `customer_measurements`, `appointments` tables | read and write directly when the feature is on (staff: own branch for appointments) |
| `mark_reminder_sent(p_rental_id, p_kind)` | after sending a WhatsApp reminder: `confirmation, pickup_reminder, return_reminder, receipt, overdue` |
| `dashboard_summary(p_from, p_to, p_branch_id)`, `inventory_status()` | owner, manager |

## 7. Photos

Handover photos go to the private storage bucket `rental_photos`, path
`<shop_id>/<rental_id>/<unit_id>-<pickup|return>-<timestamp>-<n>.jpg`. Upload first, then pass the paths
in `checks[].photo_paths`. Show them with `createSignedUrls(paths, 3600)`. Compress to about 1,400 px
before uploading. Product photos are public, in `product_images/<shop_id>/...`.

## 8. Live updates

Subscribe to Postgres changes on `rentals`, `payments`, `units` and `unit_reservations`; the database
only sends rows of the person's own shop. Re-read the screen's data (debounced, about 1.5 s) on a change.

## 9. Flows per business type

**Bridal and groom (wearable).** Pick date and time; items show `branch_availability`; quote; customer;
advance and deposit; `create_rental`. Optional: measurements, alteration (charge `alteration` +
`set_unit_status(..., 'alteration')`; the piece cannot go out until set back to `available`), fitting
appointment. Pickup: condition, notes, photos, the rest of the money, deposit. Return: condition per
piece, suggested late days and the penalty, damage or lost charges, keep or return the deposit. The
piece is free again after its cleaning time.

**Resort (room).** Check-in and check-out use the shop's usual times. Guests: `adults`, `children`
(above the rooms' included guests the extra-person rate applies; more than the maximum is refused).
Meal plans and extra beds are extras. Whole property: `whole_property: true`. Check-in records the room's
condition; check-out suggests late check-out hours; housekeeping time follows.

**Car (vehicle).** Hours and days (leftover hours never cost more than a day), optional driver
(`with_driver`, feature), extras like a child seat. Pickup needs the licence on the customer record,
`id_verified`, odometer and fuel. Return: odometer and fuel; suggestions add late hours, the penalty and
km above the free km per day; add fuel, toll, parking or challan charges as agreed. A challan that
arrives weeks later: `add_rental_charge`.

**Bike (vehicle).** As a car, without the driver option; shorter service time.

## 10. Rules the app must follow

- Never write `rentals`, `rental_lines`, `unit_reservations`, `payments` or `rental_charges` directly
  (the database refuses); always use the functions.
- Show the database's numbers (`total`, `paid`, balance, deposit held), never your own arithmetic.
- Show times in `shop.timezone`, and send instants with a time zone.
- Treat every error message as user-facing text.
- Page every list; never assume one request returns everything.
- Keep the anon key in the app config, the session in the platform's secure storage.

## 11. Test accounts

Local and staging demo data: one shop per business type plus a Zypher admin. The logins and the shared
demo password are at the top of `supabase/seed.sql` (local and staging only, never production).

| Login | Role | Shop |
| --- | --- | --- |
| owner@bridal.test, manager@bridal.test, staff@bridal.test | owner, manager, staff | Kalyani Bridal (2 branches; sets, measurements, alterations and appointments can be switched on) |
| owner@groom.test, staff@groom.test | owner, staff | Raja Groom Wear |
| owner@resort.test, staff@resort.test | owner, staff | Green Valley Resort |
| owner@car.test, staff@car.test | owner, staff | Kochi Drive Cars |
| owner@bike.test, staff@bike.test | owner, staff | Munnar Bike Rentals |

## 12. Suggested scope for app v1

The counter's daily work, where a phone helps most: Today (due handovers and returns, reminders),
search and scan a tag, new booking, booking page with handover and return (camera for photos),
customers, calendar. Leave catalog editing, money reports, staff and settings to the web app at first.
