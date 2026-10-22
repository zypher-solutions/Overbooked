# Phase 3 report

## What changed
- **U-06 (native confirm):** all 10 `confirm()` / `window.confirm()` calls now use the AlertDialog. A small shared `components/overbooked/ConfirmDialog.tsx` wraps it. Messages are unchanged. Files: `AdminTools.tsx` (3), `AllProducts.tsx` (2, one shared dialog), `BranchManagement.tsx`, `Categories.tsx` (2, one dialog), `AddProduct.tsx`, `RentalFormModal.tsx`. grep finds no `confirm(` left in `src/`.
- **U-08 (error pages):** added `app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx` (message plus Try again / Reload / Back buttons). Deleted `lib/error-page.ts` and `lib/error-capture.ts`; grep showed nothing imported them.
- **U-09 (offline / refresh):** new `OfflineBanner.tsx`, shown at the top of the main area in `app/page.tsx`. In `store.tsx` a silent `fetchInitialData` (which also loads bookings) runs on window focus, tab becoming visible and `online`, at most once per 30 s.
- **U-17 (accessibility):**
  - Cards in `Bookings.tsx` and `AllRentals.tsx` (grid card, mobile list row) now have role="button", tabIndex=0 and Enter/Space. Key handling ignores keys pressed on inner buttons.
  - `AllRentals.tsx` table rows got tabIndex and Enter/Space but no role="button", to keep table semantics.
  - Login form: label `htmlFor` / input `id`, `autoComplete` username and current-password.
  - Sidebar: `aria-current="page"` on the active item (Dashboard and group items).
- **U-15:** removed all `[DEBUG ...]` logs in `store.tsx`, including the RN-4372 block and a DEBUG console.error.

- **Category delete guard (added after review):** a category that still has products cannot be deleted; the app asks the user to move the products first. Checked in `Categories.tsx` (loaded products) and again in `store.tsx` `deleteCategory` (database count). Verified in the browser.

## Checks passed
`npx tsc --noEmit` clean. `npm run lint`: 0 errors, the same 5 existing warnings. `npm run build` succeeds.

## Not verified
Browser-tested (owner login, test data): not-found page, login labels, aria-current, offline banner (simulated events), Enter/Space on booking and rental cards, delete dialogs for categories (cancel and confirm), products (cancel), rental draft discard (nested) and add-product draft discard, and the category delete guard. Not tested: branch delete and Admin tools deletes (need super_admin), error pages, the 30 s refetch throttle. See `PHASE4_TODO.md`.

## Still open
- `AllProducts.tsx` has no clickable cards (`onOpen` is unused there), so there was nothing to make keyboard-operable.
- The refresh has no abort for a fetch already in flight.
- The old `.claude/settings.local.json` still mentions the deleted files (not tracked here).
