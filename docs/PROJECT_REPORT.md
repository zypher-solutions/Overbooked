# Overbooked: the complete project report

What exists today, what is wrong, what is left to do, and the business plan

Written on 30 October 2026 for the owner and partners of Zypher. It describes the project as it stood at the end of the work on 29 October 2026.

# 0. How to read this document

> **What this means for you:** you do not need to read it all in one go. Part 1 is one page. Read that first. The rest is there when you need the detail.

## Who this is for
- You and your partners, so everyone knows the same facts.
- Any developer or helper you bring in later. They should be able to start work from this document alone.

## How it is organised
- **Part 1** is the one-page summary.
- **Part 2** tells the story of how the project got here.
- **Parts 3 and 4** explain how the product is built and who can do what.
- **Parts 5 and 6** walk through every screen and button of the shop app and of the Zypher console.
- **Part 7** explains the money rules.
- **Part 8** lists everything that is wrong or risky, from most serious to least.
- **Parts 9 and 10** are the business: prices, costs, and how to pay a sales person.
- **Part 11** is everything still left to do, in order.
- **Part 12** is the list of decisions only you can make.
- **Part 13** is the appendix: word list, tests, commands, accounts, and the status of every document.

## Words used in this document
- **Zypher** is your company. Zypher sells and runs the software.
- **Shop** is one of your customers, for example a bridal rental shop.
- **Owner, manager, staff** are the people who work in a shop. The owner sees everything. A manager looks after one branch. Staff work at the counter.
- **Piece** is one real item that can be rented, for example one particular saree.
- **Console** is the separate website area only Zypher staff can open. Shops never see it.
- **Database** is where all information is stored, with the rules that protect it.

A longer word list is in Part 13.

## What is certain and what is not
- Facts about the product come from reading the code and running the tests. Where I could not confirm something, the text says "not confirmed".
- Prices and costs of other companies come from their websites. Each one says when it was checked.
- Competitor prices that were only reported to you, not checked, are marked "not verified".
- Commission amounts in Part 10 are **my suggestion**. They are not a market fact.

# 1. The one-page summary

> **What this means for you:** the product itself is in good shape for bridal and groom shops. What is missing is mostly outside the product: a place to run it, a safety net, and a few rules for staff. Nothing is running online yet.

## What Overbooked is
Overbooked is software that rental shops use to run their business: who has booked which item, when it goes out, when it comes back, how much is paid, and how much deposit is held. One shop shows no other shop's data. Zypher sets each shop up and bills it.

It grew out of the admin panel built for TRENDZ, a bridal and groom rental shop. The first target is bridal and groom shops. Car, bike and resort shops are set aside.

## Status board

| Area | Status | In one line |
|---|---|---|
| Bridal and groom shop app | Done | Booking, hand over, return, deposits, payments, products, customers, calendar, scanning |
| Finance, expenses and profit | Done | Money in, money out, profit, daily cash close, CSV and PDF |
| Receipts and tax invoices | Done | Plain receipt, or a numbered tax invoice for shops with a GST number. Needs an accountant's check |
| Zypher console | Done | Create shops, set plans and fees, branches, staff, billing, audit log. Several gaps, listed in Part 8 |
| Two-step sign-in | Done | Required for Zypher staff and support logins |
| Database rules and tests | Done | 358 database tests and 25 browser tests all pass |
| Car, bike and resort screens | Half done | Older screens, less tested, not the first target |
| Backups | Half done | Only Supabase's own 7 days. Your own backups are written but switched off |
| GitHub | Half done | 16 recent commits exist only on this laptop. Rules for the main branch are not confirmed |
| Hosting online (test and live) | Not done | No Supabase or Vercel accounts, no web address, no email sender |
| Watching for problems | Not done | No error alerts, no "is it up" check |
| Mobile app | Not done | The rules the app must follow are written. Your friend has not started |
| Automatic WhatsApp | Not done | Staff send messages by hand with one tap. You decided to build automatic WhatsApp and reminders |
| Staff performance tracker | Not done | Decided on 30 October to build it |
| Partial returns | Not done | A design is written. Today a rental is returned all at once |
| Shop data export and leaving a shop cleanly | Not done | Needed for trust and for privacy law |
| Price list inside the console | Not done | Fees are typed in by hand for each shop |

## The five biggest risks
1. **Nothing is online and nothing is watched.** No test copy, no live copy, no alerts. A first shop would be the first real test.
2. **The latest work lives on one laptop.** Sixteen commits (the saved steps of the work) were never pushed to GitHub.
3. **Backups reach back only seven days.** A mistake found later cannot be undone. You chose to park this for now.
4. **Counter staff can change prices and refund with no second check.** They can give any discount, type any agreed price, cancel a booking and refund money, and extend a rental.
5. **One database for all shops.** This is the right choice at this size, but a mistake in an update could affect every shop. It needs a test copy, a backup before each update, and the privacy tools that are still missing.

## The five next steps
1. Push the work to GitHub and turn on protection for the main branch.
2. Open the Supabase and Vercel accounts and set up a test copy first.
3. Have someone who works in a bridal shop click through every screen, as owner and as staff.
4. Decide what counter staff may and may not do, then lock it in the database.
5. Decide how and when to make backups that reach back further than seven days.

## The money side in three lines
- **Prices:** Starter ₹499, Pro ₹999, Business ₹1,999 a month before GST. A yearly payment gives two months free.
- **Cost to run:** about ₹4,000 a month at the start and about ₹5,000 to ₹6,000 for around 150 shops. Break-even is about 5 to 7 shops.
- **Sales person:** a one-time commission per shop, with a plan in Part 10.

# 2. The story so far

> **What this means for you:** several chats built this project, and some decisions changed on the way. This part puts them in one place, so you know what is current.

## Where it started
- **22 October 2026:** Overbooked was forked (copied) from the TRENDZ admin panel. TRENDZ is a live bridal and groom rental business run by a relative of yours. The copy got its own repository, its own local database and its own documents.
- **The rule that never changes:** nothing of TRENDZ is ever touched. Not its code, not its online database, not its keys. TRENDZ's folder is only read, as a reference for how the screens should look.
- The first plan for Overbooked is the "Product and Business Plan" document dated 22 October. It set the idea: one shared system for many shops, a low monthly price, no big up-front fee.

## What was built, in order
1. **A copy that runs on this laptop** with a local database in Docker, demo data and logins for testing.
2. **Many shops in one database.** Every record carries its shop, and the database keeps shops apart.
3. **A new rental engine** for bridal, groom, resort, car and bike shops: booking, hand over, return, deposits, payments, charges, corrections, all with rules in the database.
4. **The Zypher console** to create shops, set plans and fees, and bill them.
5. **The shop app, rebuilt**, then made to look and work like the TRENDZ screens for bridal and groom shops: sidebar, cart, scan-to-find, return piece by piece, Dashboard, Finance, Bookings, All Rentals, Add New Product in three steps.
6. **Zypher became "setup only."** Branches, staff and stock counts are set up by Zypher, and Zypher can never see a shop's bookings, customers or money. A "support" login lets Zypher help one shop when asked.
7. **Two-step sign-in, tighter database permissions, attack tests, and the GitHub files** (checks, backup job, branch rules).
8. **The pre-launch pass on 29 October:** rules found missing in a review, expenses and profit, tax invoice numbers, route guards, a phone home-screen app, a lost-piece charge, a trial period, and a lighter Finance page.

## Decisions that changed on the way
| Topic | First idea (22 Oct) | Now |
|---|---|---|
| Setup fee | None | First ₹2,999 for shops with no software. From 30 October: an initial cost of half of BookieBuddy's first-year price for the matching plan (Starter ₹6,000, Pro ₹10,000, Business ₹12,500), paid once on top of the normal plan. Shops that already have software pay no initial cost |
| Stock limits | None | Proposed on 30 October: 1,000, 3,000 and 10,000 pieces for Starter, Pro and Business. Not yet built |
| Bridal and groom | Two business types | One "Clothing rental" type |
| Who sets up branches and staff | The shop owner | Zypher only |
| Plan features | Automatic WhatsApp on Pro and Business; extra branches for ₹299 on Starter | Removed, because neither is built. Plans differ only by branches and staff logins |
| Shop fee | A price list per plan | The fee is typed per shop (negotiated deals); the plan only sets limits |
| Free trial | Not decided | 14 days, decided on 29 October |
| Founding shops | First 15, then "first 3 to 5" on the 26 October call sheet | Not settled. See Part 12 |
| Mobile app | For the shops' customers | For shop staff and owners. Customers get no app for now |
| Backups | Copy the TRENDZ method, add encryption | Parked. Only Supabase's 7 days for now |
| Hosting | Vercel and Supabase online | Still all local on this laptop |

## What the chats left open
These are still undecided and are listed again in Part 12: what happens when a business type is removed from a shop, children counted as extra guests, late-return rules, how to handle a mid-month plan change, whether features should be tied to plans, and whether Zypher is registered for GST.

# 3. How the product is built

> **What this means for you:** there are three pieces: the screens people use, the database that holds the rules, and a few small server programs. The database is the boss. Even if a screen has a mistake, the database refuses anything that breaks a rule.

## The pieces, in simple words

| Piece | What it is | Where it lives |
|---|---|---|
| The shop app | The screens staff and owners use: bookings, returns, products, Finance | `src/app/(shop)` in the code |
| The Zypher console | Screens only Zypher staff can open: shops, billing, team | `src/app/zypher` |
| The database (Supabase) | Stores everything and enforces the rules. About 100 small programs (functions) run inside it, for example "make a booking" and "record a return" | `supabase/migrations` |
| Sign-in | Email and password, plus a six-digit code from an authenticator app for Zypher staff | Supabase, with pages `/login`, `/mfa`, `/welcome` |
| Photo storage | Product photos (public) and handover or ID photos (private), one folder per shop | Supabase |
| Live updates | Screens refresh by themselves when a rental or payment changes | Supabase "realtime" |
| Server programs | Three small pieces that may use the all-powerful key: making invite links, making login links, creating a shop with its owner | `src/app/actions` |

There is **no separate backend server**. The screens talk to the database directly, and the database's rules decide what is allowed.

## Why the database is the boss
- A screen can be wrong, hidden or even bypassed. The database cannot be.
- Every important action (book, hand over, return, take a payment, cancel) is a function in the database. It checks who is asking, which shop, which branch and which role.
- The rules about money are inside the database too (see Part 7).
- A future mobile app uses the same functions, so it gets the same rules for free.

## One database for all shops
This was a question your friend raised. The short answer is: **yes, this is the right way for now.**

- **Why not one database per shop:** each Supabase project needs its own server. At ₹499 a month a shop, a database of its own would cost more than the shop pays.
- **How shops are kept apart:** every record carries the shop it belongs to. A rule on every table lets a person see only their own shop. Links between records also carry the shop, so a record of one shop cannot be linked to another shop's record. Fifty-six security tests try to break this and all pass.
- **The real risk:** not a leak, but a wide effect. A bad update or a Supabase outage touches every shop at once.
- **What reduces that risk:** a test copy to try every update first, a backup before every live update, the test suite, and alerts. The test copy and alerts do not exist yet.
- **If one shop grows very large:** its records can be moved to a database of its own later, because every record already carries its shop.

## The shop "kinds"
- A shop has one or more **business types**: Clothing rental, Resort, Car rental, Bike rental. They decide the wording, the fields, how time is counted (by day, by night, by hour), and the default extras.
- A shop whose types are **all** clothing gets the "TRENDZ screens" (Dashboard, Finance, Bookings, Inventory Search, All Rentals). Every other shop gets the older screens (Today, New booking, Bookings, Money and reports).
- A shop with clothing **and** another type gets the older screens and loses the clothing-only ones. This is a weakness (Part 8).

## Optional features, switched per shop
Zypher switches these on for one shop without affecting any other shop: Sets, Customer measurements, Alterations, Appointments, Guest counts, Meal plans, Whole-property booking, With driver. The shop's owner cannot flip them.

## What runs where today
- **Everything runs on this laptop:** the database in Docker, the app with `npm run dev`.
- There is no online test copy and no online live copy. See Part 11.

# 4. Who can do what

> **What this means for you:** each person sees only what their job needs. The table shows what the database allows today. Cells marked in the last column of Part 8 are the ones I think are too open.

| Action | Owner | Manager | Staff | Zypher support | Zypher staff |
|---|---|---|---|---|---|
| See bookings of their own branch | Yes | Yes | Yes | Yes | No |
| See bookings of every branch | Yes | No | No | Yes | No |
| Make a booking | Yes | Yes | Yes | Yes | No |
| Give any discount or agreed price | Yes | Yes | Yes | Yes | No |
| Hand over a rental | Yes | Yes | Yes | Yes | No |
| Return a rental | Yes | Yes | Yes | Yes | No |
| Backdate a return by more than 2 hours | Yes | Yes | No | Yes | No |
| Take a payment or deposit | Yes | Yes | Yes | Yes | No |
| Give the deposit back while the piece is out | Yes | No | No | Yes | No |
| Cancel a booking and refund | Yes | Yes | Yes | Yes | No |
| Extend a rental | Yes | Yes | Yes | Yes | No |
| Add a charge to a booking | Yes | Yes | No | Yes | No |
| Correct or delete money records, with a reason | Yes | No | No | No | No |
| See Finance and the payments list | Yes | Own branch | No | Yes | No |
| Add an expense | Yes | Own branch | No | Yes | No |
| Correct or delete an expense | Yes | No | No | No | No |
| Add or edit products, categories, extras, CSV import | Yes | Yes | No | Yes | No |
| Delete a product | Yes | No | No | Yes | No |
| Free a damaged piece again | Yes | Own branch | No | Yes | No |
| Add or edit customers | Yes | Yes | Yes | Yes | No |
| Block or unblock a customer | Yes | Yes | No | Yes | No |
| Change shop settings | Yes | No | No | Yes | No |
| See the Stock Locations page | No | No | No | Yes | No |
| Create shops, set plan and fee, pause a shop | No | No | No | No | Yes |
| Add branches, invite staff, change roles | No | No | No | No | Yes |
| Record what a shop pays Zypher | No | No | No | No | Yes |
| See a shop's customers, money and photos | Yes | Own branch | Own branch | Yes | No |
| Must use the six-digit code | Optional | Optional | Optional | Yes | Yes |

