# Phase 4 report

## Owner decisions (section A)
1. Category with products: keep the current block. No change.
2. Category "inactive" status: not added (no migration).
3. DB RESTRICT on `products.category_id`: migration written, **applied to the test project on 2026-10-22 with owner approval; not applied to production**: `supabase/migrations/20261022000001_products_category_restrict.sql`. Before: `ON DELETE SET NULL`; verified live as `ON DELETE RESTRICT` after applying. The app guard in `Categories.tsx` / `store.tsx` stays as the friendly message.
4. Branch delete with staff assigned: now blocked. `BranchManagement.tsx` `doDelete` counts `profiles` with that `branch_id` and shows "reassign them first, or deactivate the branch instead". The existing FK-violation message for operational data is unchanged.

## Section C
- **Placeholder 400:** `placehold.co` returns SVG by default and `next/image` refuses SVG. The fallback URLs now ask for PNG (`.../888888/png?text=No+Image`) in `store.tsx` (2) and `Dashboard.tsx` (3). `next.config.mjs` unchanged (the host was already allowed). Only `RentalFormModal.tsx` uses `next/image`.
- **AllProducts `onOpen`:** unused by design; product cards have explicit Edit/Delete buttons and `onOpen` opens a rental status modal that does not apply to products. Nothing changed.
- **`.claude/settings.local.json`:** the only mention is an allowed grep command, not code. Untracked, left alone.
- **Security review of `d1e3472` / `6efa4b8`:** not run here; still pending on push.

## Section D
ROADMAP.md holds only the template and the go-live gate (test-account passwords, QA data removal, backups, schema export, RLS re-check, script credentials, finance labels, staging). Those are owner/ops tasks, not code, so none were done. Phase reports 1 to 3 list no other open U-/S- code items. Still open from Phase 3: refetch has no abort for an in-flight request.

## Checks
`npx tsc --noEmit` clean. `npm run lint`: 0 errors, same 5 warnings. `npm run build` succeeds.

## Not tested (section B, needs super_admin)
Not browser-tested at all, including the new branch-delete block. Screens to click as super_admin:
1. Branches: delete a branch that has a staff member (expect the block toast); delete an empty branch (expect confirm dialog, then success); Cancel path.
2. Admin tools on a rental: delete payment, delete rental, delete booking. Dialog sits on another dialog; check focus and Esc.
3. Products: delete a product with rental history, press Confirm (expect deactivated, not removed).
4. Error pages: temporarily throw in a page component in dev, confirm `error.tsx` shows Try again; throw in the root layout for `global-error.tsx`. Revert after.
5. Refetch throttle: switch tabs away and back several times within 30 s; the network tab should show one fetch.
6. Offline banner: browser devtools Network > Offline, then back online; banner appears and clears and data refetches.
7. Check the placeholder: open New Rental with a product that has no image; no 400 in the console.
8. After the migration is approved and applied (test project only): deleting a category with products should fail at the database.

## Browser tests added after the first report (super_admin, test data)
- Branch delete with staff assigned (Kalpetta, Sulthan Bathery): Confirm shows the "reassign them first" toast; both branches and all staff unchanged (checked in the database). Not tested: deleting an empty branch (no empty branch exists; none was created).
- Category delete with a product: app message shown; a direct SQL delete is refused by `products_category_id_fkey` (RESTRICT), data unchanged.
- Found and fixed: the confirm dialog text flashed `delete "undefined"?` while fading out, because callers clear their target on close. `ConfirmDialog.tsx` now keeps the last message. Re-checked in the browser. `tsc` clean, lint 0 errors / 5 warnings.
- Flash before the deactivated notice: fixed. `AuthContext.tsx` hides the app until the sign-in check finishes and while the notice shows. Re-tested with `staff@overbooked.com` on an inactive branch: the app shell never appeared, only the notice.

