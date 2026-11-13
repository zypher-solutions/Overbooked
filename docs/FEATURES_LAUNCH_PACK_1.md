# Launch pack 1: invoices, late-fee rules, void and staff controls, cleaning and repairs

Written 11 Nov 2026 after reading the code and clicking through the owner login (ZEEZ RENTAL). **Status: the owner's decisions are recorded
(section 9a) and the document is ready for the partner's review. Nothing here is built.** Follows the rule "plan first, wait for approval" in `CLAUDE.md`.

## 1. What I looked at
- Migrations 002, 006, 007, 012, 016, 022, 025, 034, the print page `src/app/print/rental/[id]/page.tsx`, the booking page
  `src/app/(shop)/rentals/[id]/page.tsx`, `RentalDialogs.tsx`, `UnitsPanel.tsx`, `branches/page.tsx` (shop settings),
  `src/modules/clothing/nav.ts`.
- In the browser as owner: Branch management, Bookings, one booking (`ZR-2026-0001`, booked, not handed over).
- **Not exercised:** a hand over, a return, a payment edit. I did not write to the shared project. Every statement about
  returns and corrections comes from reading the functions, not from running them.

## 2. Summary of the answer to "new page or existing pages?"

| # | Feature | Where it lives | New page? |
|---|---|---|---|
| 1 | Tax invoice and receipt | Booking page (Invoice button) + the existing print page; tax fields stay in shop settings | No |
| 2 | Late-fee and late-return rules | Shop settings, new "Late returns" section | No |
| 3 | Void a payment, staff controls | Voiding on the booking page (owner); the rules in shop settings, new "Staff controls" section | No |
| 4 | Cleaning, alteration, repair | New page "Cleaning & repairs" under Inventory, plus small hooks in return, booking and scan | **Yes, one** |

Only feature 4 needs a page, because it is a work queue ("what is at the cleaner today?") and no existing page is
about pieces that are away. Shop settings gets longer, so it should be split into tabs (section 7).

## 3. Feature 1: proper tax invoice and receipt

### What exists today
- Migration 025: a shop with a GSTIN and a GST % gets a **tax invoice** (`PREFIX/2627/0001`, financial year, counter per
  shop, fixed once issued) after the rental is returned. Others get a plain **receipt**. Cancelled bookings get a
  "Cancellation receipt". CGST/SGST split of an inclusive price is printed. Settings: GSTIN, GST %, SAC, receipt note.
- The print page calls `issue_invoice` **just by opening the page** when the rental is completed.

### Gaps found
1. **The number is assigned by a page view.** Any role opening Print on a returned booking issues the invoice. Printing
   should be reading; issuing should be a button.
2. **An issued invoice can still change.** `admin_set_discount`, `admin_set_line_amount`, `admin_delete_charge` and
   the payment corrections have no check on invoice status. After a correction the same invoice number prints
   different totals. The legal fix is a **credit note** (or a revised invoice), never a silent change.
3. **One document per booking, no per-payment receipt.** A customer who pays an advance or a deposit gets nothing
   numbered. Shops hand these out daily.
4. **SAC is optional** even when GST is on. A tax invoice without it is incomplete.
5. **No invoice for a cancellation fee**, only a receipt. Whether that fee is taxable is an accountant question.
6. **Print only.** No stored PDF, no "send invoice by WhatsApp" (the WhatsApp dialog has a receipt text only).
7. The customer's GSTIN and place of supply are not captured. Fine for consumers; blocks business customers.

### Proposal
- **Booking page:** an **Invoice** button. If GST is on and no invoice exists: "Issue tax invoice" (confirm, then
  number assigned). Afterwards: "View / print invoice". It appears on a confirmed booking (mode "at booking", the
  default) or on a returned one (mode "after return"); the mode is a shop setting (decision 4). In "at booking" mode
  charges added later are billed on a **supplementary bill** at return. Print page becomes read only and shows the
  issued number.
- **Lock:** once `invoice_no` is set, money corrections on that booking are blocked in the database and the dialog
  says "Issue a credit note". A **credit note** is a second numbered document (`CN/2627/0001`) with a reason, linked to
  the invoice, printed like it. Table `credit_notes` or two columns pair; counter via `next_shop_counter(..., 'credit_note', fy)`.
- **Payment receipt:** every payment row gets a **Receipt** link (print one page: number, amount, method, date, what
  it is for). Number from its own counter. Also printable for deposits.
