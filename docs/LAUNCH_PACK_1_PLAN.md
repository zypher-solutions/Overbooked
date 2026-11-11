# Launch pack 1 plan: built on top of what exists

Written 11 Nov 2026. Replaces the build parts of the earlier launch pack (written before migration 036). **Nothing is
built yet. Waiting for the owner's approval** (`CLAUDE.md`: plan first).

## Ground rules for this pack
1. **Add, do not replace.** Existing functions keep their names, inputs and results. Existing screens keep their
   buttons and fields. New behaviour is switched on by a new setting or a new record (a job, a credit note, a void).
2. **Every new setting starts at today's behaviour** for existing shops, so nothing changes until the owner changes it.
3. **Support logins and Zypher visits are not touched.** No change to migrations 032, 033, 036, `is_support()`,
   `current_shop_id()`, `get_my_role()`, `update_my_shop`'s role check, the console or `ShopContext`. New functions reuse
   the existing guards (`_require_role`, `_require_correction`), so support is treated exactly like the matching
   existing action is today.
4. Migrations start at **037**. One branch per step. Each step: migration, database tests (incl. `activity.test.sql`),
   Playwright flow, phone-width check, activity-log entries, docs. Before applying to the shared project I ask how.

## The features I will build

### A. Shop settings: new sections (foundation)
| # | Feature | How it blends in |
|---|---|---|
| A1 | Settings tabs on Branch management: **Shop details, Receipts & tax, Late returns, Staff controls** | Same page, same menu item, same fields; Branches panel stays on top as today. Each tab has its own Save |
| A2 | New setting keys accepted by `update_my_shop` | Only the allowed-keys list grows; the function's role check and behaviour stay |
| A3 | `_shop_rule(key, default)` helper | New, read-only |
| A4 | Settings changes in the activity log | Already automatic (`_act_shops` loops over keys); add masking for the bank last-4 and readable labels |

### B. Late fees and late returns (Late returns tab)
| # | Feature | How it blends in |
|---|---|---|
| B1 | Late-fee mode: **% of the piece's daily price** or **fixed ₹ per piece per day** | Default = today's formula (catalogue day rate × 100% × days late) |
| B2 | Daily price basis: agreed price (line amount / days) or catalogue rate | Default = catalogue rate (today) |
| B3 | Grace on the return day (until a clock time), count calendar days or 24-hour blocks | Default = no grace, calendar days (today) |
| B4 | Optional maximum fee (% of rent or replacement value) | Default = no cap (today) |
| B5 | Existing per-product `late_penalty` stays as an extra flat penalty, and a product may override the daily late rate | Existing rate type kept as it works now |
| B6 | Late rules copied onto each new booking (`rentals.late_terms`) | Bookings made before this have none and keep today's formula |
| B7 | Return screen shows the working ("2 days late × ₹800 = ₹1,600") | Still a suggestion; staff confirm or change it as today |
| B8 | Late piece vs its next booking: warning on the booking, on Active rentals and its "Due back today & overdue" list, with swap offer (`swap_unit`) and "hold the next hand over" with a note | Today's warning text stays; this adds the actions |
| B9 | Live example in settings ("₹1,000/day suit, 2 days late = ₹2,000") | New |
| B10 | Clothing shops get the Late returns tab; other types keep their Rules panel | Rules panel unchanged |

