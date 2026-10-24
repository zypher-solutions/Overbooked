# QA_LOG

## Phase 1-4 fix pass (2026-10-18, branch fix/phase1-4-findings)
Source of findings: QA_REPORT.md / QA_LOG.md in git history (`git show 9aef6f4^:QA_REPORT.md`).
Already fixed before this pass: S1, S3, S4-S11, S15, S16, S21, S22, S23, S26, S28, FIN-1, FIN-4, FIN-7, FIN-9, FIN-12, FIN-14, P2-1, P2-2, P3-2.

### Fixed in this pass
S13, S14, S17, FIN-8, FIN-11, lint tooling (code). S24 and P3-1 (migration written, NOT APPLIED).

### Needs human decision (not changed, conservative behaviour kept)
1. **Same-day turnaround** (CLAUDE.md: ALLOWED, code and DB still block it). Needs a rewrite of the overlap checks in create_booking_atomic, extend_rental_atomic, check_availability (live-only body) and availability.ts, and a decision on what buffer_days means once same day is allowed. Re-export qa/live-schema first.
2. **Dashboard figures** (FIN-2, FIN-3, FIN-5, FIN-6): split into Collected (by payment date) and Earned (by rental date), add Deposits held / refunded. Definitions are agreed in "Decision 9"; CLAUDE.md asks for your confirmation before shipping dashboard changes.
3. **FIN-10 payment idempotency**: two identical partial payments both succeed. Needs a rule (e.g. idempotency key or duplicate-within-N-seconds warning).
4. **S13 full fix**: pass the payment methods into create_booking_atomic (needs a function rewrite). Interim: error is now surfaced.

### Go-live blockers (yours)
- Rotate or remove the 4 test accounts; passwords from the removed .cjs scripts are in git history (S2).
- FIN-13: orphan live functions (deduct_stock_on_rental, restore_stock_on_return, return_rental_atomic) still exist; drop after you review them.
- S18: confirm no real customer data was in the removed qa_report_data.json (it is still in history).

## 2026-10-18 DB structure review and ledger cleanup
- Review: live schema checked (tables, keys, checks, RLS, advisors). Applied migrations 11 (hardening) and 12 (structure cleanup).
- Ledger cleanup (owner approved): 1,028 ledger entries (sum 1,389,459.50) pointed to bookings/rentals that no longer exist (leftover QA data, see audit_log deletes). Backed up to `public.ledger_entries_orphans_backup_20261018` (RLS on, no policies), then deleted. Ledger now 36 rows, 0 orphans.
- Stock decision (owner): individual units (`inventory_items`) stay tracked and are the real record. `product_stock.quantity` matches the unit count for every row today; keep it that way.
- Open: ledger columns booking_id/rental_id/payment_id have no foreign key (deleting a booking leaves its ledger history). Leaked-password protection is off (owner will enable later).

## 2026-10-18 Live data wipe (owner instruction)
- Emptied (TRUNCATE): products, product_variations, product_stock, inventory_items, categories, customers, bookings, booking_items, booking_item_inventory, rentals, rental_items, rental_item_inventory, payments, ledger_entries, audit_log, and the temporary ledger backup table (dropped).
- Kept untouched: profiles (9), auth users (9), branches (2; profiles point to them).
- Verified: policies 54, triggers 35, constraints 96, indexes 75 before and after. No backup of the wiped dummy data was taken (owner choice; dummy data only).
- Product images in Supabase Storage, if any, were not touched.
- Go-live gate item "remove QA rows / dummy data" is now done for the database.

## 2026-10-18 Full-flow test (tests/full-flow.spec.ts)
- booking (discount 500, advance 1000, deposit 2000) -> wrong pickup amount refused -> pickup 2500 -> return (fees 300 from deposit, refund 1700, one unit damaged) -> ledger kinds and sums match the hand calculation; cash in minus refund = 3800 = final rental total; deposit held = 0; rentals.booking_id set; damaged unit -> maintenance; staff sees no ledger or payments. PASSED.
- QA- rows removed afterwards (scoped by QA- customer / QAF- SKUs). Note: deleting a payment makes the ledger trigger add an adjustment_out row, removed by hand. DB back to empty (profiles 9, branches 2 kept).
- Not covered: UI clicks, cancellation, extension, partial payments, concurrency.