- **SAC mandatory** in settings when GST % is above 0.
- Cancellation fee: keep the receipt until the accountant decides (question Q4).
- Later, not in this pack: stored PDF, WhatsApp link, customer GSTIN.

### Rules / invariants (for tests)
Invoice numbers never repeat or skip within a shop and year; an invoice's total equals the booking total at issue;
a credit note cannot exceed the invoice; an issued invoice cannot be edited in place.

### Activity log
`credit_notes` (and any receipt table) get a trigger and `_act_*` function; sentence like "Issued tax invoice
ZR/2627/0004 for KAL-2026-0004". Issuing is a named event (level 2).

### 3a. Reference template (supplied by the owner, 11 Nov 2026)
A bill from a real clothing shop, "the normal template", is the model for the clothing invoice. Sample data in it is
dummy; only the layout and the rules it shows matter.

**Layout, top to bottom (A4, boxed grid):** logo, shop name, address, two phone numbers; a customer box (name,
address, mobile) beside bill date and bill number and the shop's bank details (bank, IFSC, account no.); an items table
(No., Description with qty, Delivery, Return, Rent, Discount, Total Rent) with the body kept tall so the page looks
full; GSTIN and a small "ref" at bottom left; a totals box; four to five terms lines.

**Totals box, in this order:** Total Amount (500) -> Taxable Rent (424) -> Disc (-) -> Total Taxable Amt (424) ->
CGST 9% (38) -> SGST 9% (38) -> **Bill Amount (500)** -> **Advance (-)** -> **Payable Amt**. The rent column shows the
taxable value of the line (500 / 1.18 = 423.73).

| Template element | Our data today | Needed |
|---|---|---|
| Shop name, logo, address, phones | `shops`, branch phone | Second phone is optional |
| Customer name, address, mobile | `customers` | Alternate mobile only if the customer record has one (to verify) |
| Bill no. and date | `invoice_no`, `invoice_date` (`PREFIX/2627/0001`) | Keep ours (financial year, consecutive, at most 16 characters). The sample's plain "248" is also valid |
| Bank name, IFSC, A/C no. | not stored | **New optional shop settings** (Receipts & tax tab), **for record only and concealed**: bank name, account holder (optional), **last 4 digits** of the account, IFSC (optional). The full number is never asked or stored; the field accepts 4 digits only. Prints as "A/C: XXXX1234". Changes are logged with the same masking (`_act_mask`) |
| Per-line Delivery and Return | booking has one pickup and one return | Print the booking's dates on every row |
| Rent column (taxable value per line) | line `amount` (GST included) | Compute taxable value per line (amount / (1 + rate)) |
| Per-line Discount | one discount per booking | Show the discount in the totals only, or spread it over lines for display (last line takes the rounding rest). I recommend totals only |
| Taxable Rent, Total Taxable, CGST, SGST | `inclusiveTaxBreakdown` | Re-order into the template's box; discount shown ex-GST (discount / (1 + rate)). Accountant to confirm (Q4) |
| Bill Amount, Advance, Payable | Total, Paid, Balance due | Rename on the bill: Advance = payments so far, Payable = balance |
| Security deposit | printed as a sentence | Keep it **outside** the tax box as "Security deposit (refundable)"; never part of Payable |
| "ref: HK-01" | booking token (`ZR-2026-0001`) | **Decided:** in that software "ref" is the clothing article; in ours it prints the **booking number** (small, bottom left) |
| Terms lines | one 200-character receipt note | **Editable terms** (several lines, about 600 characters), pre-filled with the clothing defaults below |
| GSTIN | printed under the address | Also print at bottom left, as in the template |
| Money rounding | the sample shows 424 + 38 + 38 = 500 but the line shows 423.73 | Print two decimals everywhere so every figure adds up exactly |

**The terms in the sample map onto our settings:**
- "Double fare for those who return it late" is the late-fee rule. With Feature 2's **% of agreed daily price** mode this
  is **200%**. The bill's late line is **generated from the shop's late-fee setting** (and the snapshot on the booking),
  so the printed terms can never disagree with what the return screen charges.
- "Orders will not be cancelled; if you cancel, the advance is not refunded" is a cancellation policy. **Decided:** a
  shop setting, "Advance is kept when a booking is cancelled" (off or on; feeds the existing cancellation fee, and the
  printed line appears only when it is on). Ties to accountant Q4.
