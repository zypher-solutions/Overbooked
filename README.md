# Overbooked Admin Panel

Overbooked Rental Management Frontend

Build a complete Rental Management Web App for a premium clothing rental store called "Overbooked" based in Kerala, India. This is a private admin panel used only by shop staff — not a public-facing customer site.

Design Direction

Theme: Dark mode, ultra-premium, minimal. Think Notion meets Linear meets a luxury fashion brand.

Color Palette: Deep charcoal background (#0F0F0F or #111318), rich cream/ivory text, one accent color — warm gold (#C9A84C) for highlights and CTAs. Muted rust (#A0522D) for warnings/overdue. Emerald green (#2E7D52) for paid/success states.

Typography: Use "Fraunces" (serif) for headings and logo. "Inter" for all body text and data. "IBM Plex Mono" for tokens, SKUs, amounts. Import from Google Fonts.

Style Rules: Glassmorphism cards with backdrop-filter: blur. Thin 1px borders with low-opacity white. Smooth transitions on all hover states. No harsh shadows — use subtle glows instead. Rounded corners (12px cards, 8px buttons, 6px inputs).

Sidebar: Fixed left sidebar, 240px wide, dark (#0A0A0F), with the Overbooked logo at the top. Nav items have an active state with a gold left-border indicator and slight background highlight.

Tables: Clean, borderless rows. Alternating very subtle row shading. Sticky header. Each row has smooth hover highlight.

App Structure — Pages & Navigation

Use a fixed left sidebar with these navigation items (with appropriate icons):

Scan & Lookup (icon: search/barcode)

All Products (icon: grid)

Rentals Dashboard (icon: clipboard-list)

Financial Ledger (icon: chart-bar)

CSV Import (icon: upload)

No routing needed — use tab/page switching with React state.

Page 1: Scan & Lookup

Purpose: Staff types or scans a product SKU to check its stock across all branches instantly.

Layout:

Large centered search bar at top with a barcode icon button on the right

Below the search: a product result card (hidden until search)

The product card shows:

Product image (left, square, 120px)

Product name (large, Fraunces font)

SKU in monospace

Daily rental rate (e.g., "₹500/day")

A branch stock table showing each branch name and quantity with a colored badge (green if > 0, red if 0)

A "Put Out Rental" button (gold, prominent)

"Put Out Rental" opens a Modal Form with these fields:

Product name (pre-filled, readonly)

SKU (pre-filled, readonly)

Branch (dropdown — only branches with stock > 0)

Customer Name (text input, required)

Customer Phone (text input, optional, shows WhatsApp icon)

Quantity (number, min 1, max = available stock, shows "X available" hint)

Rent Date (date picker, today by default)

Due Date (date picker, must be after rent date — validate strictly)

Daily Rate (pre-filled from product, editable)

Total Amount (auto-calculated: days × daily rate × qty, but editable)

Advance Paid (number, optional)

Notes (textarea, optional)

At the bottom: calculated summary showing "Balance Due: ₹XXXX" in bold

"Confirm Rental" button (full-width, gold)

After confirming rental: Show a success modal with:

A unique rental token displayed large in monospace (e.g., TRZ-2024-0047) in a gold badge

Customer name

Two buttons: "Send via WhatsApp App" and "Send via WhatsApp Web" (both open a pre-filled WhatsApp message)

"Skip for now" link

WhatsApp message template (pre-filled):

Hi [Customer Name]!

Your rental from *Overbooked* is confirmed.

Item: [Product Name]

Branch: [Branch Name]

Rented: [Rent Date]

Due Back: [Due Date]

Token: [Rental Token]

Total: ₹[Amount]

Advance: ₹[Advance]

Balance: ₹[Balance]

Please return by *[Due Date]*. Thank you!

Page 2: All Products

Purpose: Browse the full product catalog with branch stock levels.

Layout:

Top bar: Search input + Branch filter dropdown + Stock status filter (All / In Stock / Out of Stock) + Grid/List view toggle

Product cards in a 4-column responsive grid (or list rows in list view)

Each Product Card:

Product image (full-width top, aspect 4:3, object-fit cover)

Product name (Fraunces, medium weight)

SKU (monospace, muted)

Daily rate (gold color)

Stock status badge (green "In Stock" or red "Out of Stock")

Branch stock pills: small colored pills showing "Kalpetta: 3", "Bathery: 2" etc

Clicking a card opens the Rental Status Modal

Rental Status Modal:

Shows all active (currently rented out) rentals for that product

Each rental row: Token badge, Customer name, Branch, Due date, Overdue tag if past due, Payment status

"Edit" button and "Mark Returned" button per row

"Put Out Rental" button at the top

Page 3: Rentals Dashboard

Purpose: The main operational screen — see all active rentals, manage returns, send reminders.

Layout:

Top: Two stat cards — "Items Currently Out" (number) and "Overdue Items" (number in red)

Full-width table below

Table columns: Token | Product | Customer | Branch | Qty | Amount | Payment | Due Date | Actions

Table details:

Token: displayed as gold monospace badge

Product: small thumbnail + name

Customer: name + phone below in muted smaller text

Amount cell: shows "₹X total / ₹X advance / ₹X balance" stacked

Payment column: dropdown select (Unpaid / Partial / Paid) — changes on select immediately

Due Date: shows date, and if overdue, shows "OVERDUE" red badge

Overdue rows: entire row has a very subtle red background tint

Actions column: "Edit" button (indigo) + "Mark Returned" button (dark) + WhatsApp reminder icon button

"Edit" opens an Edit Rental modal with all the same fields as the rental form, pre-filled:

Customer Name, Customer Phone

Rent Date, Due Date

Daily Rate, Total Amount, Advance Paid

Payment Status dropdown

Notes

"Update Rental" button

"Mark Returned" click: Shows a small inline confirmation with condition selector (Good / Damaged / Missing), then confirms. On confirm:

Marks as returned

Payment status auto-set to "Paid"

Row disappears from table

Page 4: Financial Ledger

Purpose: Full financial history of all rentals — filter, analyze, export.

Layout:

Top: 5 summary cards in a row:

Total Revenue (all time)

Collected (advance paid total)

Pending Balance (total outstanding)

Overdue Balance (overdue items only)

Rental Count

Filter bar below the cards:

From Date + To Date pickers

Branch dropdown

Status filter (All / Out / Returned)

Payment filter (All / Paid / Partial / Unpaid)

"Apply Filter" button + "Export CSV" button (right-aligned)

By default load with current month's data

Full-width table below

Table columns: Token | Customer | Item | Branch | Qty | Days | Rate/Day | Total | Advance | Balance | Payment | Status | Rented | Due

Table details:

Token: gold monospace badge

Balance: red if > 0, muted if 0

Payment: colored tag (green=Paid, gold=Partial, red=Unpaid)

Status: colored tag (rust=Out, green=Returned)

Overdue rows get a subtle red row tint

CSV Export:

Clicking "Export CSV" downloads a .csv file with all currently filtered rows

Filename: overbooked-ledger-YYYY-MM-DD.csv

Page 5: CSV Import

Purpose: Bulk-import products AND their branch stock from a single CSV file.

Layout:

Card with title "Bulk Import Products via CSV"

"Download Template" button at top-right of card

Required columns info: name, sku, daily_rate, branch_name, quantity

Instructions: "To set stock in multiple branches, add one row per branch for the same SKU"

Drag-and-drop zone (dashed border, upload icon, "Drop your CSV here or click to browse")

After file selected: show file name + size + a "Remove" button

"Start Import" button appears after file selected

Progress/result area below: shows "Created X products, Updated X, Errors: [list]"

Template CSV content:

name,sku,daily_rate,branch_name,quantity

Bridal Suit Red,BS-RED-001,500,Kalpetta,3

Bridal Suit Red,BS-RED-001,500,Bathery,2

Denim Jacket Blue,DJ-BLU-002,300,Kalpetta,5

Sample/Mock Data to Use

Branches:

Kalpetta (Branch 1)

Bathery (Branch 2)

Sample Products:

Bridal Suit — SKU: SU-001 — ₹999/day — Kalpetta: 3, Bathery: 2

Linen Shirt — SKU: WLS-001 — ₹199/day — Kalpetta: 5

Denim Jacket — SKU: DJ-001 — ₹299/day — Bathery: 4

Silk Saree — SKU: SS-001 — ₹799/day — Kalpetta: 2, Bathery: 1

Sample Active Rentals:

Token: TRZ-2024-0001 | Bridal Suit | Arjun Kumar | Kalpetta | Due: yesterday | OVERDUE | Partial (₹500 advance, ₹499 balance)

Token: TRZ-2024-0002 | Linen Shirt | Meera Nair | Bathery | Due: tomorrow | Unpaid (₹199 balance)

Token: TRZ-2024-0003 | Silk Saree | Priya Menon | Kalpetta | Due: next week | Paid

### State Management Notes

Use React state (useState/useReducer) for everything — no backend needed yet.

products[] — list of all products with branch stock

rentals[] — list of all rentals (active and returned)

activePage — current tab/page

When a rental is created:

Add to rentals[]

Deduct quantity from the matching product's branch stock

When a rental is marked returned:

Update rental status to "returned", payment_status to "paid"

Add quantity back to product branch stock

Component Checklist

Sidebar with nav items and active state

SearchBar with barcode icon

ProductCard (grid and list variants)

RentalFormModal (new rental)

WhatsAppModal (post-rental confirmation)

RentalStatusModal (from product card click)

EditRentalModal

ReturnConfirmModal

DashboardTable with all rental rows

LedgerTable with filter bar

SummaryCard (stat cards)

PaymentStatusSelect (inline dropdown)

StatusBadge (colored tags)

TokenBadge (gold monospace)

BranchPill (per-branch stock indicators)

CSVDropZone

Toast notifications (top-right, auto-dismiss after 3s)

Final Notes

All currency in Indian Rupees (₹)

Date format: DD/MM/YYYY for display, YYYY-MM-DD for inputs

Phone numbers: Indian format (+91 or 10 digits)

Rental tokens format: TRZ-YYYY-XXXX (e.g., TRZ-2024-0047)

WhatsApp links use https://api.whatsapp.com/send/?phone=91XXXXXXXXXX&text=...

No authentication needed for this prototype

The app should feel fast, responsive, and professional enough to show to a client


## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