### C. Staff controls and voiding payments (Staff controls tab)
| # | Feature | How it blends in |
|---|---|---|
| C1 | Max discount without the owner: staff % and manager % | Default = no limit (today); screen says "not set" |
| C2 | Who may void a payment: owner / owner and manager | Default = owner (same as today's corrections) |
| C3 | Who may waive or reduce a suggested late fee at return | Default = everyone (today) |
| C4 | Who may cancel a booking that has payments (cancelling refunds) | Default = everyone (today) |
| C5 | Who may give a deposit back early | Default = owner (today) |
| C6 | Back-dated return limit: 2 / 6 / 24 hours | Default = 2 hours (today) |
| C7 | Rules enforced in the database (`_require_rule_role`), with a clear message | New helper; with defaults it allows exactly what is allowed today |
| C8 | **Void a payment**: `void_payment(id, reason)`; the payment stays visible, struck through, with the reason | New columns on `payments`; money totals, Finance and dashboard leave voided rows out |
| C9 | "Void and enter the correct payment" in one dialog | New dialog next to the existing correction buttons |
| C10 | Activity filter chip "Money changes"; voids and waivers marked important | Activity log screen gets one filter |

### D. Invoices, receipts and credit notes (Receipts & tax tab)
| # | Feature | How it blends in |
|---|---|---|
| D1 | Invoice timing setting: **after return** or **at booking** | Default = after return (today's migration 025) for existing shops; at booking for new clothing shops |
| D2 | **Issue tax invoice** button on the booking page | Uses the existing `issue_invoice` and number format `PREFIX/2627/0001` |
| D3 | At-booking mode: invoice on a confirmed booking, then a **supplementary bill** at return for late fee, damage, extension | New document, own counter |
| D4 | **Credit note** (`CN/2627/0001`) with a reason, for a cancellation or a correction after the invoice | New table `credit_notes`, counter via existing `next_shop_counter` |
| D5 | **Payment receipt** per payment row (advance, deposit, balance), own number | New, printable |
| D6 | Clothing bill layout from the reference template: customer box, bill no/date, bank details, items table, totals box (Total → Taxable → Disc → CGST/SGST → Bill Amount → Advance → Payable), deposit outside the tax box, booking number as "ref", GSTIN bottom left, two decimals | In `src/modules/clothing`; other business types keep the shared print layout |
| D7 | Editable terms (about 600 characters), clothing defaults pre-filled; the late-fee line is generated from the Late returns setting | Existing receipt note kept and shown as today |
| D8 | "Advance is kept when a booking is cancelled" setting | Default off (today); feeds the existing cancellation fee |
| D9 | Bank details (optional, record only): bank name, account holder, **last 4 digits only**, IFSC | New settings keys; prints "A/C: XXXX1234" |

### E. Cleaning & repairs (one new page, Inventory menu)
| # | Feature | How it blends in |
|---|---|---|
| E1 | **Service job** per piece: cleaning, alteration, repair, other; vendor, sent, due, cost, photos, outcome | New table `service_jobs` |
| E2 | Page with tabs To do, Away, Ready, History; one-tap Send out, Mark back, Done; filters; overdue in red; menu count badge | New page; nav item added to `nav.ts` |
| E3 | Auto cleaning job on every return (setting, on by default) | Job sits inside the existing cleaning-days buffer, so availability does not change |
| E4 | Repair job when a piece is returned damaged | Existing "set unit to maintenance" still happens as today |
| E5 | Existing Alteration dialog also creates an alteration job | Dialog, its charge and the `alterations` switch stay as they are |
| E6 | "Send for cleaning / repair" from Inventory search and the piece | New button |
| E7 | **Time-boxed hold**: an open repair or alteration job blocks the piece only from sent to due date | Availability functions skip a piece only while it has an open job; with no jobs they return exactly what they return today |
| E8 | Late back from the cleaner: list clashing bookings with a swap suggestion | Reuses `set_unit_status`'s upcoming-rentals list and `swap_unit` |
| E9 | Completing a job with a cost creates the expense | Uses existing `add_expense` and categories |
| E10 | Dashboard card "At the cleaner / tailor: n, overdue: n" | One card added |
| E11 | Activity log: area "Cleaning and repairs", trigger and sentences | Extends the CHECK from migration 035 and labels in `ActivityLog.tsx` |
| E12 | Pieces already in `maintenance` stay as they are | No data migration; `set_unit_status` unchanged |

## Places where the earlier pack would change existing behaviour (need your OK)
These are the only points where "do not change existing" and the owner's decisions collide. My recommendation first.

1. **Print page issues the invoice when opened (today).** Recommend: printing stops issuing; the new button issues.
   Alternative: keep issuing on print in after-return mode, button only in at-booking mode.
2. **Money corrections after an invoice (today allowed).** Recommend: blocked once a booking has an invoice number,
   with "Issue a credit note" instead. Alternative: allowed, but a credit note is created automatically.
3. **Deleting a payment (today a hard delete).** Recommend: keep the function, show **Void** in place of Delete in the
   app. Alternative: keep Delete and add Void beside it.
4. **SAC code optional (today).** Recommend: stays optional in settings; only the "Issue tax invoice" button asks for it.
5. **Alteration feature switch (today Zypher-controlled).** Recommend: cleaning and repair jobs for every clothing shop,
   alteration jobs still follow the existing `alterations` switch.

## Not in this pack
Customer GSTIN and place of supply, stored PDFs, sending invoices on WhatsApp, owner approval requests for over-limit
actions, daily alert summaries, partial returns, any change to support or Zypher access.

## Build order
1. A (settings foundation) → B (late fees). 2. C (staff controls, void). 3. D (invoices; needs C for corrections).
4. E can start after A, in parallel (different files). Accountant questions (GST on a kept advance, discount before tax,
time of supply for a bill at booking, supplementary bills, SAC) change wording and defaults only.