- "Bring the fare and deposit", "damage is charged separately", "check the piece at delivery": plain editable text.

**Print behaviour:** table header repeats if items run to a second page and the totals sit on the last page. This is the
**clothing module's** layout (`src/modules/clothing`); other business types keep the shared layout until they get their
own, so modules still never import each other. The same header and grid are reused for the credit note and the payment
receipt.

**Conflict with decision 4 (reopened).** The sample is dated **06/11/2026 for a delivery on 16/12/2026**: the shop
raises the bill **at booking**, with an Advance and a Payable line, and treats damage and late fees as separate
charges. Our built invoice (migration 025) and decision 4 issue it **after the return**. See "Final thoughts" below
and decision 4 in section 9a.

## 4. Feature 2: late-fee and late-return rules in shop settings

### What exists today
- Late fee for clothes is **hard-coded** in `return_suggestions`: `qty x line.rate x days late`, calendar days, no grace,
  no cap. `line.rate` is the catalogue rate snapshot, so a **negotiated** price (`is_override`) is ignored.
  This is your open question 3 ("agreed price or catalogue rate").
- A flat per-variation `late_penalty` rate is added once if the piece is late (set in the product).
- `grace_minutes` exists, but only for hourly and nightly lines, and the shop settings "Rules" panel that holds it is
  **hidden for clothing shops**.
- Staff can change or remove the suggested charge at return; there is no rule about who may waive it.
- A late piece keeps its reservation `out`. If it clashes with the next booking, return only prints a warning
  ("came back late and overlaps its next booking"). Open question 2.

### Proposal: a "Late returns" section (owner only), stored in `shops.settings`
| Setting | Options | Default |
|---|---|---|
| Charge late fees | on / off | on |
| Fee is based on | agreed price per day (line amount / days) / catalogue day rate | **agreed price** (negotiated deals) |
| Fee per late day | % of the daily base (100%, 50%...) or fixed ₹ per piece per day | 100% |
| Grace on the return day | none / until a clock time (e.g. 8 pm) | until closing time |
| Extra flat penalty | ₹ once, after grace | 0 |
| Maximum fee | % of the rental amount, or the replacement value | no cap |
| Count days as | calendar days / 24-hour blocks | calendar days |
| Who may waive a suggested fee | owner / owner and manager (shares the Staff controls rule) | owner and manager |
| When a piece is overdue and the next booking is at risk | show warning on that booking and dashboard, offer swap | on |

- The Return dialog still **suggests**, staff confirm; the suggestion now follows these rules and shows the working
  ("2 days late x ₹800 = ₹1,600").
- **Snapshot at booking:** the rules in force are copied onto the rental (`rentals.late_terms jsonb`) so changing the
  setting never reprices existing bookings, and the print agreement can state the late terms.
- Settings panel shows a live example ("A ₹1,000/day suit returned 2 days late costs ₹2,000"). The reference shop's
  rule "double fare if returned late" is simply the % mode at **200%** (allowed range 0-300%).
- Database: whitelist new keys in `update_my_shop` (it rejects unknown keys), new helper `_shop_rule(key, default)`,
  `return_suggestions` reads it. **Validation:** percentages 0-300, amounts 0-10,000,000, grace times valid.
- Show the old "Rules" fields (grace, check-in/out times) only where relevant; clothing shops see "Late returns".

### Invariants
Fee is never negative; a fee never exceeds the cap; total = lines + add-ons + charges - discount still holds; the same
return suggested twice gives the same amount.

### Activity log
Settings changes are already logged ("shop settings"); add the new keys to the shop `_act_*` function with
`_act_change('Late fee per day', old, new)`. Waiving a fee: reason required, marked important.

## 5. Feature 3: void a wrong payment, staff misuse controls

### What exists today (read from the code)
- Owner only: `admin_update_payment` (change amount or method) and `admin_delete_payment` (**hard delete**), reason of
  at least 3 characters, kept in `audit_log` and the activity log. Support logins are blocked.
- Because it is a hard delete, the row is gone. Finance, receipts and the booking lose the history; only the log
  remembers. `payments` is also the source of every money total (`trg_payments_money`).
- Controls that already exist: refund of deposit before return is owner only; a return time older than 2 hours needs
  a manager (hard-coded); unblocking a customer needs a manager; price and discount changes are written to
  `price_changes`.