## Section B results (super_admin, test data, localhost)
- **Booking delete** (`BookingDetailModal` + `AdminBookingDelete`): empty reason is refused with a toast; with a reason, the confirm opens on top of the detail modal, focus lands on Cancel, Esc closes only the confirm and the reason text is kept.
- **Rental admin tools** (modal on modal): same behaviour for Delete rental and Delete payment; Cancel leaves the data unchanged (1 rental, 1 payment, 0 audit rows). **Bug found and fixed:** with an empty reason the confirm dialog still opened, and the "reason required" error only came after pressing Confirm. `AdminTools.tsx` now checks the reason first (`reasonFirst`). Re-tested.
- **Final Confirm run on payment, rental and booking delete (owner approved, test project):** all three succeeded with their toasts. The 1 payment, 1 rental (with its item) and 1 booking (with its items) are gone, each delete wrote an audit row with the reason, and Bookings shows 0.
- **FINDING (high): deleting a rental or booking leaves its money in the ledger.** `admin_delete_payment` writes a reversing `adjustment_out` ledger entry (the ledger went 5 to 6 rows, correct). `admin_delete_rental` and `admin_delete_booking` delete the records but write no reversal, so after all three deletes `ledger_entries` still holds `advance_in 1000`, `deposit_in 2000`, `deposit_retained 300`, `deposit_refund_out 1700`, and `v_collected_monthly` still reports **collected = 1,300** for Kalpetta in Oct 2026 with no booking, rental or payment behind it. This breaks "dashboard figures equal the underlying records", and the confirm text ("will disappear from the totals") is not true. Where: `admin_delete_rental` and `admin_delete_booking` (live database functions; the `supabase/migrations` folder does not hold their current definition). Suggested fix: in both functions, before deleting, insert reversing ledger rows (`adjustment_out`/`adjustment_in` for each ledger kind tied to that rental or booking, same as `admin_delete_payment`), or block the delete when the ledger has entries. **Fixed (owner chose "reverse")**: migration `supabase/migrations/20261022000003_ledger_reversal_on_delete.sql`, applied to the test project only. New helper `_reverse_ledger_for` cancels the net ledger effect of the deleted record with one reversing entry per side: `adjustment_out`/`adjustment_in` for collected, and `deposit_refund_out`/`deposit_in` for the held deposit (noted "deposit reversal, no cash moved"). `admin_delete_rental` and `admin_delete_booking` call it; payment delete is unchanged (its trigger already reverses). The migration also reversed the orphaned entries from this session's three deletes: `v_collected_monthly` is now collected 0 and deposit liability 0. Tested in a rolled-back SQL block with synthetic booking and rental entries: totals return to the starting value and a repeat call adds nothing. Not tested: a real UI delete after the fix (no records left in the test project). Assumption to confirm: a held deposit on a deleted record is written off with a `deposit_refund_out` entry because the ledger has no other kind that lowers the deposit liability. Production still needs this migration.
- **Minor:** the inventory unit from the deleted rental stayed non-available (it was returned damaged). Deleting the rental does not release it. Probably intended, confirm.
- **Product delete Confirm:** QA-Flow Suit (has history) was deactivated, not deleted, with the explaining toast; Reactivate restored it (database checked both times).
- **Error pages** (production build on port 3001 with temporary crash code, since removed and confirmed by `git status`): `error.tsx` shows "Something went wrong" with Try again / Reload and Try again recovers once the fault is gone; `global-error.tsx` shows when a component above the page boundary crashes. `global-error.tsx` renders without the app styles, so its buttons look plain. Cosmetic.
- **Refetch throttle:** 8 focus/online events produced exactly 1 full refresh (counted by the `branches` request); further events within 30 s produced 0; the next event after 30 s refreshed again. (Counting `inventory_items` requests shows 2 per refresh because one refresh queries it twice.)
- **Offline banner with a real network cut: not tested.** The browser tools cannot switch the network off. To test by hand: turn off Wi-Fi (or devtools > Network > Offline), confirm the banner shows, turn it back on, confirm the banner clears and data reloads.

## Branch lifecycle (owner rules, added after the first report)
Rules: a branch can be deleted only if nothing is linked to it; a branch can be deactivated only when it has no open rentals or pending/confirmed bookings; staff of an inactive branch cannot use the system (derived, nothing stored on staff); stock of an inactive branch is hidden from availability but stays in history.
- Migration `supabase/migrations/20261022000002_branch_lifecycle.sql`, **applied to the test project only**:
  - `profiles.branch_id` FK now `ON DELETE RESTRICT` (the other five tables referencing branches already refused delete).
  - `get_my_role()` / `get_my_branch()` return null for non-global staff whose branch is inactive, so every policy that uses them denies access. super_admin and owner are exempt. Reactivating the branch restores access.
  - Trigger `trg_guard_branch_deactivation` refuses deactivation while rentals are `out` or bookings are `pending`/`confirmed`.
- App: `AuthContext.tsx` signs out at login when `get_my_role()` is null (notice now says "account or branch"); `store.tsx` drops inactive branches from stock and availability.
- Tested: in rolled-back SQL, a manager's role is `manager` before and null after the branch is deactivated, super_admin unaffected; deactivation is refused with a clear message when a booking is open. In the browser as super_admin: deactivating a branch works, its stock disappears from All Products, and reactivating (done in SQL) restores it.
- Tested later with the owner's test accounts (localhost): (1) a booking was temporarily set to `confirmed`, then deactivating Kalpetta in the UI showed "This branch still has 1 open rental(s) or booking(s)..." and the branch stayed active; the booking was restored to `completed`. (2) With Kalpetta inactive, `staff@overbooked.com` signs in and is immediately signed out with the "Account deactivated... or your branch" notice. (3) After reactivating Kalpetta the same login works. Both branches and the booking are back to their original state.
- Known small gap: the app page is visible for a moment before the notice appears; data is already blocked by access rules.
- Assumption for QA_REPORT: "open" = rental `out`, booking `pending` or `confirmed`. Staff already logged in are cut off by access rules at the next data refresh, and by the sign-in check on next login.

## Final round (owner answers: keep the deposit write-off, release units on rental delete, "open" rule confirmed; run on development; fix the fetch race; test with own data)
- **Units released on rental delete:** `supabase/migrations/20261022000004_release_units_on_rental_delete.sql`, applied to the test project. The one unit left in maintenance by the earlier delete was set back to available by hand.
- **Refresh race fixed:** `store.tsx` `fetchSeqRef`; a newer refresh makes an older one stop before it writes state. No abort of the network request itself (not needed, no new dependency).
- **Empty branch:** created "QA Temp Branch" and deleted it in the UI; confirm dialog and success toast fine, branch gone from the database.
- **Full flow with my own data (test project, Kalpetta):** booking BK-0881 (2 days, total 3,000, advance 1,000 cash, deposit 2,000) confirmed; deactivating Kalpetta was refused while the booking was open; pickup with the 2,000 balance by UPI created rental RN-74D3 (paid) and marked the booking completed; the unit became rented; deactivating Kalpetta was refused again with the rental out; return as damaged with fee 300 taken from deposit gave refund 1,700 and the unit went to maintenance; ledger and `v_collected_monthly` showed collected 3,300 (3,000 rental + 300 fee) and deposit liability 0, consistent with the records; delete rental released the unit to available and reversed its entries; delete booking brought collected and deposit liability to 0. Rows left in the test project: none from this round.
- `QA_REPORT.md` written (findings, assumptions, what is not verified).
- Checks: `tsc` clean, lint 0 errors / same 5 warnings, build passes.
