# TRENDZ screen audit (bridal and groom shops)

Written 29 Oct 2026, after the owner found that Dashboard and Finance had lost parts of the TRENDZ screens.
Method: the TRENDZ file and ours read side by side (TRENDZ is read only). Each screen is marked
**done**, **fixed now** or **open** (needs the owner's go-ahead).

| TRENDZ screen | Ours | State |
|---|---|---|
| Dashboard (`pages/Dashboard.tsx`) | `/`, `TrendzDashboard.tsx` | **fixed now**: Filter panel and chips, Completed Rentals (Show/Hide, pages of 50), Edit and WhatsApp on every row, piece codes and picture, days left / OVERDUE / Returned date, sortable headers, in-place search, phone cards |
| Finance (`FinanceSummary.tsx` + Dashboard ledger tab) | `/finance` | **fixed now**: search, Filter panel and chips, Ledger Records (bookings and rentals, Record payment), Refresh, Export PDF, Records CSV, phone cards |
| Bookings | `/bookings` | **fixed now**: Buffer and Available on each card (from the days the pieces are held), Completed Bookings under Show/Hide, opens on all statuses |
| All Rentals (product grid) | `/all-rentals` | done |
| All Products | `/catalog` | **fixed now**: stock filter, Delete (owner; a product with history is switched off, as in TRENDZ), Reactivate (migration 14), inactive products stay listed with an Inactive badge, phone cards |
| Inventory Search, cart, booking form | `/scan`, `/book` | done (booking form compared on 29 Oct) |
| Add New Product, Categories, CSV import | `/catalog/new`, `/catalog?tab=categories`, `/catalog/import` | done for SKU rules; not compared button by button |
| Stock Locations, Branch and Staff Management | Zypher only | not compared again |
| Rental summary, Return, Record payment, Edit rental, WhatsApp (modals) | `/rentals/[id]` page and dialogs | **open**: TRENDZ opens a modal; ours opens the rental page. Edit on a rental that is out goes to that page (Extend, charges, notes) |

## Differences on purpose (our database is not TRENDZ's)
- No separate bookings table: a booking is a rental with status "reserved". The Ledger Records list shows both, with a Booked badge.
- No ledger table: Collected, Daily close and Ledger CSV are summed from the payment records. TRENDZ's
  "Corrections (no cash)" row has no equivalent here.
- Finance has no Today / Last 7 days / Last month buttons any more (TRENDZ has none); dates are set in the Filter panel and open on the 1st of this month.
- Money columns say **Paid** where TRENDZ says Advance, since our payments are one record, not advance plus balance.

## Not verified
- The PDF opens and downloads without an error, but its pages were not looked at.
- The manager and staff logins were not opened on the new Dashboard and Finance.
- Dashboard with rentals that are out (the demo data has none): code path read, not seen.
