# TEST STATUS

Last updated: 2026-10-21. Branch: `fix/phase1-4-findings`.
Plain-English list of what has been tested, what has not, and what must be decided first.
Detailed history is in QA_LOG.md. Test logins live in `.env.test` (not in git).

## 1. How to run the tests
- All tests: `npx playwright test --reporter=line` (starts the app itself, needs `.env.local` and `.env.test`).
- Typecheck: `npx tsc --noEmit`. Lint: `npm run lint`. Build: `npm run build`.
- Tests that write data use `QA-` names/SKUs and must be cleaned up afterwards. The database is currently EMPTY
  except profiles (9), logins (9) and branches (2).

## 2. Done so far
| # | Test | Result | Where |
|---|------|--------|-------|
| 1 | Admin, owner, manager and staff can log in and open Bookings, All Rentals, All Products with no refused database calls | PASSED (2026-10-18, after the hardening and structure migrations) | `tests/roles-smoke.spec.ts` |
| 2 | Full money flow: booking (discount 500, advance 1000, deposit 2000) -> wrong pickup amount refused -> pickup 2500 -> return (fees 300 taken from deposit, refund 1700, one unit damaged) | PASSED | `tests/full-flow.spec.ts` |
| 3 | Ledger matches hand calculation: advance 1000, deposit 2000, payment 2500, retained 300, refunded 1700; cash in minus refund = 3800 = final rental total; deposit held = 0 | PASSED | same |
| 4 | Rental is linked to its booking (`rentals.booking_id`) | PASSED | same |
| 5 | Damaged unit goes to maintenance, good unit becomes available | PASSED | same |
| 6 | Staff cannot read the ledger or payments | PASSED | same |
| 7 | Typecheck | PASSED (2026-10-18) | |
| 8 | Live database review: structure, keys, checks, row-level security, advisors, orphan data | DONE, fixes applied (migrations 11 and 12) | QA_LOG.md |

Earlier QA findings (S1-S28, FIN-1 to FIN-14, P2/P3) were fixed in previous passes; the list is in QA_LOG.md.

## 3. Not tested yet (needs a test)
### Money flows
- [ ] Booking cancellation: fee, refund of advance and deposit, ledger entries, unit released.
- [ ] Extend a rental (`extend_rental_atomic`): extra days, extra payment, availability clash.
- [ ] Partial payments: pay the balance in two steps, status moves unpaid -> partial -> paid.
- [ ] Record payment on an open rental (`record_rental_payment`): overpayment refused, whole paise only (e.g. 100.50 ok, 100.555 refused).
- [ ] Return with extra fees above the deposit (customer pays the rest) and with no deposit.
- [ ] Return with a lost unit: unit stays `lost`, cannot be booked again.
- [ ] Admin corrections: edit/delete payment, rental, booking (reason required, audit_log row, ledger adjustment).
- [ ] Reconciliation check: stored `rentals.advance` equals payments plus booking advance; ledger equals records.
- [ ] Dashboard figures equal an independent recomputation from raw rows (blocked: see section 4).

### Availability and inventory
- [ ] Same unit cannot be double-booked for overlapping dates; buffer days honoured.
- [ ] Same-day turnaround (new pickup on the previous return day) - currently still blocked, see section 4.
- [ ] Booking in the past is refused; return date before pickup is refused.
- [ ] Early pickup repricing (pickup earlier or later than booked).
- [ ] Product delete/deactivate (`delete_or_deactivate_product`) when units are booked.
- [ ] CSV import: good file, bad rows, duplicate SKUs, hostile content.
- [ ] Stock quantity always equals the number of units (currently matches; add a check).

### Roles, security and access
- [ ] Manager sees and changes only their own branch; staff cannot touch another branch.
- [ ] Staff cannot see finance pages, payments list, or call admin functions directly (API level).
- [ ] Anonymous user (no login) gets nothing from any table or function.
- [ ] New sign-ups start inactive and cannot read anything until activated (migration 11).
- [ ] Super-admin tools: staff management, branch management, activating a new account.
- [ ] Route gate: logged-out user is sent to /login; tampered cookie is rejected (S14).

### Screens (clicking through the real UI)
- [ ] Create product with variations and units; categories; stock locations.
- [ ] Create a booking in the booking form, pickup modal, return modal, payment modal.
- [ ] WhatsApp message text and PDF ledger/receipt show correct amounts and paise.
- [ ] QR / scan lookup page.
- [ ] Phone-size screens.
- [ ] Draft saving in the rental form.

### Other
- [ ] Two people booking the same unit at the same moment (concurrency).
- [ ] Performance with realistic volume (thousands of rentals) after the client starts.
- [ ] Backup and restore drill.
- [ ] Release checklist full flow (ROADMAP.md): booking, pickup, return, ledger and dashboard check, then manual click-through.

## 4. Waiting for your decision before testing
1. Dashboard definitions (Billed vs Collected, revenue, deposits held, outstanding): which date puts money in a period (booking, pickup or payment date)?
2. Same-day turnaround: allowed per CLAUDE.md, but the booking functions still block it. Needs a rewrite first, and a decision on what `buffer_days` means.
3. Duplicate payments: two identical partial payments both succeed. What rule do you want?
4. Booking-time payment method: the advance and deposit payment methods are not saved by `create_booking_atomic` (S13 interim fix only shows the error).
5. Ledger columns have no foreign keys to bookings/rentals/payments (history survives deleting a record, but orphans can appear).

## 5. Go-live gate (before the client enters real data)
- [ ] Rotate or remove the 4 test accounts (weak passwords; old ones are in git history).
- [ ] Turn on leaked-password protection in the Supabase dashboard (Auth settings).
- [ ] Drop the unused old functions `deduct_stock_on_rental`, `restore_stock_on_return`, `return_rental_atomic` after review (FIN-13).
- [ ] Confirm no real customer data was in the removed `qa_report_data.json` (still in git history, S18).
- [ ] Take a manual export/backup; create the staging project and move testing there.
- [ ] Remove `tests/` dependence on live data: point Playwright at staging once it exists.

## 6. Notes for next time
- Tests that create data must clean up with a scoped delete. Deleting a payment makes the ledger add a reversal row; remove it too.
- The delete guard on records only blocks API users, so cleanup runs as the database owner (through Claude's database tool), not through the app.
- Before any new test run, check the database is still empty (row counts) so results are not mixed with old data.