## Notes on the table
- **Support** is a login Zypher makes for one shop when that shop asks for help. It works like the owner, except it cannot correct or delete money records. It does not use up the shop's login limit.
- **Zypher staff** never see a shop's bookings, customers, payments, products or photos. They see only counts, such as how many bookings in 30 days.
- **"Own branch"** means a manager or staff member sees only the branch they were given.
- Staff cannot read the payments list, but they can still record a payment and print a receipt that shows it. The two are not consistent.
- An owner's password can be reset by Zypher through a login link. That is logged, but it is a point of trust.

# 5. Tour of the shop app

> **What this means for you:** this is every screen a bridal or groom shop sees, with every button and what it does. After the clothing screens come the screens for car, bike and resort shops. Under each screen, "Problems" lists things I found that are wrong or confusing.

## 5.1 The frame around every screen

**The menu on the left (a drawer on a phone) for a clothing shop**

| Menu group | Items | Who sees it |
|---|---|---|
| (top) | Dashboard | Everyone |
| (top) | Finance | Owner and manager |
| Rentals | Bookings, Inventory Search, All Rentals, Calendar, Customers | Everyone |
| Rentals | Appointments | Everyone, only if the shop has this feature on |
| Products | All Products | Everyone |
| Products | Add New Product, Categories, Extras, CSV Import | Owner and manager |
| Admin | Stock Locations | Zypher support only |
| Admin | Shop settings | Owner only |

**At the bottom of the menu:** the shop name, the person's role and branch, **Change password**, **Sign out**, and the label "Staff panel v2.0".

**Things that appear on every screen**
- A floating **Checkout (n)** button when the cart has items. It opens the booking form.
- An **offline banner** when the internet drops. It only warns. A booking typed while offline is not saved.
- A **subscription banner** for the owner when 7 days or fewer are left on the plan.

**Button details**
- **Change password** opens a box with the password rules (at least 10 characters, upper and lower case, a number and a symbol). It also has a link to turn on the six-digit code.
- **Sign out** asks first if the cart still has items.

**Typed addresses.** If someone types the address of a screen that belongs to the other kind of shop, the app sends them to the right screen. A bridal shop that types `/rentals` lands on Bookings. A car shop that types `/finance` lands on the home page.

**Problems**
- There is no "New booking" item in the clothing menu. A booking starts from Inventory Search, then Add to Cart, then Checkout, or from a "New rental" button.
- "Staff panel v2.0" and the tagline "Rental Studio" are fixed text left from TRENDZ. The login page shows "Rental Studio" to every shop.
- A support login sees owner-only buttons (Delete, Correct). The database refuses them, so they simply show an error.

## 5.2 Signing in

**Login page (`/login`)**
- Fields: Email, Password (with a show/hide eye and a warning if Caps Lock is on), and **Sign In**.
- A wrong email and a wrong password give the same message, so nobody can tell which emails exist. Too many tries gives "wait a few minutes".
- The footer says: "Forgot your password? Ask Zypher for a new link."

**Welcome page (`/welcome`)** is where an invite link or a new-password link lands. The person chooses a password, with the rules shown on screen. Links work once and for one hour.

**Two-step code (`/mfa`)**
- First time: a QR code to scan with Google Authenticator, Microsoft Authenticator or Authy, then six digits.
- Next times: only the six digits.
- Zypher staff and support logins must use it. Owners, managers and staff may turn it on.

**Problems**
- There is no self-service password reset. Every forgotten password goes to Zypher.
- There are no recovery codes. A Zypher person who loses their phone can only be fixed from the Supabase dashboard.
- The login box's example email, `manager@overbooked.com`, is made up but looks real.

## 5.3 Dashboard (`/`)

**What it is for:** the first screen of the day. What must go out, what must come back, what is late.

**Who:** everyone. Staff do not see money.

| Button or item | What it does |
|---|---|
| **New rental** (top) | Goes to Inventory Search to start a booking |
| Search box | Finds by booking number, customer name, phone, SKU or piece code |
| Card: **Pickups today** | Shows the bookings due to go out. This includes missed pickups from earlier days |
| Card: **Returns due today** | Shows rentals due back today |
| Card: **Overdue** | Shows rentals past their return time |
| Card: **To collect** (owner, manager) or **Items out** (staff) | Shows the money still owed, or how many items are out |
| A row's **Hand over** or **Return** | Opens that booking with the hand-over or return box already open |
| A row's **WhatsApp** | Opens a ready message in WhatsApp for the customer |
| **Active Rentals** table | Every rental that is out. On a wide screen you can click a heading to sort. On a phone there is a sort box and an up/down button |
| **Refresh** | Reloads the list |
| **Filter** | Opens filters: start from, start to, branch, status (All, Out, Returned), payment (All, Paid, Partial, Unpaid). Chosen filters show as small tags with "Clear all" |
| **Completed Rentals** | A fold-out list of finished rentals, 50 at a time, with "Show more" |

The screen updates itself about a second and a half after any rental changes.

**Problems**
- "Pickups today" counts missed pickups from earlier days and does not say so.
- A customer who is late appears under **Overdue**, not **Returns due today**. They can be in either list, which confuses staff.
- The **Edit** button on a row only opens the booking. The name promises more than it does.
- The WhatsApp button still opens a link when the customer has no phone number.
- There is no reminders panel here. A car shop has one. A clothing shop must press WhatsApp on each row.

## 5.4 Finance (`/finance`)

**What it is for:** how much money came in, how much is owed, how much was spent, and the daily cash count.

**Who:** owner and manager (a manager sees only their branch). Staff see "Finance is for owners and managers."

**The cards**

| Card | What it means |
|---|---|
| **Earned** | The value of rentals by the day they were picked up, plus cancellation fees by the day they were cancelled. Shown against the previous period of the same length |
| **Collected** | Money received minus refunds, by the day it was received. Deposits are not included |
| **Outstanding now** | What customers still owe on rentals that are out or returned |
| **Deposits held now** | Deposits taken and not yet returned or kept |
| **Expenses** | Money the shop spent in the same dates |
| **Profit** | Earned minus expenses |

**Other parts of the page**

| Part | What it does |
|---|---|
| Search box | Finds by booking number, customer, phone or SKU |
| **Daily close** | Pick a day. A table shows money in, money out and net, for Cash, UPI, Card and Bank transfer. It includes deposits taken and returned, so it matches the cash drawer |
| **By branch** | A table of earned, collected, outstanding and deposits for each branch (shown to an owner with more than one branch). Beside it, **Ledger CSV** downloads every money record |
| **Expenses** | The list of expenses. **Add expense** (owner, manager), **Expenses CSV**. The owner can correct or delete an expense, and must give a reason |
| **Ledger Records** | Every booking and rental in the chosen dates. Buttons: **Refresh**, **Filter**, **Export PDF**, **Records CSV**. A row with a balance has **Record payment** |

**Adding an expense:** date, amount, branch, category (type your own or pick one: shop rent, salaries, dry-cleaning and laundry, tailoring and alterations, repairs, electricity and internet, marketing, transport, other) and a note. Amounts must be above zero and the date cannot be in the future.

**Problems**
- The date "from the first of this month" is set for you and shows as a filter tag. "Clear all" then switches to all time, which surprises people.
- **Earned** counts by pickup date, but the Ledger list is filtered by booking start date. The cards and the list can differ.
- **Collected** leaves out deposits, but the Daily close includes them. The page explains this only in small print.
- **Profit** is earned minus expenses. It is not a cash profit and it ignores refunds, but it is labelled simply "Profit".
- The expenses hint text (rent, salaries, cleaning, tailoring) is fixed for clothing shops.
- The Ledger list downloads every row in the chosen dates into the browser. This will slow down for a very big shop. The cards no longer have this problem.

## 5.5 Bookings (`/bookings`)

**What it is for:** every booking as a card, to find, check and open.

| Item | What it does |
|---|---|
| **New rental** | Goes to Inventory Search |
| Search | Customer, phone, booking number, SKU or description, as you type |
| Status filter | All, Booked (waiting for pickup), Out, Returned, Cancelled |
| Pickup date filter | All, Today, Tomorrow, or a chosen date |
| Branch filter | For owners with more than one branch |
| A booking card | Shows the number, status, customer, phone, pickup and return dates, "Buffer" days and the day the piece is free again, a money summary (Total, Paid, Rem, Dep), and the piece codes. Clicking opens the booking |
| **Completed Bookings** | A fold-out list. Pages of 60 with **Show more** |

**Problems**
- "Cancelled" in the filter also includes no-shows.
- "Rem" and "Dep" are short for Remaining and Deposit, and are cryptic.
- The "Buffer" is worked out from the days the piece is held, not from the cleaning days typed on the booking.

## 5.6 Inventory Search (`/scan`) and the cart

**What it is for:** find a piece or a product, see how many are free in each branch, add to the cart, and receive things back.

**Two tabs:** **Find and book** and **Receive back**.

| Item | What it does |
|---|---|
| The one box | Works with a USB scanner or by typing. Suggestions appear after two letters |
| **Camera** button | Scans a QR tag with the phone camera |
| **Clear** (x) | Empties the box |
| A piece found | Shows its status: Out on rental, Booked, Available, or the reason it is unavailable. Buttons: **Receive (return)**, **Booked on...**, **Add this piece to cart** |
| A product found | Shows a stock card per variation and branch: **Total, Avail, Rented**, with **Add to Cart** |
| **Active rentals** list | Who has this product out, with a **Return** button |

**How a scan is understood, in order:** a piece code first (in Receive mode, an "out" piece opens its return with that piece already ticked), then a booking number, then a SKU, then a name.

**The cart**
- It is kept in the browser, for each person and each shop.
- It holds one branch only. Adding from another branch asks: start a new cart, or keep the current one.
- **Checkout (n)** opens the booking form with the items.

**Problems**
- There is no "scan to hand over". A booked piece only shows a link to its booking.
- The cart stays across days. An old cart can quietly put old items on a new booking.
- The suggestion list cannot be used with the arrow keys.

## 5.7 All Rentals (`/all-rentals`)

**What it is for:** a picture grid of every product, to see stock at a glance.

- Filters: search, branch, stock (All, In stock, Out of stock), grid or list.
- A product card shows the photo, name, SKU, number of variations, the price range, and free-over-total per branch.
- Clicking a card opens the stock card (with **Add to Cart**), who has it out (with **Return**), **Edit product**, and **Done**.

**Problems**
- "/day" is fixed text, even for a product priced another way.
- **Edit product** shows to staff, who cannot edit.
- Sets always show, so the "Out of stock" filter never hides them.
- The numbers do not refresh by themselves. They are right only until the next change.

## 5.8 Calendar (`/calendar`)

**What it is for:** who has which piece, and when. One row for each piece, one bar for each booking.

- Controls: earlier, later, a date, Today, 7, 14 or 30 days, branch, category.
- Bars: Booked, Out, Returned, and a hatched tail for cleaning time. A red line marks now.
- Clicking a bar opens the booking. Clicking a free spot opens the booking form for that item.

**Problems**
- Every piece gets its own row. A shop with hundreds of pieces gets a very long page, with no search.
- Clicking a free spot does not pass the date you clicked.
- Colours are the only way to tell the states apart.

## 5.9 Customers (`/customers` and one customer)

**List**

| Item | What it does |
|---|---|
| Search | By name or phone. It runs when you press Enter |
| **New customer** | Name, phone, email, address, ID type and number, licence number and date, notes |
| The table | Name (with a "Blocked" tag), phone, whether an ID is on file, date added. **Load more** adds 50 |

**One customer**

| Item | What it does |
|---|---|
| **New booking** | Starts a booking for this customer (hidden when blocked) |
| **Block / Unblock** | Owner and manager. Blocking asks for a reason. A blocked customer cannot book |
| Three cards | Bookings, Paid in total, Owes now |
| **Details** | Edit the customer. **Save** works only when something changed |
| **Bookings** | The customer's bookings |
| **Measurements** | If the feature is on: a measurement set with notes |

**Problems**
- Staff can see "Paid in total" and "Owes now".
- There is no check for the same phone number twice, so one customer can be entered twice.
- Licence fields show for bridal customers, who do not need them.
- A customer cannot be merged or deleted.
- Measurements cannot be deleted.

## 5.10 Appointments (`/appointments`)

Shown only if the feature is on. Otherwise: "Appointments are not switched on for this shop. Ask Zypher to switch them on."

- Shows from yesterday to 14 days ahead, a panel for each day.
- **New appointment:** customer (search by name or phone), type (Fitting, Trial, Delivery, Collection, Inspection, Other), when, branch, notes.
- Each row has a tick (done), **Missed**, and a cross (cancel). Clicking a row edits it.

**Problems**
- Done, Missed and Cancel work at once, with no question and no undo.
- Two of the three row buttons are bare icons.
- There is no WhatsApp reminder for an appointment, and no check for overlaps or opening hours.

## 5.11 Products

### All Products (`/catalog`)
- Filters: search, category, stock status.
- Header buttons for owner and manager: **Print tags**, **Import**, **New set** (only if Sets is on), **Add product**.
- A table on a wide screen, cards on a phone. Columns: name and SKU, category, variations, daily price, total stock, branches, status.
- Row buttons: **Edit** (staff see **View**), **Reactivate** (for a switched-off product), **Delete** (owner only).
- **Delete** asks first. If the product was ever rented, it is switched off instead of deleted, so history stays.

### Add New Product (three steps, `/catalog/new`)
Owner and manager only.

