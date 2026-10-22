# Changelog

## Unreleased (branch feature/responsive-redesign)
### Added
- Inventory Search: typing a product name (or part of a SKU) now shows a live pick-list; tapping a row opens that product. QR scan and exact SKU still work as before. UI only.

### Changed (UI only, no business logic, database or permission changes)
- Dialogs open as full-screen sheets on phones (safe-area aware, larger close button); small confirm dialogs stay centred.
- Side menu becomes a slide-in drawer below 1024px (tablets included), with 44px touch targets; page padding and floating Checkout button respect phone notches.
- Inputs use 16px text on phones (stops iOS zoom-on-focus); pinch-zoom is allowed again.
- Fixed phone overflow on All Products (grid columns), staff list, tabs; smaller headings on phones; All Rentals is a 2-up grid on phones.
- Table-to-card switch moved from 1280px to 1536px so laptops never clip action columns.
- Dark-theme leftovers (black overlays) replaced with theme colours.

## Unreleased (branch fix/phase1-4-findings)
### Fixed
- Route gate (`src/proxy.ts`) now verifies the session with `auth.getUser()` instead of trusting the cookie (S14).
- Booking creation no longer ignores a failed save of the advance/deposit payment method; it raises a clear error (S13).
- Rental notes edit reverts and shows an error when the database refuses it, instead of looking saved (FIN-11).
- Amounts show paise when present (₹100.50, not ₹101) in the UI and in WhatsApp messages (FIN-8).
- `npm run lint` works again (`next lint` was removed in Next 16; stale TanStack ESLint config replaced).
### Removed
- Unused `src/lib/supabase/admin.ts` (silent fallback to the anon key, S17).
### Database (migrations in supabase/migrations)
- Restored 20261018000001-06 (ledger, ledger triggers, token race, discount, booking race and past dates, whole paise): already APPLIED live, now in the repo so it matches the database.
- APPLIED live 2026-10-18: 20261018000010 - lost units stay `lost`, damaged go to `maintenance` (S24); `record_rental_payment` returns the stored rounded values (P3-1).
- APPLIED live 2026-10-18: 20261018000011 - production hardening from the live DB review: new sign-ups start inactive (SEC-1), trigger functions no longer callable via RPC (SEC-2), fixed search_path (SEC-3), duplicate policy dropped and FK indexes added (PERF). No signature or data changes.
- APPLIED live 2026-10-18: 20261018000012 - structure cleanup: `rentals.booking_id` links a rental to its booking (set by `pickup_booking_atomic`; older rentals stay empty), plain-numeric money columns become numeric(14,2), whole-paise checks validated, 8 foreign-key indexes. No data changed.
