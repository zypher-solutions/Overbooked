# QA report (Phase 4)

Scope: findings from Phase 4 only. Earlier phases are in `PHASE1_REPORT.md` to `PHASE3_REPORT.md`. All findings below are **fixed on `development`**; the database fixes are applied to the **test project only** and must be applied to production before go-live. Nothing is pushed.

## Findings

### High
1. **Deleting a rental or booking left its money in the ledger.** Dashboard "collected" no longer matched the records (₹1,300 collected with no booking, rental or payment behind it).
   - File: live DB functions `admin_delete_rental`, `admin_delete_booking` (not previously in `supabase/migrations`).
   - Reproduce: as super admin delete a returned rental and its booking from Admin tools, then `select * from v_collected_monthly`.
   - Fix: `supabase/migrations/20261022000003_ledger_reversal_on_delete.sql` (helper `_reverse_ledger_for`, line 1 onward). Re-tested end to end: booking, pickup with payment, damaged return with fee, delete rental, delete booking; collected and deposit liability return to 0.

### Medium
2. **Deleting a branch with staff silently set their branch to blank** ("Loading Branch..." in the sidebar).
   - File: `src/components/overbooked/pages/BranchManagement.tsx:149`; FK `profiles_branch_id_fkey` was `ON DELETE SET NULL`.
   - Fix: app check plus `supabase/migrations/20261022000002_branch_lifecycle.sql` (FK now RESTRICT).
3. **Category could be orphaned at database level** (`products.category_id` was `ON DELETE SET NULL`).
   - Fix: `supabase/migrations/20261022000001_products_category_restrict.sql`.
4. **A deactivated branch did not lock out its staff**, and a branch with open rentals could be deactivated.
   - Fix: `20261022000002_branch_lifecycle.sql` (`get_my_role`/`get_my_branch` return null for staff of an inactive branch; trigger `trg_guard_branch_deactivation`); `src/lib/overbooked/AuthContext.tsx:61`; inactive-branch stock hidden in `src/lib/overbooked/store.tsx`.
5. **Deleting a rental left its units non-available** (damaged returns stayed in maintenance).
   - Fix: `supabase/migrations/20261022000004_release_units_on_rental_delete.sql`. Units that are lost, or on another rental still out, are not touched.

### Low
6. **Admin delete confirm opened before the reason check**, so the user confirmed a scary dialog and then got "reason required". `src/components/overbooked/AdminTools.tsx:177` (`reasonFirst`).
7. **Confirm dialog flashed `delete "undefined"?` while closing.** `src/components/overbooked/ConfirmDialog.tsx:28`.
8. **Blocked staff saw the app shell briefly before the notice.** `src/lib/overbooked/AuthContext.tsx:48,144`.
9. **"No Image" placeholder returned 400** (`next/image` refuses the SVG that placehold.co serves by default). `src/lib/overbooked/store.tsx:397,559` and `Dashboard.tsx` now request PNG.
10. **A slow older refresh could overwrite newer data.** `src/lib/overbooked/store.tsx:272` (`fetchSeqRef`): a newer refresh makes older ones stop before writing state.

## Assumptions (owner confirmed 2026-10-22 unless noted)
- "Open" for the deactivation block means a rental with status `out`, or a booking `pending` or `confirmed`.
- A branch can be deleted only if nothing references it; the database enforces it (RESTRICT / no-action FKs on profiles, product_stock, rentals, inventory_items, bookings, ledger_entries).
- Staff access is derived from the branch state (nothing stored on staff), so reactivating a branch restores access. super_admin and owner are not tied to a branch.
- Stock at an inactive branch is hidden from availability but stays in history and reports.
- Ledger is append-only; deleting a record writes reversing entries. A held deposit on a deleted record is cleared with a `deposit_refund_out` entry marked "deposit reversal, no cash moved", because no other ledger kind lowers the deposit liability.
- Deleting a rental frees its units (rented or maintenance to available); lost units stay lost.
- Category "inactive" status was not added; deleting a category that has products stays blocked.

## Not verified
- Offline banner with a real network cut (owner will test manually).
- Applying the four migrations to production, and the push security review (the automatic review did not complete).
- `global-error.tsx` has no app styling (cosmetic, left as is).