- **Not controlled:** how large a discount staff may give at booking (any amount up to the total), who may add or remove
  charges, who may cancel or refund. Not yet verified: the role checks inside `add_rental_charge` and `cancel_rental`
  (I only read their names). First task in the build is to read them.

### Proposal A: voiding (replaces the hard delete)
- `payments` gains `voided_at, voided_by, void_reason`. A voided payment **stays visible**, struck through with the
  reason; totals and Finance **exclude** it (the money trigger and the Finance/dashboard queries filter it).
- Function `void_payment(payment_id, reason)`, owner (or manager if the shop allows it). Reason mandatory.
- "Correct a payment" becomes **void and enter the right one** in one dialog, so the ledger only ever grows.
  `admin_delete_payment` is removed from the UI; `admin_update_payment` is kept only for a wrong payment method.
- Voiding is blocked if it would leave the deposit overdrawn (as today), and is allowed on an invoiced booking
  (invoices state value, not payments) but the printed "Paid" line changes.
- Voided refunds and deposits work the same way.

### Proposal B: "Staff controls" section in shop settings (owner only)
| Control | Options | Default |
|---|---|---|
| Maximum discount without the owner | staff: ___ % / manager: ___ % | staff 10%, manager 25% |
| Who may void or correct a payment | owner / owner and manager | owner |
| Who may remove a charge or waive a late fee | owner / owner and manager | owner and manager |
| Who may refund money or give back a deposit early | owner / owner and manager | owner |
| Who may cancel a booking that has payments | owner and manager / everyone | owner and manager |
| Back-dated return limit | 2 / 6 / 24 hours, needs manager | 2 hours (today's number) |
| Alert the owner on important actions | off / daily WhatsApp or email summary (later) | off |

- Enforced **in the database** (`_require_rule_role(rule_key)`), never only by hiding buttons.
- Over-limit attempt: clear message ("Discounts above 10% need the owner or a manager"). Phase 2: a request the owner
  approves from the activity screen; not in this pack.
- The existing **Activity log** (marked important for discounts, voids, waivers) is the audit trail; add a filter chip
  "Money changes" if missing.

### Invariants
Voided payments never count in `paid`; `paid <= total` and balance never negative still hold; a payment cannot be voided
twice; refund <= deposit held; staff cannot bypass limits by editing a price line (line price changes count as discount).

## 6. Feature 4: cleaning, alteration and repair tracking

### What exists today
- **"Cleaning" is only a time buffer.** `rentals.cleaning_days` (or the variation's turnaround) extends the piece's
  reservation after the return. Nothing records that the piece went to a cleaner, which one, when it is due, or what
  it cost.
- A damaged return sets the unit `status = 'maintenance'` with reason "Damaged on <booking>".
- **Alteration** (needs the Zypher switch `alterations`): a dialog on the booking can add an alteration charge and set
  the unit to `maintenance` with reason "Alteration: ...". `UnitsPanel` (manager and owner) can set maintenance by hand.
- Costs are only free-text expense categories ("Dry-cleaning and laundry", "Tailoring and alterations", "Repairs").
- Problems: one status for three different things; no history per piece; no due date; no list of pieces that are away;
  the piece comes back only if someone remembers to set it "available"; a flag blocks a piece for **all** future
  dates, not just the days it is away.

### Proposal: one new page, **Cleaning & repairs** (Inventory menu, with a count badge)
A **service job** per piece: `type` (cleaning, alteration, repair, other), `piece`, `reason`, `vendor` (free text,
remembered list), `sent_on`, `due_on`, `cost` (shop's cost, optional), `charge_to_customer` (links to the booking's
`alteration`/`damage`/`cleaning` charge), `linked_rental`, `photos` (optional), `status`, `done_on`, `outcome`.

Status flow: **To do -> Away (at cleaner/tailor) -> Back and checked -> Done.** Outcomes: ok; cannot be repaired
(then the existing lost/retired status).

- **Created automatically** when a piece is returned: a cleaning job if the shop's setting "send every returned piece
  to cleaning" is on (or the booking had cleaning days), and a repair job when the piece is returned damaged.
- **Created by hand** from the booking (existing Alteration dialog now creates a job), from Inventory search / piece
  detail ("Send for cleaning / repair"), or from this page.
- **Page layout:** tabs To do, Away, Ready, History; each row shows the piece code and photo, job type, due date
  (overdue in red), where it is, one-tap actions (Send out, Mark back, Done). Filter by branch, type, vendor. Mobile
  friendly: staff use it with a piece in hand, and scanning a tag opens its job (reuse `/scan`).
- **Dashboard:** one small card "At the cleaner / tailor: n, overdue: n". No other dashboard change.
- **Finance:** completing a job with a cost creates the matching expense (category already exists), so the shop's
  costs show up without double entry. Customer billing stays on the booking as a charge.

### The availability logic (needs a decision)
| Option | How | Verdict |
|---|---|---|
| A. Status flag only | job sets `units.status = maintenance` until done | Simple, but blocks every future date, which is wrong for a 2-day cleaning |
| B. Time-boxed hold | job has `[sent_on, due_on]`; availability functions (`available_units`, `find_available_units`, `branch_availability`, create/update rental) skip a piece during an open job's window; `start_rental` refuses a piece with an open job **now** | **Recommended.** Matches how reservations work; piece is bookable again after `due_on` |

- A cleaning job that sits inside the booking's cleaning buffer does **not** need to hold stock a second time (the
  buffer already does); repair and alteration jobs always hold.
- Late back from the cleaner extends the job ("still away"); bookings it now clashes with are listed with a swap
  suggestion (reuse `set_unit_status`'s "upcoming rentals to swap" and `swap_unit`).
- Existing `maintenance` units are migrated into open repair jobs so nothing is lost; `set_unit_status` keeps working for
  lost and retired.
- **Risk:** option B touches the availability functions that every booking uses. It needs the full database test suite and
  the Playwright booking tests before and after. I will count the places first.

### Roles
Staff: create jobs, send out, mark back. Manager and owner: edit cost, cancel a job, mark unrepairable. Alteration jobs
follow the shop's `alterations` switch if you still want it; cleaning and repair are available to all clothing shops (Q7).

### Activity log
New table `service_jobs`: trigger and `_act_service_jobs`, new `area` value ("Cleaning and repairs") in the
`activity_log` CHECK and a label in `ActivityLog.tsx`; sentences like "Sent lehenga WS-001-32 to Sharma Dry Cleaners,
due 14 Nov". Damage and unrepairable are important.

### Invariants
A piece has at most one open job at a time (or overlapping windows are refused); a piece with an open job now cannot be
handed over; availability never offers a piece during its job window; job cost >= 0; completing a job with outcome
unrepairable removes the piece from availability.

## 7. Shop settings gets longer: reorganise it
`Branch management` already holds Branches, Subscription, Shop details and Receipts. Adding two sections makes a long
scroll with one Save button for everything. Proposal: keep the page and the menu name, show branches on top, then
**tabs for the settings: Shop details | Receipts & tax | Late returns | Staff controls**, each with its own Save.
(Alternative: rename the menu item "Shop settings" and move branches onto its own tab. Q8.)

## 8. Build order
1. **Settings foundation:** tabs, the `update_my_shop` whitelist, `_shop_rule()` helper. Then **Feature 2** (late fees).
2. **Feature 3:** void and Staff controls (the role rules also guard waiving a late fee).
3. **Feature 1:** invoice lock, credit notes, receipts (needs 3, because corrections after an invoice use credit notes).
4. **Feature 4:** the largest; can start in parallel after step 1 because it touches different files (new page, new table,
   availability functions). Each step is its own branch and migrations `036` onwards.

Per step: migration(s), database tests (`supabase/tests`, including `activity.test.sql`), Playwright flow, phone-width check,
activity-log entries as `CLAUDE.md` requires, docs updated. Before applying any migration to the shared project I will
ask how you want it applied. Docker is used for the tests only.

## 9a. Decisions made (11 Nov 2026, by the owner)
1. **Late fee model:** the owner chooses in settings between a **fixed ₹ per piece per day** and a **% of that piece's agreed
   daily price**; a product may override with its own late rate; optional cap. (Replaces "agreed price vs catalogue rate":
   the % mode uses the agreed price.)
2. **Late piece vs next booking:** warn and offer a swap; if the customer refuses, staff can **hold the next hand over**
   with a note. Staff choose per case; shop settings sets the default.
3. **Discount limits:** the owner sets them in Staff controls (staff % and manager %, owner unlimited). No fixed default is
   imposed; until set, the shop keeps today's behaviour (no limit) and the settings screen says so.
4. **Invoice timing: DECIDED 11 Nov, both modes, chosen per shop in settings (Receipts & tax tab).** Issued by a button;
   printing never assigns a number.
   - **At booking** (matches the reference bill): the button is on a confirmed booking. Anything charged later (late fee,
     damage, extension) goes on an automatic **supplementary bill** at return; a cancellation gets a **credit note**.
   - **After return** (already built, migration 025): one invoice with the final amounts.
   - Default for new clothing shops: at booking. Changing the mode affects only bookings not yet billed.
   - Still needs the accountant's view (time of supply, supplementary bills).
5. **Auto cleaning:** on by default as a shop setting; every returned piece creates a cleaning job.
6. **Feature switch:** cleaning, repair and alteration are on for every clothing shop.
7. **Settings page:** tabs inside Branch management (Details, Receipts & tax, Late returns, Staff controls).
8. **Void or correct a payment:** owner only; the owner can widen it in Staff controls.
9. **Piece hold during repair or alteration:** time-boxed hold (option B).

10. **"ref" on the bill:** prints the booking number.
11. **Bank details:** optional, record only, concealed: bank name, account holder (optional), last 4 digits, IFSC
    (optional). Full account numbers and card details are never asked for or stored.
12. **Advance kept on cancellation:** a shop setting (not a fixed rule).

**Only open item:** question 4 below, the accountant's GST answers (tax on a forfeited advance or cancellation fee,
discount shown before tax, time of supply for a bill at booking, supplementary bills, SAC code). They affect the
wording and defaults of the bill, not the build, and can be settled while it is built.

## 9. Questions for you, the owner or the accountant (original list; 1-3 and 5-10 answered above)
1. **Late fee base:** agreed price per day, or catalogue rate? (I propose agreed price.)
2. **Late piece vs next booking:** a warning and a swap offer, or should a late piece block the next booking's handover?
3. **Staff discount limit:** what percentages? (10% staff, 25% manager proposed.)
4. **Accountant:** GST on a cancellation fee; receipt voucher for advances; SAC code for renting clothes; deadline for
   issuing an invoice after return.
5. **Invoice trigger:** issue by button after return (proposed) or automatically at return?
6. **Cleaning default:** should every returned piece create a cleaning job automatically?
7. **Alterations switch:** keep it Zypher-controlled, or make cleaning, alteration and repair available to every clothing shop?
8. **Settings page:** tabs inside Branch management (proposed), or a separate "Shop settings" menu item?
9. **Voiding by managers:** owner only (proposed) or owner and manager?
10. **Time-boxed holds (option B):** approve the extra work and risk, or start with the status flag (A) and upgrade later?

## 9b. Final thoughts (after the reference template)
1. **The template is close to what we have.** The data for almost every box already exists. The real changes are
   three: *when* the bill is issued, the *totals box* (Bill Amount, Advance, Payable), and *editable terms plus bank
   details*. It is a layout and rules job, not a rebuild.
2. **Timing is the one decision that changes the design.** A bill at booking is what shops expect and hand over with the
   advance, but the amounts are not final: extensions, late fees and damage come later. That is why I recommend the
   supplementary bill, the lock after issue, and credit notes for cancellation. Auto-issuing at booking creation is
   not recommended: bookings are edited and cancelled, and every change would need a credit note. Issue by a button
   when the booking is confirmed.
3. **Make the printed terms follow the settings**, not free text. The late-fee line comes from Feature 2, so the paper
   and the return screen can never disagree. That protects the shop in a dispute.
4. **Keep paise on the bill.** The sample's rounded totals hide a mismatch; two decimals make every figure add up.
5. **Keep the deposit out of the tax box.** It is refundable and not income; it prints as its own line.
6. **Bank details are optional, for record only: bank name and the last 4 digits.** Nothing sensitive is stored.
7. **Scope.** This is the clothing layout only. Print layouts for other business types come with their modules.
8. **Needs an accountant before launch:** tax on a forfeited advance or cancellation fee, whether a discount is shown
   before tax, bill-at-booking versus the time-of-supply rules, and supplementary bills.

The four questions raised by the template are all answered (9a items 4, 10, 11, 12).

## 10. Not in this pack
Partial returns (`PARTIAL_RETURNS_DESIGN.md`), automatic reminders, online payments, data export, stored invoice PDFs,
owner approval requests for over-limit actions.
