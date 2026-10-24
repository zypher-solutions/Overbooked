# Phase 1 report (2026-10-21, branch development)

## Changed
- U-10 `src/components/ui/sonner.tsx`: error toasts stay until dismissed (close button); success toasts keep 3s.
- U-01 `store.tsx`, `page.tsx`, `Bookings.tsx`: new `loadError` flag; a banner with Retry shows when a load fails; Bookings no longer says "none created yet" on a failed load.
- U-04 `RecordPaymentModal.tsx`: review line (amount, method, balance after); cannot close or re-submit while saving.
- U-14 `BookingDetailModal.tsx`, `RentalFormModal.tsx`: cannot close while cancelling, picking up or creating a booking.
- U-07 `Sidebar.tsx`, `AuthContext.tsx`: sign-out asks for confirmation only when an unfinished booking exists; sign-out failure (offline) now shows an error and keeps the draft.
- U-13 `store.tsx`: if the post-save refresh fails, the booking confirmation is built from the saved data instead of throwing an error for a saved booking.

## Checks
- `npx tsc --noEmit`: passed.
- `npm run lint`: 0 errors, 5 warnings (all existing, none in changed code).
- `npm run build`: passed.
- Not run: Playwright (writes to the database), and no manual browser check of toasts, banner, dialogs.

## Not done
- Database: no changes in this phase.
- FIN-10 (duplicate payment idempotency) still open; needs a DB change.