| Step | What you do |
|---|---|
| 1. Basic Info | Product name, category, the product code (made for you from the category's base letters, for example BR-001, and cannot be typed), price per day, replacement value, description, photo (shrunk to about 0.4 MB) |
| 2. Attributes | Type values such as colours and sizes and press Enter. Suggestions help |
| 3. Variations and Stock | One row per combination, for example "Gold, M". Each row has a name, a code (BR-001-GOLD-M), a price per day, how many pieces in each branch, and a Bookable tick |

- When you save, the database creates the pieces in the same step, numbered one after another (for example BR-001-GOLD-M-1, BR-001-GOLD-M-2). If anything fails, nothing is saved.
- An owner can set stock for any branch. A manager only for their own. Stock can only go up here.
- An unfinished new product is kept in the browser, with a **Clear form** button.
- **Remove** is for owners. Editing a product uses the same three steps.

### Categories (`/catalog?tab=categories`)
Name, type, and a **Base SKU** of 2 to 6 capital letters (required for clothing). A category with products cannot be deleted.

### Extras (`/catalog?tab=extras`)
Things sold on top of a rental. Name, price, how it is charged (once per booking, per day, per unit per day, per guest per night), and "Offered now". Owner and manager can add and edit. There is no delete, only switch off.

### CSV Import (`/catalog/import`)
**Download sample**, choose a file, check the preview (first 50 rows), press **Import**. The product codes are numbered for you. Importing again updates names and prices and never removes anything.

### The pieces list on a product
- Add pieces by number. Change a piece's state: Available, In service or cleaning, In alteration (if that feature is on), Lost, Retired, with a reason.
- **Delete** a piece (fails if it has bookings). **Print tags** for the product.
- Only the owner and that branch's manager can do these.

**Problems**
- Staff who open `/catalog/[id]` see a full editable form. The database refuses to save, but nobody tells them first.
- The wizard saves only a "per day" price. A product that came with other prices (per hour, per week) may lose them when saved.
- Two people adding products at the same moment could get the same next code. The database catches the clash and shows an error.
- If the shop has no clothing category, the category box is empty with no explanation.
- Removing a product and deleting a piece use the browser's plain pop-up question, not the app's own styled one.
- Import checks nothing until you press **Import**, and then shows errors one at a time.
- A piece that comes back "damaged" is put in service automatically. Only an owner or branch manager can free it again, from the pieces list, which staff cannot reach.

## 5.12 Stock Locations (`/stock-locations`)
Only a Zypher support login can open it. For each branch it shows phone, address, and counts: pieces, free, out, in service, lost. **Print tags** is at the top.

**Problem:** the shop's own owner cannot open it, even though it is their own stock.

## 5.13 Shop settings (`/settings`)
Owner only.

| Panel | What it holds |
|---|---|
| Your Overbooked plan | Plan, paid until, days left, monthly fee, how to pay Zypher, a list of payments with a receipt link for each |
| Shop details | Name (read only: "Ask Zypher to change it"), phone, email, address, GST number |
| Rules | Grace minutes before late charges |
| Receipts | GST percent included in prices, SAC code, a note printed on every receipt |
| Optional features | A read-only list showing which features are on. Zypher changes them |

**Save** stores the changes and reloads the page.

**Problems**
- The grace time text talks about hourly and nightly rentals, which do not apply to clothing.
- Zypher's bank details show to every owner here.
- Nothing here says that branches and staff are set up by Zypher.

## 5.14 The booking form (`/book`)

**What it is for:** to create a booking, or to change one that has not been picked up.

The title is "Create Booking", or "Change booking" when editing. At the top: **Close (keep draft)** and **Discard draft** (it asks first). The form saves a draft in the browser as you go.

**The order of the form is on purpose: dates first.**

| Panel | What it holds |
|---|---|
| **When** | Branch (locked for a manager or staff), pickup date and time, return date and time, **cleaning days** (days the piece is kept back after return; blank means none). A line shows "Cleaning: n days. Free again: date" |
| **What** | A search box, category chips, and a button for each variation with its price and "n of m free" |
| **Cart** | Each line shows its price working, a quantity stepper, and an **Agreed price** box for that line. Extras are tick boxes. **Discount** and **Deposit agreed** sit here too. A live quote shows Items, Extras, Discount, Total |
| **Customer** | Phone and name. A returning customer is suggested. A blocked customer shows a warning. An optional section for ID, email and address |
| **Paid now** | Advance with a method, Deposit received with a method, Notes, and "Balance after this". Then **Confirm booking** |

**Rules the form follows**
- **Customer and payment stay locked** until the dates are valid, at least one item is chosen, and every item has a free piece for those dates.
- Each piece is chosen from a list of free pieces. The first free one is picked for you and you can change it.
- Pieces of a set are picked automatically.
- A start date in the past is refused. A blocked customer is refused. A discount larger than the total is refused. An advance larger than the balance is refused.
- If someone else just took the piece, the form says so and asks you to choose again.
- After saving, the cart is cleared and the booking opens with the WhatsApp confirmation box.

**Problems**
- Any role, including counter staff, can type any discount or agreed price up to the total. Nobody approves it and no reason is asked. It is logged, but only the owner and manager can read the log.
- The deposit received is never compared with the deposit agreed.
- "Agreed price" is the price of the whole line, not per day, and the label does not say so.
- Taking an item out with the minus button asks nothing.
- Changing a booking later does not let you change the customer or the payments.
- The form for non-clothing shops has no "dates first" lock and no cleaning days, so the same form behaves differently.
- A half-typed customer stays in the browser. On a shared counter computer someone could see it.
- Phone numbers are not checked for a valid shape.

## 5.15 The booking page (`/rentals/[id]`)

**What it is for:** everything about one booking, and the place to hand over, return, take money, change or cancel it.

**Header buttons:** **Hand over** (when booked), **Mark returned** (when out), **Money**, **WhatsApp**, **Print**, and **More actions**.

**The More actions menu**

| Item | Who | When |
|---|---|---|
| Change booking | Everyone | Only before pickup |
| Extend | Everyone | Booked or out |
| Give another unit | Everyone | Booked, with held pieces |
| Add a charge | Owner, manager | Any open booking |
| Notes | Everyone | Always |
| Alteration | Owner, manager | Open booking with clothes, feature on |
| Add appointment | Everyone | Feature on |
| Cancel booking | Everyone | Only before pickup |
| Change discount | Owner | Any booking not cancelled |
| Delete booking | Owner | Only finished or cancelled bookings |

**Panels on the page:** When, Items (with a pencil to change a price, for owners), Handover record (condition, notes, photos), Money, Payments (hidden from staff; an owner can correct or delete a payment), Appointments, Measurements, Customer.

**Banners:** one if a piece is in service or at the tailor ("Ready again" button for owner and manager), and a red one when the rental is overdue or not picked up.

**Problems**
- Staff can change a booking's price, cancel it and refund the money, and extend it. The database allows all three.
- The same thing is called Money, Payments, Record money and Record payment in different places. Pickup, Hand over and Start are all used. Return, Receive and Mark returned too. Booking, rental, token and number are used for the same thing.
- A booking that has been handed over cannot be cancelled, and nothing says what to do instead.
- "Delete booking" is offered whenever the rental is not open, and the question does not make it clear that it cannot be undone.

## 5.16 Hand over (pickup) box

- Title "Hand over: number". For each piece: condition (Good or Damaged), notes, and up to eight photos (a camera works).
- **Payment now** (filled with the balance) and **Deposit now** (filled with the deposit still due), each with a method.
- The database refuses to hand over a piece that is in service, lost or retired. It says: swap it first.
- Handing over before the planned start is allowed with no question.

**Problems**
- For clothing, the return step ticks every piece, but the hand-over step does not. A wrong piece can be handed over without anyone noticing.
- "Damaged" can be chosen at hand-over with no warning and no effect.
- Payment and deposit are optional, so a dress can go out with no deposit even if one was agreed. Nothing warns.
- Photos are uploaded before the booking is saved. If saving then fails, the photos stay behind.

## 5.17 Return (Mark returned) box

| Part | What it does |
|---|---|
| **Returned at** | Date and time, now by default. It cannot be in the future. More than 2 hours in the past needs a manager or the owner and is written to the audit log |
| **Pieces received** | Type or scan each piece's code, use the camera, tap a piece, or press **All received**. Every piece must be received or marked lost before saving |
| Each piece | Condition: Good, Damaged, or Lost. Notes and photos |
| **Charges** | The system suggests a late fee. A piece marked Lost adds a "Lost item" charge equal to its replacement value, and you can change it. **Add charge** adds any other charge: late return, damage, cleaning, alteration, other and more |
| **Money** | Total so far, charges, new total, paid, balance due, deposit held. Fields: **Keep from deposit**, **Payment now**, **Deposit returned**. They are filled sensibly and you can change them |
| **Mark returned** | If money stays unpaid or a deposit stays held, the screen asks: "... will stay unpaid. Mark returned anyway?" |

What the database does next: a damaged piece goes to service, a lost piece is marked lost, and the other pieces are free again after the cleaning days.

**Problems**
- A rental can only be returned as a whole. There are no part returns. The ticks are not saved.
- "All received" removes the point of scanning each piece.
- Any role can lower or remove the suggested late fee at return. Adding a charge later is for owners and managers only.
- Marking a piece "Damaged" does not suggest a charge.
- The lost-charge row is found by its exact text "Lost: code". Editing that text creates a second charge.
- The unpaid and deposit question is the browser's plain pop-up, not the app's own box.
- The deposit-returned box is filled with the full remaining deposit, so clicking through gives money back before anyone checks the dress.
- The late fee uses the catalogue day price. It ignores an agreed price, and there is no grace time for clothes.

## 5.18 Money box (take or return money)

- Kinds: **Payment**, **Deposit received**, **Deposit returned**, **Keep deposit for the balance**.
- **Deposit returned** while the piece is out is for the owner only. After the return, anyone can give it back.
- Fields: amount (filled with a suggestion), method (Cash, UPI, Card, Bank transfer), note.
- The database refuses more than the balance or more than the deposit held.

**Problems**
- There is no "Refund" kind. Refunds exist only through Cancel.

## 5.19 Cancel and no-show box

- A cancellation fee (never more than what was paid), the refund and deposit returned (worked out), a method, a reason.
- A tick for "did not come (no-show)" appears once the planned start has passed.
- The deposit is always given back in full, even for a no-show.

**Problems**
- The red cancel button works at once. Cash goes out and nothing asks twice.
- The text says "booked units are freed". For clothing it should say pieces.

## 5.20 Extend, swap, alteration, charge, notes and corrections

| Box | What it does | Notes |
|---|---|---|
| **Extend** | New return time (a day later by default) and an optional payment. Prices that follow a rate are recalculated, agreed prices stay | No price preview before you press it. Staff can use it |
| **Give another unit** | Choose a held piece, then a free piece of the same item in the same branch | Only for booked rentals, not for a piece already out |
| **Alteration** | Choose the piece, say what to alter, add an optional charge, tick "going to the tailor now" | Adds the charge and blocks the piece in two steps. If the second fails, the customer is charged but the piece is not blocked |
| **Add a charge** | Type, amount, note. Owner and manager | |
| **Notes** | Free text | |
| **Owner corrections** | Change a discount, change a line price, correct or delete a payment, remove a charge, delete a booking. Each needs a reason of at least 3 characters and is written to the audit log | Owner only. Support cannot do them |

## 5.21 Measurements
If the feature is on. A measurement set per customer with a label, a field per measurement (the clothing type has 16, such as chest and waist), and notes. Shown on the booking page and the customer page. **Problem:** measurements cannot be deleted and have no unit.

## 5.22 WhatsApp messages
- Four messages: Booking confirmation, Reminder before pickup, Reminder to return, and Thank you and receipt. You can edit the text before pressing **Open WhatsApp**. It opens WhatsApp on the staff member's own phone or computer with the text filled in. Pressing it also records that a reminder was sent.
- Dashboard buttons add an "overdue" text.
- The country code 91 is added when the number has 10 digits.

**Problems**
- Nothing is sent automatically. Staff press a button for every message.
- There is no balance-due message, no cancellation message and no appointment reminder.
- The texts are fixed English. They do not list piece codes or the deposit due.
- The thank-you message says "complete" even if charges are still open.

## 5.23 Receipts and tax invoices (`/print/rental/[id]`)

- An A4 page with **Print or save as PDF** and **Back**.
- **Title:** "Receipt", "Cancellation receipt", or "Tax invoice".
- **Tax invoice rules:** the shop must have a GST number and a GST percent above zero, and the rental must be returned. The invoice then has its own number, such as `KAL/2627/0001` (shop prefix, financial year, running number, at most 16 characters), and a fixed date. It shows the taxable value, half CGST and half SGST, and "Prices include GST", with the SAC code if one is set.
- Before the return, the page prints a plain receipt with a note that the invoice comes at return.
- It also shows lines, extras, charges, payments, a deposit summary, the shop's note, and the shop logo if there is one.

**Problems**
- Opening the page for the first time creates the invoice number. Merely viewing has an effect.
- No piece codes, no customer GST number, no per-line SAC code, and no sign of place of supply. Only CGST and SGST are supported, not IGST.
- Back does nothing if the page opened in a new tab.
- Staff can print it, and it shows the payment list that the booking page hides from them.
- The footer always says "Generated by Overbooked".
- The SAC code and the invoice timing need an accountant's check.

## 5.24 Tags (`/print/tags`)
Choose a branch, category and item, and a label size (small 38 by 25 mm, medium 50 by 30 mm, large 70 by 40 mm). Each piece gets a QR code holding its code. Click a tag to leave it out. **Print n tags**. Up to 5,000 pieces.

**Problems:** staff cannot see the link but can open the address. There is no "only tags not printed yet" filter.

## 5.25 The camera scanner
Used in Inventory Search and the return box. **Problem:** the close button is a bare "x" with no label for screen readers, it does not close on Escape, and it changes how the page handles video while it is open.

## 5.26 Screens for resort, car and bike shops

> **What this means for you:** these shops get an older set of screens. They work and pass the automatic tests, but they were not the focus. A bridal shop never sees them.

**Menu:** Today, New booking, Bookings, Calendar, Appointments (feature), Customers, Catalog (named with the shop's own word), Money and reports (owner and manager), Shop settings (owner).

| Screen | What it does |
|---|---|
| **Today** | A "New booking" button. A search box for booking number, customer name or phone, or unit code, with a scan button. A **Reminders** panel: "Starts tomorrow", "Due back today", "Overdue", each with a WhatsApp button and a tick for "already reminded". Cards: To hand over, Due back, Out now, Next 7 days. Lists of the same, plus appointments today and coming up this week |
| **New booking** | The same booking form, but without the "dates first" lock and without cleaning days. Rooms ask for check-in and check-out and the number of guests. Vehicles ask for licence details and may have a driver |
| **Bookings** (`/rentals`) | Tabs: Booked, Out now, Overdue, Returned, Cancelled, All. Search runs when you press Enter |
| **Calendar, Customers, Appointments** | The same as for clothing shops |
| **Catalog** | Tabs: Items, Extras, Categories. One row per variation. The editor has every price type, guest numbers, free kilometres and turnaround hours |
| **Money and reports** | Presets (Today, Last 7 days, This month, Last month, chosen dates) and a branch. Cards: Money in, Booked value, Still owed, Deposits held, Deposit kept, by payment method. A money-records table (latest 300 on screen, all in the CSV) and a "Stock right now" table |

**Extra things on the hand over and return boxes for vehicles:** odometer and fuel at pickup and return, a licence check, and a tick that the original licence and ID were seen. The return refuses an odometer lower than at pickup.

**Problems**
- There are no Expenses or Profit for these shops.
- "Money and reports" and "Finance" give different numbers for the same dates, because they define "revenue" differently, and nothing explains it.
- The Reminders panel exists only here, so bridal shops get a weaker reminder workflow than car shops.
- A shop with clothing and another type loses the clothing screens.
- The bookings search works on Enter, while the search on the clothing screens works as you type.
- These screens have only a basic "opens without errors" test.

# 6. Tour of the Zypher console

> **What this means for you:** the console is your control room. It is for setup and billing only. It was built so that you never have to look at a shop's private business.

## 6.1 Who can open it
- Only Zypher staff. The pages are checked on the server, and every action in the database checks again.
- Zypher staff must use the six-digit code. Until they do, the database treats them as having no role.
- All Zypher staff have equal power. There is no "billing only" or "setup only" kind of Zypher login.

## 6.2 The menu
Overview, Shops, New shop, Billing, Business types, Audit log, Zypher team, Settings, your name and Sign out. On a phone it is a drawer.

## 6.3 Overview (`/zypher`)

| Item | What it shows |
|---|---|
| **New shop** button | Starts the new shop steps |
| Cards | Active shops (and how many are paused), Monthly fees (total of active shops), Collected this month, Overdue (and due in 7 days), Rentals in 30 days, Units managed, Active logins, Shops |
| **Payments to chase** | Overdue or soon-due shops, with **Record payment** |
| **Not using it** | Active shops with no booking in 30 days |

## 6.4 Shops (`/zypher/shops`)
A search box (name, web name, prefix) and filter chips: All, Overdue, Due soon, Paid, Trial, Paused. The table shows shop, business, plan and fee, billing status, paid until, branches, logins, and rentals in 30 days. A shop in its 14-day trial shows "Trial, n days left". Clicking a shop opens its page.

## 6.5 New shop (`/zypher/shops/new`), four steps

| Step | What you enter |
|---|---|
| 1. Business type | Tick one or more: Clothing rental, Resort, Car rental, Bike rental. Each card shows the wording, how time is counted and the default extras |
| 2. Shop and plan | Shop name, web name (made from the name), booking prefix of 2 to 6 capitals (made from the name; the preview reads like KAL-2026-0001), monthly fee, plan (Starter, Pro, Business), phone, email, address |
| 3. Branch and owner | First branch name (default "Main"), owner name, owner email |
| 4. Review | A summary, then **Create shop and owner invite** |

- **What the database builds:** the shop, the first branch, one category for each business type (a clothing category starts with the base letters CL, which the shop can change), and the default extras (all priced at ₹0). A 14-day trial starts.
- **After it:** a one-hour owner link to copy, with **Open the shop page** and **Create another shop**. No email is sent. You share the link by hand, for example on WhatsApp.
- If the invite fails, the shop still exists. Use **Invite owner** on the shop page.
- A taken web name says so.

## 6.6 One shop (`/zypher/shops/[id]`)

**Header:** badges (web name, prefix, billing, business types, "Client since"), and buttons **Record payment**, **Invite owner**, and **Pause** or **Resume**. Pause asks first: everyone in the shop is signed out, and the data stays. Resume works at once.

**Three tabs:** Overview, Branches, Staff.

**Overview tab**
- Four cards: Paid until, Rentals in 30 days, Units, Last booking.
- **Plan and details:** name, plan, monthly fee, phone, email, address, and **Zypher notes** that the shop never sees (this is enforced by the database). Save works only when something changed. A downgrade below the shop's current branches or logins is refused.
- **Business types and features:** the types are shown. **Add a business type** adds a category and its features (default extras are not added to a shop that already exists). One on/off switch for each optional feature.
- **Branches:** a short list with **Manage branches**.
- **People:** each person's role and branch, "Inactive", email, last sign-in, and open invites.
- **Payments to Zypher:** received date, amount, method, what it was for, and a **Receipt** link.

**Record payment box**
- Type: Subscription, Installation, Other.
- Quick chips: 1, 3, 6 or 12 months fill "covers until" and the amount (fee times months).
- Fields: amount, method (Bank transfer, UPI, Cash, Cheque), received on, covers until (subscriptions), note.
- Each payment gets a receipt number like `ZYP-2026-27-0001`. A subscription payment moves "paid until" forward.

**Branches tab**
- **Add branch.** A table with name, contact, number of people, and an Active or Closed tag you can click.
- Per row: **Edit** and **Delete**. Delete works only for a branch with no people, pieces or bookings. Otherwise close it.
- Branch limits of the plan are enforced. A closed branch does not count.
- This page deliberately shows no stock, customers or bookings.

**Staff tab**
- **Invite a person:** full name, email, role (owner, manager, staff, Zypher support), branch (required for manager and staff). The plan's login limit is checked first and the message is clear.
- The people table: a role box (a change asks first), a branch box, an Active or Inactive tag (switching off asks first), "Invite pending", and a button **New invite link** or **Login link** that makes a fresh one-hour link, used when an invite expired or a password was forgotten.
- Rules: you cannot change yourself, the last active owner cannot be switched off, and you cannot make a link for another Zypher person.

## 6.7 Billing (`/zypher/billing`)
- Cards: Monthly fees, Collected in the month, Overdue, Due within 7 days.
- **Due now:** each shop with its paid-until date and fee, and two buttons: **WhatsApp reminder** (a ready message with the amount and your bank details) and **Record payment**.
- **Payments received:** pick a month and see each payment with its receipt.

## 6.8 Business types (`/zypher/templates`)
Read only. For each type: wording, fields, price kinds, turnaround, pickup and return checks, optional features and their default state, default extras. A new type needs a developer.

## 6.9 Audit log (`/zypher/audit`)
A shop box (All or one) and a table: When, Shop, What (Deleted or Changed and the table), By, Reason, and a **Details** button showing Before and After. **Load more** adds 100.

## 6.10 Zypher team (`/zypher/team`)
People with email, last sign-in, Active or Off. **Add a person** (name and email) gives a one-hour link and makes them Zypher staff. **Turn off** and **Turn on**. You cannot lock yourself out, and at least one active Zypher login must remain.

## 6.11 Settings (`/zypher/settings`)
- **Zypher's details (on receipts):** company name, address, phone, email, GST number (optional).
- **Where shops pay:** bank and UPI details. Shown to shop owners and used in the WhatsApp reminder.
- **Automatic pause:** a number of days. Empty means never. **Check now** pauses shops that qualify right now. The page says the job runs every night at 1 am India time.

## 6.12 What Zypher can and cannot see
- **Cannot see:** customers, bookings, payments, money, products and prices, pieces, appointments, measurements, handover and ID photos, the shop's dashboard. This is tested.
- **Can see:** counts (units, rentals in 30 days, customers, products), setup and billing records, and the audit log of setup and billing changes.
- **Two exceptions:** a **support** login sees everything in one shop, and Zypher can make a login link for any shop person, including an owner.

## 6.13 Problems in the console
These are listed again, ranked, in Part 8 (group F). In short:
- No data export, no clean way to end a shop, and no price list.
- The trial length is fixed at 14 days and cannot be changed or extended from the screen.
- A ₹0 shop shows "Overdue" forever. "Monthly fees" counts trial and ₹0 shops, so it overstates income.
- A shop that never paid is paused the first night after its trial ends. Resuming a shop without recording a payment gets it paused again the next night.
- The audit page says "every deletion and correction" but Zypher can no longer see money corrections, and it shows "By: Unknown" for shop people.
- A wrong payment date cannot be fixed from the screen, and "paid until" never moves back.
- Reminders are by hand and not recorded.
- One email can have only one open invite across all shops. Re-inviting an owner whose first link expired fails with "already has an account".

# 7. The money rules in plain words

> **What this means for you:** these are the rules the database keeps no matter what anyone clicks. They are the heart of the trust you are selling.

## 7.1 Rules that can never be broken
- **Total = items + extras + charges − discount.** The database works the total out itself. Nobody types it.
- **Paid is never below zero and never above the total.** So the balance is never negative.
- **Deposit given back plus deposit kept is never more than deposit received.**
- **No amount is negative.** Amounts are in rupees and paise.
- **A return date is after the start date.**
- **One piece can never be booked twice for overlapping times.** The time includes the cleaning days after the return.
- **A piece that is out past its due date is not offered to a new booking** until it comes back.
- **The figures on Finance are added up from the money records themselves,** so they always match them.

## 7.2 Rules about time and people
- A booking cannot start on a past date.
- A return cannot be in the future. A return more than 2 hours in the past needs a manager or the owner and is written to the audit log.
- A blocked customer cannot book. Only a manager or the owner can unblock.
- The deposit goes back at return or at cancellation. The owner alone can give it back while the piece is out.
- A cancellation fee cannot be more than what was paid. A no-show can be marked only after the planned start.
- A branch cannot be closed while it has open rentals.
- Clothing product codes follow a pattern: 2 to 6 capital letters, a hyphen, 3 or 4 digits (BR-001), then more parts for variations (BR-001-GOLD-M).

## 7.3 Numbers the system makes
- **Booking number:** shop prefix, year, running number, such as `KAL-2026-0001`. It counts per shop.
- **Tax invoice number:** `PREFIX/FY/NNNN`, at most 16 characters, fixed once issued.
- **Zypher receipt number:** `ZYP-FY-NNNN` by Indian financial year.

## 7.4 What the Finance words mean

| Word | Meaning | Counted on |
|---|---|---|
| **Earned** | Value of rentals picked up, plus cancellation fees | Pickup date, or cancellation date for fees |
| **Collected** | Payments received minus refunds, not counting deposits | The day the money was received |
| **Outstanding now** | Balance still owed on rentals that are out or returned | Right now |
| **Deposits held now** | Deposits taken and not returned or kept | Right now |
| **Expenses** | Money the shop spent | The date of the expense |
| **Profit** | Earned minus Expenses | The chosen dates |

**Careful with Profit.** It is not cash in hand. It leaves out refunds and counts a rental on the day it went out, even if the customer has not yet paid.

## 7.5 The audit log
Every deletion, every owner correction, every setup change by Zypher and every backdated return is written down, with who did it, when, and the reason. Users cannot change or delete these entries. They are kept forever. Price changes (a discount or an agreed price) are kept in their own list, which owners and managers can read, with who made the change.

# 8. What is wrong or risky today

> **What this means for you:** this is the honest list. Nothing here stops the product from working. Each line says how serious it is, why it matters, and the simplest fix. "High" means fix before a real shop goes live. "Medium" means fix in the first month. "Low" means fix when convenient.

## How I checked
- Two reviews read every screen and every console page. Another read the folders, GitHub files and documents.
- I then confirmed the most serious claims in the code myself. For example: counter staff can cancel and refund (confirmed), can extend a rental (confirmed), can change a booking's price (confirmed); only an owner or a branch manager can free a damaged piece (confirmed); the Stock Locations page is for support only (confirmed); the pickup box has no piece-by-piece check (confirmed); the old fixed labels "Rental Studio" and "Staff panel v2.0" (confirmed).
- Anything I could not confirm is marked "not confirmed".

## Summary count

| Group | What it covers | High | Medium | Low |
|---|---|---|---|---|
| A | Screens and daily flow | 3 | 10 | 9 |
| B | Money and safety | 3 | 4 | 2 |
| C | Code and folders | 1 | 6 | 7 |
| D | GitHub | 4 | 3 | 3 |
| E | Running it online | 4 | 6 | 1 |
| F | Zypher console and billing | 2 | 7 | 4 |
| G | Privacy | 3 | 2 | 0 |
| H | Documents out of date | 1 | 5 | 4 |
| I | Tests | 0 | 4 | 2 |

## A. Screens and daily flow

| ID | Severity | Problem | Why it matters | Suggested fix |
|---|---|---|---|---|
| A1 | High | Counter staff can type any discount or agreed price, change a booking's price, cancel and refund, and extend a rental. Nobody approves it | A dishonest or careless person can give away money. The log exists but only owners and managers read it | Decide a limit for staff (for example a maximum discount), and require a manager for cancel with refund and for price changes. Enforce it in the database |
| A2 | High | A piece marked damaged at return goes "in service" and only an owner or branch manager can free it, from a screen staff cannot reach. The booking page does not show "Ready again" for a returned booking | Stock quietly disappears from availability. Shops will think pieces are missing | Show "Ready again" on the returned booking, and add a plain "Back in stock" button for managers on the dashboard |
| A3 | High | A shop with clothing and another business type loses all the clothing screens | A bridal shop that also rents cars gets the wrong screens | Either do not allow mixed shops yet, or make the clothing screens work for mixed shops |
| A4 | Medium | Clothing hand-over does not check each piece, but return does | A wrong piece can go out unnoticed | Add the same "scan or tick each piece" step to hand-over |
| A5 | Medium | Any role can lower or remove the suggested late fee at return | Late fees can vanish at the counter | Make the suggested fee fixed for staff; only a manager can change it |
| A6 | Medium | The deposit-returned box defaults to the full deposit | Money can be given back before the dress is checked | Start it at zero until each piece is marked good |
| A7 | Medium | The late fee uses the catalogue day price, ignores agreed prices, and has no grace time | Charges may not match what was agreed. This is a business rule that needs your decision | Decide the rule (see Part 12) and build it |
| A8 | Medium | A booking handed over cannot be cancelled and nothing explains what to do | Staff get stuck | Add a clear note and an owner-only "void with reason" |
| A9 | Medium | Cancel works at once with no second question, and cash goes out | A mis-click refunds money | Add a confirmation that names the amount |
| A10 | Medium | The same thing has many names: booking, rental, token, number; Hand over, Pickup, Start; Return, Receive, Mark returned; Money, Payments, Record money; unit, piece, item | Training is harder, support messages are confusing | Choose one word for each and use it everywhere |
| A11 | Medium | Both the dashboard and the Bookings page count a missed pickup as "today" and an overdue return as separate | Staff look in two places | Show "missed pickups" and "overdue returns" as clearly named groups |
| A12 | Medium | Staff can open the product edit screen and the All Rentals "Edit product" link, then the database refuses | Looks broken | Hide or disable it for staff |
| A13 | Medium | The cart stays across days | An old cart can end up on a new booking | Clear a cart when it is more than a day old, or show its age |
| A14 | Low | The "Edit" button on the dashboard only opens the booking | Misleading name | Rename to "Open" |
| A15 | Low | The WhatsApp button opens a link even with no phone number | A useless link | Disable the button when there is no number |
| A16 | Low | Appointments: done, missed and cancel act at once with no undo | Mis-clicks | Add an undo toast |
| A17 | Low | The Calendar has a row for every piece and no search | A very long page for big shops | Group by product, add a search |
| A18 | Low | Customers: no duplicate phone check, cannot merge or delete, licence fields show for bridal | Messy data | Warn on a repeated phone number and hide the licence fields for clothing |
| A19 | Low | Measurements cannot be deleted | Wrong entries stay | Add a delete for owner and manager |
| A20 | Low | The camera scanner close button has no label and no Escape | Hard for some users | Add a label and the Escape key |
| A21 | Low | Fixed text such as "/day", "Rental Studio", "Staff panel v2.0", and the clothing words in generic boxes | Looks unfinished, wrong for other shop types | Replace with the shop's own words |
| A22 | Low | Native browser pop-ups mix with the app's own boxes | Inconsistent look | Use the app's own box everywhere |

## B. Money and safety

| ID | Severity | Problem | Why it matters | Suggested fix |
|---|---|---|---|---|
| B1 | High | Opening a receipt page for the first time creates the tax invoice number | Anyone who opens the page changes data | Issue the invoice from a clear button, or when the rental is returned |
| B2 | High | The tax invoice lacks customer GST number, place of supply, IGST and a per-line SAC code. The SAC code is optional text | A GST-registered customer may not accept it | Get the accountant's list of what is needed, then add it |
| B3 | High | A wrong Zypher payment cannot be corrected from the screen. "Paid until" only moves forward | A typo such as the year 2036 gives a shop free service until then | Add "void with reason" for Zypher payments |
| B4 | Medium | Staff can read no payments list, but can take a payment and print a receipt that shows it | Inconsistent privacy | Decide what staff may see and make the screens agree |
| B5 | Medium | Alteration adds a charge and blocks the piece in two separate steps | The customer can be charged while the piece stays bookable | Do both in one database step |
| B6 | Medium | Photos are uploaded before the booking is saved | Stray photos stay behind if saving fails | Save first, then attach the photos, or clean up |
| B7 | Medium | Staff can block a customer through the database, though the screen hides it | A rule only the screen enforces | Add a database rule |
| B8 | Low | The WhatsApp texts and the receipt mention "complete" even with open charges | Wrong promise to the customer | Make the text follow the real state |
| B9 | Low | Profit is labelled simply "Profit" though it ignores refunds and unpaid amounts | Owners may read it as cash | Add a short explanation next to it |

## C. Code and folders

> **What this means for you:** the code works and is well tested where it matters most (the database). The folders are somewhat confusing and some screens are very large. This slows a new developer down and raises the chance of mistakes. None of it stops launch.

**The folders in plain words**

| Folder | What is in it | Is it clear? |
|---|---|---|
| `src/app/(shop)` | The shop's screens | Mostly. The brackets only group files |
| `src/app/zypher` | The console | Yes |
| `src/app/actions` | The small server programs that use the all-powerful key | Yes |
| `src/components/ui` | 46 ready-made building blocks (buttons, boxes) | Only 6 are used by a screen. The rest are not used |
| `src/components/shop` | Pieces of the shop screens | Mixed with generic pieces |
| `src/components/overbooked` | Five more generic pieces | Confusing: the product's name used as a folder |
| `src/lib/overbooked` | The sign-in context and the shop name | Same confusion |
| `src/lib/shop` | Money and date helpers, types, data helpers | Yes |
| `src/modules/clothing` | Clothing-only code: cart, menu, dashboard, product steps, ledger PDF | Only part of the clothing code lives here |
| `supabase/migrations` | The 28 database changes, in order | Yes |
| `docs` | 12 documents | Several are out of date |

| ID | Severity | Problem | Why it matters | Suggested fix |
|---|---|---|---|---|
| C1 | High | The database types file (1,267 lines) is generated but nothing uses it. About 29 places force the type with `as unknown as` and 9 use `any` | A wrong column name is found only when the screen runs, not when the code is checked | Pass the types to the database connection and remove the forced casts |
| C2 | Medium | There are two versions of the same screens: one for clothing shops, one for the others. About 60 places in the shop pages branch on the clothing flag | Every fix may need doing twice | Decide whether car, bike and resort stay in the first release. If not, hide or remove them |
| C3 | Medium | Clothing code sits in three places: the clothing module, the shop screens and the shop components. The rule that stops modules mixing mentions modules that do not exist | A new developer cannot tell where to look | Move the clothing screens into the clothing module and keep thin route files |
| C4 | Medium | The booking form is one 800-line file with several warnings switched off | One change can break the money logic | Split into the form, the availability check and the totals |
| C5 | Medium | 18 lint warnings are switched off, mostly in the booking form and the hand-over and money boxes | They can hide screens showing old data | Review each and fix |
| C6 | Medium | Lint also ignores unused variables and `any` | Leftover code is invisible | Turn them on as warnings |
| C7 | Medium | No `loading` pages and about 14 empty error catches. Some failed loads show nothing | A broken screen looks empty | Show an error line whenever a load fails |
| C8 | Low | About 40 of the 46 building blocks are not used by any screen, and about 11 packages (recharts, embla, vaul, cmdk, input-otp, react-resizable-panels, react-day-picker, react-hook-form, and three that nothing imports: @hookform/resolvers, date-fns, pg) are only used by those or by nothing | Slower installs, more to keep updated, more to attack | Delete the unused files and remove the packages |
| C9 | Low | Leftover TRENDZ names: the `trendz` flag, `TrendzDashboard`, comments in about 20 files, a TRENDZ audit document | Confusing, and wrong for a product sold to many | Rename to `clothingLayout` and `ClothingDashboard` |
| C10 | Low | Two helper files for buttons and inputs, and three copies of the rupee formatter | Changes must be made twice | Merge |
| C11 | Low | India fixed in about 26 places (₹, "en-IN", "Asia/Kolkata"), and "Overbooked" typed in about 25 | Hard to rename or sell elsewhere | One brand setting and one format helper |
| C12 | Low | The shop pages check who you are in the browser, while the console checks on the server | The database still protects the data, but a server check is better | Add a server check to the shop area |
| C13 | Low | No unit tests for date, money formatting, cart, CSV and WhatsApp text | Date and time zone code is where bugs hide | Add a small test set |
| C14 | Low | `package.json` lacks a Node version; `tsconfig.tsbuildinfo` sits in the root (not saved to GitHub) | Small tidiness | Add the Node version, ignore the file |

## D. GitHub

> **What this means for you:** GitHub is where the code is kept safe and reviewed. Today the safest copy is only on this laptop.

**The branches today**

| Branch | State |
|---|---|
| `feature/safe-foundations` (current) | 16 commits ahead of the saved `main`, never pushed |
| `development` | Only on this laptop. Never pushed. Two commits behind the current branch |
| `main` | The copy on GitHub is ahead of the one on this laptop by one merge |
| `feature/trendz-screens`, `multi-shop`, `v2-engine` | Old, already merged or redundant. Can be deleted |

| ID | Severity | Problem | Why it matters | Suggested fix |
|---|---|---|---|---|
| D1 | High | Nothing from 26 to 29 October is on GitHub | If this laptop fails, the work is lost | Push the current branch now. It is a backup, not a launch |
| D2 | High | The file that names who must approve changes (`CODEOWNERS`) holds a made-up name | The review rule cannot work | Put in the real GitHub name |
| D3 | High | Protection for `main` and `development` is not confirmed. I cannot see GitHub settings from here | Anyone with access could change the live branch directly | On GitHub: require a pull request, the three checks, and a review; block force pushes |
| D4 | High | If the repository is public, backup files made by the backup job could be read by any GitHub user | The data copy would be exposed, held only by its password | Keep the repository private. Use a long password |
| D5 | Medium | The automatic checks (`ci.yml`) have never run on GitHub. They use the "latest" database tool, so an update can break them with no change from you | Checks may fail the first time or break later | Run them once; fix the tool version |
| D6 | Medium | The backup job has never run, is off, does not copy photos, has no failure alert, and has never been restored | A backup nobody has restored is a hope, not a backup | Parked by you. Needs a decision (Part 12) |
| D7 | Medium | No version tags and no real releases. The changelog is one long "unreleased" section | You cannot say "this is what shop X runs" | Tag each release and write the changelog per version |
| D8 | Low | Some commits are very large and mix many things | Hard to review or undo | Smaller commits from now on |
| D9 | Low | No SECURITY.md and no licence note | Nobody knows who to tell about a flaw | Add both |
| D10 | Low | The update bot opens many small pull requests with no grouping | Noise | Group related updates |

## E. Running it online

| ID | Severity | Problem | Why it matters | Suggested fix |
|---|---|---|---|---|
| E1 | High | No online test copy and no online live copy exist. No domain. No email sender | Nothing can be sold yet | Follow the go-live steps in Part 11 |
| E2 | High | No error alerts, no "is it up" check, no log watching | You learn of a problem from an angry shop | Add an error tracker and an uptime check before the first paying shop |
| E3 | High | Backups: only Supabase's 7 days (paid plan). Photos not covered. No restore ever tried | A mistake found after a week cannot be undone | Parked by you. Plan: daily dump kept 30 days, weekly kept 12 weeks, monthly kept 12 months, in storage outside Supabase |
| E4 | High | The secret key that bypasses all rules (`SUPABASE_SERVICE_ROLE_KEY`) must live only on the live server | If it leaks, every shop's data is open | Keep it only in the hosting server settings. Never in files, chat, browser code or the build |
| E5 | Medium | One database for all shops | A bad update or an outage touches all shops | Test copy first, a backup before every update, keep the isolation tests as a release gate |
| E6 | Medium | The security headers allow inline scripts (`unsafe-inline`) | Weakens protection against injected scripts | Move to a nonce-based setup later |
| E7 | Medium | `robots.txt` lets search engines index the app | The login page appears in search | Block everything for the app |
| E8 | Medium | The gate (`proxy.ts`) asks Supabase who you are on every request | Extra load and delay | Cache for a short time |
| E9 | Medium | The live database settings (sign-ups off, password rules, session timeout, email) are not in the code and must be set by hand | A wrong setting is easy to miss | Keep a written checklist, and check it |
| E10 | Low | The demo logins and their password exist in the seed and in every test file | They must never reach live | The seed must never run online. Add a check |
| E11 | Medium | Nothing limits the number of pieces a shop can hold. The Calendar lists a row for every piece and the tag page lists up to 5,000. In the 30 October test, 10,000 pieces in one shop made the booking form's free-count check take about 0.19 seconds | One very large shop would slow its own screens, and the plan limits would be meaningless | Build the proposed limits (1,000, 3,000, 10,000) into the database, and page the Calendar and tags |

## F. Zypher console and billing

| ID | Severity | Problem | Why it matters | Suggested fix |
|---|---|---|---|---|
| F1 | High | No data export for a shop | A shop leaving, or a privacy request, cannot be served | Build an owner download (CSV zip) and a Zypher export |
| F2 | High | No clean way to end a shop. Pause is the only off switch | You cannot offboard properly | Add "export, then switch off" |
| F3 | Medium | No price list inside the console. The plan is only a name. Plan limits are written in two places | Prices drift | Store one list, with a negotiated override |
| F4 | Medium | The 14-day trial cannot be changed or extended on screen, and nothing warns when it is about to end | You will be asked to extend trials | Show and edit the trial end |
| F5 | Medium | A ₹0 shop shows "Overdue" for ever. "Monthly fees" counts trial and ₹0 shops | Wrong numbers on the overview | Leave them out |
| F6 | Medium | A shop that never paid is paused the first night after its trial ends. Resuming without a payment gets it paused again | Surprise lock-outs | Add a grace period and a "do not pause" switch |
| F7 | Medium | The WhatsApp reminder is by hand, the text is the same for overdue and due soon, and there is no record that it was sent | Follow-up is unreliable | Log each reminder and word it by state |
| F8 | Medium | The audit page promises more than it shows. "By" shows Unknown for shop people | It confuses | Fix the text and show names where allowed |
| F9 | Medium | No recovery for a lost authenticator phone | A Zypher person can be locked out | Add recovery codes |
| F10 | Low | All Zypher staff are equal | One account can do everything | Add a "billing only" kind later |
| F11 | Low | Zypher cannot change a shop's web name, prefix, GST number, time zone or logo after creation | Small changes need a developer | Add edit for these |
| F12 | Low | A business type cannot be removed from a shop. Adding one later does not add its extras | Half-finished changes | Decide the rule (Part 12) |
| F13 | Low | Billing and shop lists load everything at once. The API cuts results at 1,000 rows | Silent cut-off at scale | Page the lists |

## G. Privacy

> **What this means for you:** India's data protection law (DPDP Act 2023) will apply to the customer details your shops keep. These are the gaps. I am not a lawyer. Please have the privacy policy and terms checked before launch.

| ID | Severity | Problem | Why it matters | Suggested fix |
|---|---|---|---|---|
| G1 | High | Customer ID numbers and licence numbers are stored as plain text. ID photos sit in a private folder | A leak would expose identity documents | Store less (only what is needed), or encrypt the ID number |
| G2 | High | Nobody can delete ID photos. Customers cannot be deleted. The audit log keeps full copies of deleted bookings for ever | You cannot honour a deletion request | Add a deletion and an anonymise action, and a retention period |
| G3 | High | No consent record, no privacy notice field, no export of one customer's data, no breach log | These are expected under the law | Add them, and a privacy policy and terms |
| G4 | Medium | Zypher support logins can read a shop's customer data and ID photos | Allowed by design, but must be in the terms | Say so in the terms. Use support only on request, and switch it off afterwards |
| G5 | Medium | The place of the live database is not decided | Keeping data in India is easier to defend | Choose the Mumbai region when you create the project |

## H. Documents that no longer match the code

| ID | Severity | Document | What is wrong |
|---|---|---|---|
| H1 | High | `APP_CONTRACT.md` (rules for the mobile app) | Frozen on 29 October morning. It does not list expenses, invoices, two-step sign-in or the trial. The mobile developer would start from an incomplete list |
| H2 | Medium | `CHANGELOG.md` | One long "unreleased" section. Still says "114 database tests" (it is 358) and lists Branches and Staff as shop screens |
| H3 | Medium | `ROADMAP.md` | Last updated 24 October. Says step 0 is current; steps 2 and 3 are done |
| H4 | Medium | `SETUP.md` | Says owners invite their own staff. That is now Zypher only. |
| H5 | Medium | `ARCHITECTURE.md` and `HANDOVER.md` | Name the wrong place for the cart (`src/lib/shop/cart.tsx`; it is in `src/modules/clothing`). `ARCHITECTURE.md` lists Branches and Staff as shop screens |
| H6 | Medium | `CLAUDE.md` (instructions for AI helpers) | The layout list is old and misses most documents and the modules folder |
| H7 | Low | `README.md` | Says "proven in production at TRENDZ". Lacks several documents in its table |
| H8 | Low | `BUSINESS.md` | Still lists BookieBuddy research as open and has no prices |
| H9 | Low | `RUNBOOKS.md` | Says two-step sign-in is not done. It is |
| H10 | Low | `LAUNCH_PLAN.md`, `HANDOVER.md`, `ROADMAP.md` | Three documents about "what is next" overlap. `LAUNCH_PLAN.md` still says 287 database tests |

This report replaces all of them as the single starting point. Part 13 says what to do with each.

## I. Tests

**What exists**
- **358 database checks** in 13 files. They cover security (56), platform and isolation (46), the booking engine (45), the console cannot see shop data (45), features (35), launch rules (30), operations (25), expenses (22), cleaning days (19), saving products (11), product codes (10), invoices (8), and reactivating a product (6).
- **25 browser tests** in 5 files: sign-in and two-step code (3), every screen opens (5), launch features (4), the main bridal flows (11), and money flows (2).

| ID | Severity | What is not covered | Suggested fix |
|---|---|---|---|
| I1 | Medium | Two people booking the same piece at the same moment | Add a test that tries it |
| I2 | Medium | The nightly pause job: no test checks that it is scheduled | Add a check |
| I3 | Medium | The small server programs (invite links, creating a shop with its owner) | Add browser tests |
| I4 | Medium | Bridal and groom manager and staff on the new Dashboard and Finance | Click through as each role |
| I5 | Low | Phone-width screens have no automatic test | Add a few |
| I6 | Low | Storage file limits, the live-update setup, a real authenticator login, backup and restore | Add as the live setup grows |

# 9. The business plan

> **What this means for you:** the plan is to sell a low monthly price with no big up-front fee, to shops that now use a notebook, a spreadsheet, or a tool that charges a lot up front. Hosting is cheap compared with what shops pay. The real cost is your time on setup and support.

## 9.1 Who we sell to, in order
1. **Shops with no software** (a notebook or Excel). The largest group. No money already spent, so the fastest to win.
2. **Shops with several branches.** Branches are included in our price. Some competitors charge again for each branch.
3. **Shops already using another tool.** They have already paid up front, and their monthly fee is low, so price alone will not move them. Reach them at moments of change: opening a new branch, a renewal date, a limit they hit, a bad support experience.

## 9.2 The competition

> **Where the BookieBuddy figures come from.** BookieBuddy's own price poster, which you shared on 30 October 2026. I do not know the date of the poster. Before you show a comparison to a shop, check on their website or by phone that these prices are still current. The earlier figures (from search summaries and your contacts) did not agree and are replaced by the poster.

| Product | Where | What we know | How sure |
|---|---|---|---|
| **BookieBuddy** | Kerala | Website and app-store pages exist. Says it serves car, equipment and bridal rental. Claims 5,000+ users (its own claim). Features listed: bookings, agreements, inventory, expenses, profit and loss, reminders, WhatsApp support, tutorial videos | Features: from its own pages. Users: its own claim |
| BookieBuddy prices | | Four plans, shown in the table below | From their own price poster. Date not known |
| Rentopus | Surat | From ₹799 a month, no up-front fee, free trial. Starter allows 100 items and 2 salesperson accounts | From search listings |
| Fascino Rental | Trivandrum | A small start-up like us. No public price | No price found |

### BookieBuddy's four plans (from their price poster)

| | Basic | Professional | Premium ("Most popular") | Enterprise |
|---|---|---|---|---|
| **First year** | ₹12,000 | ₹17,000 | ₹20,000 | ₹25,000 |
| **Renewal** | ₹599 a month, billed yearly | ₹999 a month, billed yearly | ₹1,299 a month, billed yearly | ₹1,699 a month, billed yearly |
| **Stock limit** | Up to 150 | Up to 450 | Up to 1,000 | Unlimited |
| **Users** | 1 | Up to 3 (owner, manager, staff) | Up to 7 | Unlimited |
| **Devices** | Single device | Multi-device (mobile and desktop) | Multi-device | Multi-device |
| **Multi-branch** | No | No | Yes | Yes |
| **WhatsApp auto-invoicing** | No | 6 months, 1,000 messages | 1 year, 3,000 messages | Unlimited |
| **Auto pickup and return reminders** | No | No | Yes | Yes |
| **Also listed** | Booking management | Sales management, customisation works, ledger and reports, shop performance reports | Everything in Professional, plus investment and withdrawal tracking, AI trending-product analysis, staff performance tracker | Everything in Premium with no limits, customisable modules |

"Billed yearly" is my reading: the monthly rate is paid once a year (for example ₹599 times 12 is ₹7,188 a year). Please confirm this with them.

**What BookieBuddy lists that we do not have yet**
- Automatic WhatsApp invoicing, and automatic pickup and return reminders.
- AI trending-product analysis, a staff performance tracker, and investment and withdrawal tracking.
- A "sales management" part (selling items, not only renting).
- Mobile apps (they say mobile and desktop; ours works in the phone's browser and can be added to the home screen).
- Customisation work included in the plan. For us, a shop's custom request is quoted separately.

**What we have that their poster does not show:** higher stock limits at every price (1,000, 3,000 and 10,000 pieces, proposed), unlimited devices, unlimited users from Pro; multi-branch from ₹999 a month (theirs starts at ₹20,000 for the first year); scanning a QR tag to find, hand over and return a piece; double booking blocked including cleaning days; exact deposit tracking; a GST tax invoice with its own number; every correction logged. We do now have expenses and profit.

**Where we stand:** on price we are lower at every level that matches. Their Basic costs ₹12,000 in the first year; our Starter year costs ₹4,999. On features, their Premium and Enterprise plans have automation, AI analysis and a staff tracker that we do not have. So we win on price, limits and branches, and we must never claim their automation.

## 9.3 Why a shop would choose us
- **No big joining fee.** ₹499 to ₹1,999 a month, against ₹12,000 to ₹25,000 for the first year (then a monthly renewal) on BookieBuddy's poster.
- **Branches are included** from ₹999 a month. On BookieBuddy, multi-branch starts at its Premium plan (₹20,000 for the first year).
- **Higher stock limits at every price.** Starter allows up to 1,000 pieces, Pro 3,000 and Business 10,000 (proposed). BookieBuddy allows 150, 450 or 1,000 on its first three plans, and 1, 3 or 7 users. Ours has unlimited devices and works in any browser.
- **Double booking is impossible,** including the cleaning days after a return.
- **Exact deposit tracking,** and nothing can be given back by mistake while a piece is out.
- **Scan a QR tag** to find, hand over and return a piece.
- **Staff see only their own branch,** and cannot see the money pages.
- **Every correction is logged** with a reason.
- **A GST tax invoice** with its own number, and a plain receipt for shops with no GST number.
- **Free migration** of their stock list and customers if they come from another tool.

**What we must not claim yet:** automatic WhatsApp messages and reminders (being built), a staff performance tracker (being built), a mobile app (later), partial returns, a page for customers to book themselves, other languages. None of these exist yet.

## 9.4 The prices

| Plan | Per month | Per year | Branches | Staff logins | Pieces (proposed) |
|---|---|---|---|---|---|
| **Starter** | ₹499 | ₹4,999 | 1 | 3 | Up to 1,000 |
| **Pro** | ₹999 | ₹9,999 | Up to 3 | Unlimited | Up to 3,000 |
| **Business** | ₹1,999 | ₹19,999 | Unlimited | Unlimited | Up to 10,000, more on request |

- All prices are **before GST**. Yearly means two months free.
- **Pieces (proposed on 30 October, not yet built into the database):** Starter up to 1,000, Pro up to 3,000, Business up to 10,000, raised on request. A piece is one real item (one dress, one saree, one suit). The limits are there to protect the shared database. See the stock test in 9.5. **Every plan includes:** unlimited devices, bookings, calendar, deposits, receipts and tax invoices, QR tags, reports, expenses and profit, and one-tap WhatsApp links.
- **Plans differ only by branches, staff logins and pieces.** Every feature is in every plan, so there is nothing to explain or gate. This replaced the older idea of "bridal extras on request" for Starter.
- The fee for each shop is typed in the console. The price list above is the default. A negotiated price is allowed.

**Offers**

| Offer | Rule |
|---|---|
| **Free trial** | 14 days, no payment. The shop is not paused during it |
| **Initial cost, for a shop with NO software** | Paid once, on top of our normal plan. It is half of BookieBuddy's first-year price for the matching plan: Starter ₹6,000 (half of Basic), Pro ₹10,000 (half of Premium), Business ₹12,500 (half of Enterprise). Covers loading stock and customers, QR tags, staff training and the trial. Decided by you on 30 October, replacing the old ₹2,999 setup fee |
| **Shop that already has software** | No initial cost. Our normal plan. Free move of their data. Nothing to pay until their current plan ends |
| **Founding shops** | Price locked for life and setup waived, in return for being a reference. How many (3 to 5, 10 or 15) is **not decided** |
| **Yearly payment** | Two months free. Sell this first: money up front and fewer shops leaving |
| **Referral** | One free month for a shop that brings another (planned) |

**Piece limits (proposed).** Starter 1,000, Pro 3,000, Business 10,000, raised on request. BookieBuddy limits stock to 150, 450 or 1,000 on its first three plans and is unlimited only on Enterprise (₹25,000 first year). Business is capped at 10,000, so we cannot say "unlimited" there.

**Three-year cost for a shop: BookieBuddy's poster against ours**

Their figure is the first-year price plus two renewals at the monthly rate times 12. Ours is the yearly price times 3, plus the initial cost for a shop with no software. Prices are before GST.

**A shop that already has software (no initial cost)**

| What the shop needs | BookieBuddy plan | BookieBuddy, 3 years | Overbooked plan | Overbooked, 3 years |
|---|---|---|---|---|
| One user, one device, up to 150 pieces | Basic | ₹26,376 | Starter | ₹14,997 |
| Up to 3 users, up to 450 pieces | Professional | ₹40,976 | Starter (3 logins, up to 1,000 pieces) | ₹14,997 |
| Up to 7 users, up to 1,000 pieces, several branches | Premium | ₹51,176 | Pro (3 branches, unlimited users, up to 3,000 pieces) | ₹29,997 |
| No limits | Enterprise | ₹65,776 | Business (unlimited branches and users, up to 10,000 pieces) | ₹59,997 |

**A shop with no software (initial cost, then our plan paid yearly)**

| BookieBuddy plan | Their first year | Their 3 years | Our plan | Our first year | Our 3 years |
|---|---|---|---|---|---|
| Basic | ₹12,000 | ₹26,376 | Starter (₹6,000 + ₹4,999) | ₹10,999 | ₹20,997 |
| Premium | ₹20,000 | ₹51,176 | Pro (₹10,000 + ₹9,999) | ₹19,999 | ₹39,997 |
| Enterprise | ₹25,000 | ₹65,776 | Business (₹12,500 + ₹19,999) | ₹32,499 | ₹72,497 |

**What these numbers say, honestly**
- **Starter:** cheaper in year one and over three years.
- **Pro:** about the same in year one (₹19,999 against ₹20,000), but their Premium includes WhatsApp automation and more. Over three years we are about 22% lower.
- **Business, shop with no software:** **dearer than their Enterprise,** by about 30% in year one and about 10% over three years. Our monthly price already equals their renewal, so a half-price initial cost on top makes us more expensive, and their Enterprise has no stock limit. This is a decision for you (Part 12, item 18).
- **If the shop pays monthly instead of yearly,** year one is higher: Starter ₹11,988, Pro ₹21,988, Business ₹36,488.
- **A shop that already has software** is cheaper with us at every level.

The comparison favours us most for small and medium shops, and for shops that already have software.

## 9.5 What it costs to run

> **What this means for you:** a shared database and a web host are cheap. The first shop does not pay for itself, but about 5 to 7 shops cover the whole bill.

Prices were read from the vendors' own pages on 29 October 2026 (supabase.com/pricing and vercel.com/pricing), at about ₹88 to the dollar.

| Item | At the start (1 to 20 shops) | At about 150 shops |
|---|---|---|
| Supabase Pro (the database): $25. Includes 8 GB of data, 100 GB of photos, 250 GB of downloads a month, daily backups kept 7 days | $25 | $25 |
| A bigger database server ("Small"), a setting inside Pro | none | about $5 more |
| Extra photos and downloads | none | about $10 |
| Vercel Pro (the web host), one seat. The free plan is not allowed for business use | $20 | $20 |
| Domain, email sender, test database (free tier) | about $1 | about $4 |
| **Total** | **about $46, about ₹4,000 a month** | **about $64, about ₹5,500 a month** |
| Optional later: restore to any minute (Point-in-Time Recovery) | not needed | +$100, about ₹8,800 |

**Where the "150 shops" claim comes from:** a load test on 22 October filled the database with 100 busy shops, each with a year of data. The included server carried about 80 shops. The next size up ("Small") carried about 180. I re-ran the test on 29 October on today's code for one busy shop-year (about 6,000 bookings): it added 35 MB, and screens answered in 6 to 31 milliseconds, with an average of 62 KB per screen. These agree with the earlier results. The test ran on a Windows PC, so the earlier plan already halved the results as a safety margin. What nobody can know yet is how much real shops use the app each day. The pilot will show that.

**Stock test (30 October).** I loaded one busy shop-year (6,000 bookings) and then added 10,000 pieces to the same shop, to see what a very large shop does to the database.
- **Size:** 10,000 pieces take about 3.7 MB, so about 370 bytes a piece. Even 150 shops with 3,000 pieces each would use about 170 MB of the 8 GB included.
- **Speed:** the free-count check in the booking form (it runs when the dates change) took about 0.19 seconds. The piece picker took 9 milliseconds, the stock card 8 milliseconds, and the Calendar's database query 34 milliseconds.
- **What really limits it:** the Calendar screen draws a row for every piece, and the tag-printing page lists up to 5,000. Those two screens, not the database, are the limit.
- **Conclusion:** 1,000, 3,000 and 10,000 pieces are safe for the database. Before a shop holds more than about 3,000 pieces, the Calendar and tag pages should group by product and load in pages.

**Conditions that go with the claim**
- Load one page of a list at a time. This is done for the main lists.
- Finance loads only the rentals that matter. This is done.
- Switch Supabase's **Spend Cap off,** so a busy day cannot stop the service for every shop.
- Watch Supabase's usage page. Move to the next server size if the server stays above 70% busy for a week, or if pages take more than a second.

**Money facts**
- **Average shop pays about ₹800 a month** (mix of plans). At 150 shops that is about ₹1.2 lakh a month, so hosting is about 4% of income. Payment fees (Razorpay, about 2%) come on top if you use it.
- **Break-even** on hosting is about 5 to 7 shops.
- **Free versus paid:** Supabase's free plan pauses a project after one week with no activity and has no backups. Vercel's free plan is not for business use. So use free plans while building and demonstrating. **Move to the paid plans on the day the first real shop's real data goes in.** The worst case, if the first shop is three months away and you pay early, is about ₹13,000.
- **Keep Overbooked in its own Supabase organisation,** separate from your other projects. A plan applies to a whole organisation.
- **Supabase's paid plan has email support only and no uptime guarantee.** The guarantee is for the top plan. This is another reason to tell shops by WhatsApp if there is an outage.

## 9.6 Tax
- Prices are quoted **before GST**. Whether Zypher charges GST depends on whether it is registered. This is **not decided.**
- A common rule is that a services business must register when yearly turnover passes ₹20 lakh. At the average of ₹800 a month, that is about 200 shops. Please confirm this with an accountant.
- Shops with a GST number get a tax invoice from Overbooked for their own customers. The invoice rules (number, date, SAC code) need the accountant's approval.
- Ask the accountant about tax on commission paid to a sales person.

## 9.7 The plan for the first weeks
1. **Pilot:** a few friendly shops, with close WhatsApp support, for about a week.
2. **Founding shops** next, as references.
3. **Open paid sales** after the pilot has shown no serious problems.
4. For each new shop: create it in the console, load its stock from a CSV, print its tags, train the staff, start the 14-day trial.

You said you want to start proper business in the coming days. The honest condition is: the product is ready for a pilot, but the first shop should not go live before the "before the first shop" items in Part 11 are done.

## 9.8 Business risks

| Risk | What to do |
|---|---|
| Support takes more time than the income covers | Self-service setup later. WhatsApp support in fixed hours. Short video guides |
| A bug or outage affects every shop | Test copy first, a backup before each update, alerts, tell shops quickly |
| One shop sees another's data | Keep the 56 security tests as a gate before every release |
| ID photos and numbers are sensitive | Part 8, group G. Privacy policy and terms before launch |
| BookieBuddy cuts its price | Compete on the model: branches included, no joining fee, local support |
| The reference shop (TRENDZ) may be running on a free database with no automatic backups (the 22 October plan said "if that is the case"; not confirmed here, because this project never touches TRENDZ) | Ask your relative to check. Move it to a paid plan or set up scheduled backups. It is your reference customer |
| A sales person promises what does not exist | A written "do not promise" list (in the sales sheet), and a rule that Zypher confirms any custom request |
| Shops ask for custom features | The rule is one product for all. Choose the lowest of: a setting, a switch for one shop, a business-type template, then a new feature built once and then offered to all. Quote new features once |
| Staff misuse (discounts, refunds) | Fix A1 before launch |

# 10. The sales and commission plan

> **What this means for you:** you asked how to pay a sales person: per product or per sale, and how to keep them motivated with commission only. This part gives a complete plan you can show them. The amounts are **my suggestion**, worked out from your price list. Check them with the sales person and your accountant before you promise anything.

## 10.1 The choice you made
- **Commission only,** no salary.
- **A one-time amount for each shop,** paid once. Not a share that continues while the shop pays.

"Per product" and "per sale" come to the same thing here, because what you sell is one thing: a shop on a plan. So the plan is a **one-time amount per shop, and the amount depends on the plan the shop buys.** A bigger plan pays more.

## 10.2 The commission

| Plan the shop buys | One-time commission | How I got the figure |
|---|---|---|
| Starter | ₹1,000 | About 20% of the first-year price (₹4,999 paid yearly) |
| Pro | ₹2,000 | About 20% of ₹9,999 |
| Business | ₹4,000 | About 20% of ₹19,999 |

## 10.3 When it is paid
Money first, commission second. Zypher pays only from money it has received.

| Case | Payment |
|---|---|
| The shop pays monthly | **Half** when its first payment has cleared. The **other half** after the shop has paid for 60 days and has made real bookings in the app (at least 10 bookings) |
| The shop pays for the year up front | The **full amount** when the payment has cleared, because the cash is already in |
| The shop leaves in the trial, or never pays | Nothing |
| The shop stops before the 60 days are up | The first half only |

Commission is paid **once a month,** with a short statement (see 10.8).

## 10.4 What does not earn commission
- **The initial cost paid by a shop with no software** (Starter ₹6,000, Pro ₹10,000, Business ₹12,500). It stays with Zypher and covers the work of loading stock, printing tags and training. The commission amounts in 10.2 do not change.
- **Free pilot and founding shops** given to build references. They are a reference, not a sale. You decide who counts.
- **Shops that come on their own,** or from Zypher's own leads, unless the sales person did the work and logged the lead first.

## 10.5 Who owns a lead
- A lead belongs to the sales person only if it is entered in the shared **lead list** before the first demo. The list holds: shop name, phone, branch count, current software, renewal date, date entered.
- It stays theirs for **60 days.** After that it is open again.
- Two people cannot claim the same shop. The earlier entry wins.

## 10.6 How to keep a commission-only person motivated
Money is only part of it. People leave commission-only jobs when the first weeks give nothing.

**Extra money, kept small and all one-time**

| Bonus | When | Amount |
|---|---|---|
| **First sale** | The first shop whose first payment clears | ₹500 once |
| **Monthly ladder, level 1** | 3 shops paid in one calendar month | ₹1,500 |
| **Monthly ladder, level 2** | 6 shops paid in one calendar month | ₹4,000 (instead of level 1, not on top) |

**A cap that protects Zypher:** commission and bonuses together can never be more than **25% of what the shops he brought have actually paid in their first year.**

**Why there is no "prepay bonus" and no "live bonus":** a shop that pays yearly already pays the full amount at once, and the second half of the commission already depends on the shop really using the app. That does the same job without adding cost.

**Not money, but it matters more**
- **Something real to show:** a ready demo shop on the test copy, and the sales sheet.
- **Leads:** Zypher hands over leads it gets, and the first customer list (the shops TRENDZ knows).
- **Ready-made messages** for WhatsApp, and a 15-minute demo script.
- **A weekly 15-minute review:** what is stuck, what to try.
- **Clear monthly targets,** and a quick answer when he asks for help with a question.
- **A fast setup after the sale,** so the shop he brought is happy and refers others.
- **An option for later:** once 10 shops brought by him are live, offer a small fixed monthly amount on top. You chose one-time pay for now, so this is only an idea.

## 10.7 What it costs you

**Ten shops: 6 Starter, 3 Pro, 1 Business**

| Plan | Shops | Commission each | Total |
|---|---|---|---|
| Starter | 6 | ₹1,000 | ₹6,000 |
| Pro | 3 | ₹2,000 | ₹6,000 |
| Business | 1 | ₹4,000 | ₹4,000 |
| **Total** | **10** | | **₹16,000** |

| What the ten shops pay in the first year | Amount | Commission as a share |
|---|---|---|
| If all pay yearly | about ₹79,990 | about 20% |
| If all pay monthly | about ₹95,880 | about 17% |

**With the bonuses at their highest** (first sale ₹500, six shops in one month ₹4,000, then four shops in the next month ₹1,500): ₹16,000 + ₹500 + ₹5,500 = **about ₹22,000.** That is about 23% to 28% of the first year's income. The cap holds the total to 25% of what the shops have actually paid, so if all ten paid yearly it would trim this to about ₹20,000.

**Pay-back:** at an average of ₹800 a month, a shop that stays about three months has paid back its commission.

## 10.8 A sample monthly statement

| Shop | Plan | First payment cleared | Paid how | Commission due | Paid now | Still waiting |
|---|---|---|---|---|---|---|
| Example Boutique | Pro | 4 Nov | Monthly | ₹2,000 | ₹1,000 | ₹1,000 (due after 60 days and 10 bookings) |
| Example Sarees | Starter | 9 Nov | Yearly | ₹1,000 | ₹1,000 | ₹0 |
| **Total this month** | | | | | **₹2,000** | **₹1,000** |

## 10.9 What to write in the agreement
Get it in writing, signed by both. Ask a lawyer or accountant to check it. It should say:
- the amounts in 10.2, the timing in 10.3, the cap in 10.6, and what does not count (10.4);
- how leads are claimed and how long they last (10.5);
- that he sells only what is in the sales sheet and **promises nothing else** (the "do not promise" list);
- that he may **not offer a discount** beyond the price list without Zypher's approval;
- that he **keeps no customer data** of shops or their customers, and uses the brand only as agreed;
- what happens on both sides if either stops working together (commission earned stays his; unpaid halves follow 10.3);
- how tax is handled on his commission. This is for the accountant.

## 10.10 The sales steps, from first call to first money

1. **Log the lead** in the lead list.
2. **Ask first:** "How do you manage bookings now?" The answer chooses the story: no software, or already on another tool.
3. **15-minute demo on a phone,** using the demo shop. Show: a booking, the calendar, a return with a deposit, and Finance.
4. **Start the 14-day trial.** The sales person sends Zypher the shop's details.
5. **Zypher sets the shop up:** creates it in the console, loads the stock list, prints tags, trains the staff.
6. **The shop pays** at the end of the trial, or earlier. Commission part one is due.
7. **Sixty days later:** commission part two, if the shop is still paying and using the app.

## 10.11 What he must never promise
- Automatic WhatsApp messages.
- A mobile app.
- Part returns (some pieces back now, the rest later).
- A page for customers to book by themselves.
- Languages other than English.
- A feature a shop asks for, until Zypher has said yes in writing and quoted it.
- A price below the list, or a free period longer than 14 days, without Zypher's approval.

## 10.12 Why not the other ways
| Option | Good | Bad |
|---|---|---|
| One-time amount per shop (your choice, recommended here) | Simple, cost is known, easy to explain | He has no reason to care if the shop leaves, so the second half and the 60-day rule fix that |
| One-time amount per shop, plus a share while the shop pays for 12 months | Rewards long customers. Common in the industry | Costs Zypher more for a year and needs more tracking. Not your choice for now |
| A share for as long as the shop pays | Fair for long customers | The cost never ends, so it needs a low percentage |

## 10.13 Where the numbers come from, honestly
- Industry guides say that for partner and affiliate programs, **20% to 30% of the monthly fee for up to 12 months** is normal. Examples: one Indian program pays 10% with no end date; Freshworks' partner program is reported at 15% to 30% for 12 months. One guide says enterprise direct sales pay 5% to 10% of the deal.
- These come from marketing websites about **partner programs.** I could not find reliable figures for **commission-only agents at small Indian software firms.**
- So the amounts in this part are **my suggestion from your price list,** not a market fact. They aim at about 20% of the first-year price, which is in the same area as the benchmarks.
- Sources: telecrm.in (SaaS affiliate programs in India), getreditus.com (recurring versus one-time commissions), kennect.io (SaaS sales commission), everstage.com (software sales commission). Searched on 30 October 2026.

# 11. What is left to do

> **What this means for you:** this is the full list in order. "Size" is a rough guess: **S** is under a day, **M** is one to three days, **L** is more. "Who" says who must act.

## 11.1 Before the first shop goes live

| # | Task | Why | Size | Who | Needs first |
|---|---|---|---|---|---|
| 1 | Push the work to GitHub. Turn on protection for the main branches. Put a real name in CODEOWNERS | The work is only on one laptop. Nothing stops a direct change to the live branch | S | You and me | Your GitHub name |
| 2 | Open Supabase and Vercel in their own organisation. Make a free test project. Choose the Mumbai region | Nothing can be sold without a place to run | S | You | A card for the paid plans later |
| 3 | Buy a domain. Set up an email sender for invite mails | Invites are shared by hand now. A domain is needed to look real and to send mail | S to M | You | Domain choice |
| 4 | Set the live project's settings by a written checklist: sign-ups off, password rules, session timeout, two-step code, Spend Cap off, the secret key only in the host's settings | These are not in the code and are easy to miss | S | Me with you | #2 |
| 5 | Put the app on the test copy. Run all tests against it. Practise an update with a backup first | The first update on live must not be the first update ever | M | Me | #2, #4 |
| 6 | Add error alerts and a "is it up" check | You must learn of a problem before the shop does | S to M | Me | #5. This adds a new package, so I will ask first |
| 7 | Decide and build what counter staff may do (discount limit, cancel with refund, change price, extend) | Money can be given away today | M | You decide, I build | Your decision (Part 12) |
| 8 | Make a damaged piece easy to bring back into stock. Show "Ready again" on a returned booking | Stock quietly disappears | S | Me | |
| 9 | Add the piece-by-piece check to hand over | A wrong piece can go out | M | Me | Your decision |
| 10 | Write a privacy policy and terms. Decide how ID numbers and photos are handled and how a deletion request is served | The law expects this and shops hold identity documents | M | You and a lawyer | |
| 11 | Ask the accountant: GST registration, invoice fields and SAC code, tax on commission | Wrong invoices and tax are costly | S | You | |
| 12 | Have a person from a bridal shop click through every screen as owner, manager and staff, on a phone and a computer | I tested a sample, not every screen for every role | M | You | |
| 13 | Make a demo shop on the test copy for the sales person | He needs something real to show | S | Me | #5 |
| 14 | Ask your relative to check the TRENDZ backups | TRENDZ is the reference shop | S | You | |
| 15 | Decide the backup plan beyond Supabase's 7 days, at least the daily dump and a first restore test | A mistake found later cannot be undone. You parked this | S to M | You and partners | Part 12 |

## 11.2 In the first month

| # | Task | Why | Size |
|---|---|---|---|
| 16 | Shop data export and a clean way to end a shop (F1, F2) | A shop that leaves must get its data. The law expects it | M |
| 17 | A price list in the console, an editable trial, no "overdue" for ₹0 shops, a grace period before pausing (F3 to F6) | Avoid wrong numbers and surprise lock-outs | M |
| 18 | Fix a wrong Zypher payment from the screen (B3) | A typo gives a shop free service | S |
| 19 | Decide and build the late-fee rule. Add a confirmation to cancel with a refund (A5 to A9) | Money rules the shops will notice | M |
| 20 | Use one word for each thing across the app (A10) | Training and support | M |
| 21 | Tax invoice completeness after the accountant's list (B2) | GST customers may reject it otherwise | M |
| 22 | Use the database types in the code and remove the forced casts (C1) | Catches mistakes earlier | M |
| 23 | Decide mixed shops and car, bike and resort screens (A3, C2) | Two versions of every screen is double work | M |
| 24 | Update `APP_CONTRACT.md` and the other documents (H group). Tag the first release | The mobile developer starts from an old list | M |
| 25 | Recovery codes for two-step sign-in (F9) | A lost phone locks a person out | S |
| 26 | Tests for two people booking at once, the nightly pause job, the server programs (I1 to I3) | The biggest gaps | M |
| 27 | A monthly restore test | A backup never restored is a hope | S |

## 11.3 Later

| # | Task | Notes |
|---|---|---|
| 28 | The mobile app | Your friend builds it against the written contract. Expo with the same database. His code must belong to Zypher, in writing |
| 29 | Automatic WhatsApp messages, including automatic pickup and return reminders and the automatic invoice message | Owner decision on 30 October: build this. Needs Meta's official business API. Messages cost about ₹0.11 to ₹0.16 each |
| 29b | Staff performance tracker | Owner decision on 30 October: build this. What it measures (bookings handled, money taken, late returns, corrections) needs a short design |
| 29c | Not needed | AI product analysis, investment and withdrawal tracking, and sales management. Owner decision on 30 October: skip them |
| 30 | Part returns | A design exists (`PARTIAL_RETURNS_DESIGN.md`). It needs your decisions first |
| 31 | A page where customers see the catalogue and request a booking | Later, then a customer app |
| 32 | Online subscription payments (Razorpay) | Today billing is by hand with receipts |
| 33 | Malayalam and other languages | |
| 34 | Code clean-up: unused files and packages, folder names, one brand and format setting (C3 to C14) | Do in small steps, each tested |
| 35 | Polish car, bike and resort screens, or retire them | Decide in #23 |
| 36 | Per-shop customisation tidy-up: a shop stores only what differs from its template, settings are checked against one list, texts like WhatsApp and receipts become settings | Needed as custom requests arrive |
| 37 | Usage page, announcements to shops, a "billing only" Zypher role | Console growth |
| 38 | Move to a larger Supabase server, or add Point-in-Time Recovery, when the usage page says so | About ₹450 more for the server, about ₹8,800 for Point-in-Time Recovery |

# 12. Decisions waiting for you

> **What this means for you:** these are the questions only you and your partners can answer. I have put my suggestion next to each. Nothing is built on a guess.

| # | Decision | Options | My suggestion | Status |
|---|---|---|---|---|
| 1 | Push to GitHub and tidy the branches. What is your GitHub name? | Push now, or review first | Push now. It is only a backup | Open |
| 2 | Commission amounts, bonuses, the cap, and what counts as a sale | See Part 10 | Use Part 10 as the starting offer. Discuss it with the sales person and the accountant | Open |
| 3 | How many founding shops, and do they earn commission? | 3 to 5, 10 or 15 | 10, with no commission on them. They are references | Open |
| 4 | Confirm BookieBuddy's prices are current | You shared their price poster on 30 October. Check the poster's date and that "billed yearly" means the monthly rate times 12 | A quick call or look at their website before any comparison is shown to a shop | Poster received; check it is current |
| 5 | Is Zypher registered for GST? | Yes or no | Ask the accountant now | Open |
| 6 | Backups beyond 7 days | Daily dump to GitHub only, or also to separate storage | Daily dump plus weekly and monthly copies in separate storage. It needs a small storage account from you | Parked |
| 7 | Do car, bike and resort stay in the first release? | Keep, or hide until ready | Hide until the clothing launch is steady | Open |
| 8 | Late-return rule | Catalogue day price or the agreed price. With or without a grace time | Use the agreed price per day, with a short grace time you choose | Open |
| 9 | When is the tax invoice issued? | At return (now) or earlier | At return, as now. Confirm with the accountant | Open |
| 10 | What may counter staff do? | Full (now), a discount limit, manager approval for refunds and price changes | A discount limit, and manager approval for cancel with refund and price changes | Open |
| 11 | When a piece is kept late, is it unavailable for every future date? | Yes (now), or only the next few days | Keep it as now until you see how shops behave | Decided for now |
| 12 | Is a deposit always returned in full on cancel or no-show? | Yes (now), or allow a deduction | Allow the owner to keep part, with a reason | Open |
| 13 | Hosting accounts and the domain name | | Create them this week | Open |
| 14 | What happens when a business type is removed from a shop, and are children counted as guests? | | Decide when the first resort or car shop needs it | Open |
| 15 | Mid-month plan changes and plan history | Charge the difference, or change at the next month | Change at the next month | Open |
| 16 | Free trial: is 14 days right, and may the sales person extend it? | | 14 days. Only Zypher extends | Decided: 14 days |
| 17 | Piece limits per plan | Starter 1,000, Pro 3,000, Business 10,000 (proposed from the stock test), or other numbers | Use the proposed numbers, then build the limit into the database with a clear message and show it in the console | Proposed; not built |
| 18 | Initial cost for a Business shop with no software | Half of Enterprise (₹12,500) as decided, or lower, or waived | It makes Business dearer than BookieBuddy Enterprise. Lower it, or waive it, and sell Business on branches and control | Open |
| 19 | When to build automatic WhatsApp and the staff tracker | Before the first shops, or after the pilot | After the pilot, once real shops show what they need. Never promise a date before then | Open |
| 20 | Do the sales person's commission amounts change now that shops with no software pay an initial cost? | Keep as is, or add a share (for example 10%) of the initial cost | Keep as is until the first sales show what is fair | Open |

# 13. Appendix

## 13.1 Word list

| Word | Meaning |
|---|---|
| **Audit log** | A permanent list of important changes: who, when, what, why. Nobody can edit it |
| **Backup** | A saved copy of the data, to go back to after a mistake or a failure |
| **Branch (in a shop)** | One physical location of a shop |
| **Branch (in GitHub)** | A separate line of work in the code. `main` is the live line |
| **Cart** | The items a staff member has picked before making a booking. Kept in the browser |
| **CI (automatic checks)** | Programs on GitHub that test every change before it is accepted |
| **Cleaning days** | Days a piece is kept out of the booking list after it returns, for cleaning |
| **Commit** | One saved step of the code work, with a note |
| **Console** | The Zypher-only area of the website |
| **Database** | Where all information and the rules are stored (here: Supabase, which uses Postgres) |
| **Deposit** | Money a customer leaves as security. It is given back, or kept to pay charges |
| **Function (database)** | A small program inside the database, such as "make a booking" |
| **GitHub** | The website where the code is stored and reviewed |
| **GST, GSTIN, CGST, SGST, IGST** | Indian sales tax; a shop's GST registration number; the central and state halves; the tax for sales between states |
| **Hosting** | Running the app on the internet. Here Vercel hosts the app and Supabase hosts the database |
| **Lint** | An automatic tidiness check of the code |
| **Load test** | A test that fills the database with many shops' data and measures how fast screens answer |
| **Migration** | One saved change to the database structure. There are 28, applied in order |
| **No-show** | A customer who booked and did not come |
| **Owner, manager, staff** | The three kinds of person in a shop |
| **Piece** | One real item that can be rented |
| **Point-in-Time Recovery** | A paid Supabase option to go back to any minute in the last 7 days |
| **Production** | The live copy that real shops use |
| **Pull request** | A request to join one line of code into another, for review |
| **Row-level security (RLS)** | The database rule that makes a person see only their own shop's rows |
| **SAC code** | A service code used on Indian tax invoices |
| **Seed** | The demo data loaded into a local test database |
| **Service key** | A secret key that bypasses all database rules. It must stay on the server only |
| **SKU** | The code of a product or variation, such as BR-001-GOLD-M |
| **Spend Cap** | A Supabase switch that stops the service at its limit instead of charging more |
| **Staging** | The online test copy, used to try changes before they go live |
| **Supabase** | The company that provides the database, sign-in and photo storage |
| **Trial** | A free period for a new shop. Here 14 days |
| **Two-step sign-in (MFA, TOTP)** | A six-digit code from an app on the phone, asked after the password |
| **Variation** | A size, colour or room type of one product |
| **Vercel** | The company that hosts the web app |
| **Zypher** | Your company |

## 13.2 The 28 database changes, in plain words

| # | What it did |
|---|---|
| 0 | Shops, branches, people, invites, Zypher billing, running numbers, the audit log, plan limits |
| 1 | The catalogue: categories, products, variations, prices, pieces, sets, extras |
| 2 | Customers, rentals, lines, reservations, charges, checks, payments, appointments, and the money triggers |
| 3 | Row-level security, photo storage, live updates |
| 4 | The business types (then bridal, groom, resort, car, bike) |
| 5 | Prices and availability |
| 6 | The booking workflow: book, pick up, return, charges, payments, extend, cancel |
| 7 | Owner corrections, catalogue tools, reports, staff tools, Zypher console actions |
| 8 | The console's overview numbers and shop page |
| 9 | Helpers for the booking screen, saving a product in one go |
| 10 | Changing a booking, sets, reminders, Zypher's company details and receipts, automatic pause, measurements |
| 11 | Only Zypher sets up branches, staff and stock locations |
| 12 | Cleaning days on each booking |
| 13 | Product code format for clothing shops |
| 14 | Bringing a switched-off product back |
| 15 | Bridal and groom become one "Clothing rental" type |
| 16 | The console becomes setup-only; the support role; setup audit |
| 17 | Two-step sign-in rules |
| 18 | Least privilege: tighter database permissions |
| 19 | Photo size and type limits |
| 20 | Zypher's notes hidden from shops; the audit view narrowed |
| 21 | Setup functions that name the shop; setup from the console |
| 22 | Launch rules: late pieces, deposit refund rule, backdated returns, trial, settings list, unblock rule, price log, a fix so clothing shops can be created |
| 23 | Expenses |
| 24 | A product and its pieces saved in one step |
| 25 | Tax invoice number and date |
| 26 | Trial shown in the console |
| 27 | The rentals where money is still open, for a lighter Finance page |

## 13.3 How to run and test it (for a developer)

These run on Windows with Docker Desktop. Everything here is local. Nothing touches TRENDZ.

```
npx supabase start          start the local database
npx supabase db reset       rebuild it from the migrations and demo data (signs everyone out)
npm run dev                 the app at http://localhost:3000
npx tsc --noEmit            type check
npm run lint                tidiness check
npx supabase test db        358 database checks (reset first)
npx playwright test         25 browser tests (reset first)
npm run build               a production build
node scripts/load-test.mjs .   the speed test (load the data first, see docs/SETUP.md)
```

Tests change the local demo data, so reset before the database tests and again before the browser tests.

## 13.4 Accounts you will need

| Account | For | When |
|---|---|---|
| GitHub (your own name for code owner) | Keep the code, run checks | Now |
| Supabase (own organisation, Mumbai region) | The database | Free for testing. Paid when real data goes in |
| Vercel | Hosts the app | Free for testing. Paid for business use |
| A domain name | The web address | Before launch |
| An email sender | Invite and reset emails | Before launch |
| Separate file storage (Cloudflare R2 or Backblaze B2) | Backups beyond 7 days | When you decide on backups |
| An error tracker and an uptime check | Alerts | Before the first paying shop |
| Razorpay | Online subscription payments | Later |
| Meta business account | Automatic WhatsApp | Later |
| Google Play ($25 once) and Apple ($99 a year) | The mobile app | Later |

## 13.5 The rules that never change
- Overbooked has nothing to do with the TRENDZ live or test databases. Never connect to them, copy from them or use their keys. TRENDZ's folder is read only.
- Never read or print `.env` files or keys. Only `.env.example` (names only) is saved.
- Plan first, and wait for approval before changing code. No new packages without asking.
- Where a business rule is unclear, write the assumption down and ask.
- Commit and push only when asked. Do not merge into `main` unless told.
- Where Overbooked differs from TRENDZ, say so and ask. Do not quietly keep one way.
- Check the database as well as the menu when a role loses access.
- A passing test is not proof that it looks right. Open the page.

## 13.6 Where each document in `docs/` stands

| Document | What it is | What to do |
|---|---|---|
| `PROJECT_REPORT.md` / `.docx` (this) | The complete picture | The new starting point. Keep it up to date |
| `HANDOVER.md` | State for the next session | Keep. Update the cart path and the branch facts |
| `LAUNCH_PLAN.md` | The plan made on 29 October | Archive once Part 11 is accepted. Fix the 287 test count |
| `ROADMAP.md` | The old step list | Update or merge into Part 11 |
| `ARCHITECTURE.md` | How it is built | Keep. Fix the cart path and the Branches and Staff rows |
| `DATABASE.md` | Tables and functions | Keep. It is current |
| `APP_CONTRACT.md` | The rules for the mobile app | Update before the app starts (H1) |
| `SETUP.md` | How to set up locally | Fix the line about owners inviting staff |
| `RUNBOOKS.md` | Steps for backups, access, problems | Keep. Update the two-step line |
| `BRANCHING.md` | How GitHub should be used | Keep. Make it true on GitHub |
| `BUSINESS.md` | Business notes | Replace with Part 9 and Part 10 |
| `TRENDZ_PARITY.md` | A one-off screen comparison | Archive |
| `PARTIAL_RETURNS_DESIGN.md` | A design for a feature not built | Keep, labelled "proposal" |
| `SALES_SHEET.docx` | For the sales person | New |

## 13.7 Facts and where they came from

| Fact | Source | Checked |
|---|---|---|
| 358 database checks, 25 browser tests, 28 migrations | Running the test commands and counting the files | 29 to 30 Oct 2026 |
| Prices and offers | The 22 Oct plan document and the 26 Oct call sheet, as changed on 29 Oct | 29 Oct |
| Supabase and Vercel prices | supabase.com/pricing and vercel.com/pricing | 29 Oct |
| Supabase free plan pauses after a week and has no backups. Paid plan has email support only | supabase.com/pricing | 29 Oct |
| Vercel's free plan is for non-commercial use | vercel.com/pricing | 29 Oct |
| Server capacity: about 80 shops included, 180 on Small | The 22 Oct load test, and the 29 Oct re-run on one shop-year | 22 and 29 Oct |
| BookieBuddy's four plans and prices | The price poster you shared on 30 Oct 2026 (BookieBuddy's own marketing image). Its date is not known | 30 Oct. Confirm it is current |
| Rentopus details | The 22 Oct plan and search listings | Not verified |
| Commission benchmarks | Partner-program pages on the web (see 10.13) | 30 Oct |
| What each screen does and what is wrong | Reading the code and the database, plus the tests, and a sample click-through in the browser | 29 to 30 Oct |

## 13.8 Demo logins
The local demo shops and logins are in `supabase/seed.sql`. They are for the local test database only. The password is in the test files. **They must never exist in the online test copy or the live copy.** The list is: a bridal shop (owner, manager, staff, support), a groom shop, a resort, a car shop and a bike shop, each with an owner and staff, plus one Zypher login.
