import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";

// The v2 shop app and Zypher console against the local demo data (supabase/seed.sql).
// Run: npx supabase db reset, then npx playwright test
// Logins are the local demo accounts from seed.sql (local only, never used anywhere else).
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "Overbooked-Demo-2026!";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("manager@overbooked.com").fill(email);
  await page.getByPlaceholder("••••••••").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
}

const field = (page: Page, label: string) => page.locator("label", { hasText: label }).locator("input, select, textarea").first();
const dmy = (iso: string) => iso.split("-").reverse().join("/");
const setDates = async (page: Page, from: string, to: string) => {
  await page.getByLabel("Pickup date").fill(dmy(from));
  await page.getByLabel("Return date").fill(dmy(to));
};
// the booking takes its items from the cart: open the product on All Rentals, press Rent on the first free branch, then open the booking form
const rent = async (page: Page, product: string) => {
  await page.goto("/catalog");
  await page.getByRole("textbox", { name: "Search products" }).fill(product);
  await page.getByRole("button", { name: "Rent", exact: true }).click();
  // a product with colours and sizes first asks which ones: Search shows them all
  const search = page.getByRole("dialog").getByRole("button", { name: "Show all" });
  if (await search.isVisible({ timeout: 1500 }).catch(() => false)) await search.click();
  await page.getByRole("button", { name: /to cart$/, disabled: false }).first().click();
  await page.goto("/checkout");
};
// open a booking from the Bookings list by the customer's name
const openBooking = async (page: Page, customer: string) => {
  await page.getByRole("link", { name: new RegExp(customer) }).first().click();
  await expect(page).toHaveURL(/\/rentals\//);
};

test("a bridal owner gets the TRENDZ menu", async ({ page }) => {
  await signIn(page, "owner@bridal.test");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  const nav = page.getByLabel("Main navigation");
  await expect(nav.getByText("Kalyani Bridal")).toBeVisible();
  for (const item of ["Dashboard", "Finance", "Bookings", "Inventory search", "Calendar", "Customers", "Products",
    "Add New Product", "Categories", "CSV Import", "Shop settings"]) {
    await expect(nav.getByRole("link", { name: item, exact: true })).toBeVisible();
  }
  await expect.poll(async () => (await nav.getByRole("link").allTextContents()).slice(0, 3).map((name) => name.trim()))
    .toEqual(["Dashboard", "Finance", "Bookings"]);
  const work = nav.getByRole("button", { name: "Work", exact: true });
  await work.click();
  await expect(nav.getByRole("link", { name: "Finance", exact: true })).toHaveCount(0);
  await work.click();
  await nav.getByRole("button", { name: "Open profile menu" }).click();
  await expect(page.getByRole("menuitem", { name: "Account settings" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
  await page.keyboard.press("Escape");
  // branches, staff and stock locations are set up by Zypher, not by the shop
  for (const item of ["Branch Management", "Staff Management", "Stock Locations"]) {
    await expect(nav.getByRole("link", { name: item, exact: true })).toHaveCount(0);
  }
  // All Products has no tabs (as in TRENDZ): Categories is its own menu item
  await nav.getByRole("link", { name: "Products", exact: true }).click();
  await expect(page.getByRole("heading", { name: "All Products" })).toBeVisible();
  await expect(page.getByRole("tab")).toBeHidden();
  // the setup screens live only in the Zypher console: the shop has no such addresses
  for (const path of ["/staff", "/branches"]) {
    const res = await page.goto(path);
    expect(res?.status()).toBe(404);
  }
});

test("Zypher sets a bridal shop up from the console: branches and staff, without opening the shop", async ({ page }) => {
  await signIn(page, "zypher@overbooked.test");
  await page.getByRole("link", { name: "Shops", exact: true }).click();
  await page.getByRole("link", { name: "Kalyani Bridal" }).click();
  await expect(page.getByRole("button", { name: /open shop/i })).toHaveCount(0);

  // branches are also the stock locations: one list, with no stock figures
  await page.getByRole("link", { name: "Branches", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Branches", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "MG Road", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Pieces" })).toHaveCount(0); // what a branch holds is the shop's business
  await page.getByRole("button", { name: "Add branch" }).click();
  await page.getByLabel("Branch name").fill("QA-Branch");
  await page.getByLabel("Phone").fill("9000099999");
  await page.getByRole("button", { name: "Add branch" }).last().click();
  await expect(page.getByRole("cell", { name: "QA-Branch", exact: true })).toBeVisible({ timeout: 15_000 });
  // close it, then delete it (clean up)
  await page.getByRole("button", { name: "Close QA-Branch" }).click();
  await expect(page.getByRole("button", { name: "Reopen QA-Branch" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Delete QA-Branch" }).click();
  await page.getByRole("button", { name: "Delete branch" }).click();
  await expect(page.getByRole("cell", { name: "QA-Branch", exact: true })).toHaveCount(0, { timeout: 15_000 });

  // staff
  await page.getByRole("link", { name: "Staff", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Staff" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create invite link" })).toBeVisible();
  await expect(page.getByText("owner@bridal.test")).toBeVisible();
  await expect(page.getByLabel(/^Role for /).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^New login link for/ }).first()).toBeVisible();
});

test("Zypher invites a person from the Staff tab, makes a fresh login link, and a manager without a branch is refused", async ({ page }) => {
  const email = "qa-invite@bridal.test";
  const psql = (sql: string) => execSync(`docker exec -i supabase_db_overbooked psql -U postgres -v ON_ERROR_STOP=1 -c "${sql}"`, { stdio: "ignore" });
  const cleanup = () => {
    psql(`DELETE FROM staff_invites WHERE email = '${email}'`);
    psql(`DELETE FROM auth.users WHERE email = '${email}'`);
  };
  cleanup();
  try {
    await signIn(page, "zypher@overbooked.test");
    await page.goto("/zypher/shops/5a000000-0000-0000-0000-000000000001/staff");
    await page.getByLabel("Full name", { exact: true }).fill("QA Invitee");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Branch", { exact: true }).selectOption({ label: "MG Road" });
    await page.getByRole("button", { name: "Create invite link" }).click();
    const link = page.getByRole("textbox", { name: "Invite link" });
    await expect(link).toHaveValue(/\/welcome\?token_hash=.+&type=invite/, { timeout: 15_000 });
    await page.getByRole("button", { name: "Close" }).click();

    // the new login is listed as pending, and gets a fresh link on request
    await expect(page.getByText(email)).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "New login link for QA Invitee" }).click();
    await expect(page.getByRole("textbox", { name: "Invite link" })).toHaveValue(/\/welcome\?token_hash=.+&type=recovery/, { timeout: 15_000 });
    await page.getByRole("button", { name: "Close" }).click();

    // a manager needs a branch: the database refuses without one
    await page.getByLabel("Full name", { exact: true }).fill("QA No Branch");
    await page.getByLabel("Email", { exact: true }).fill("qa-nobranch@bridal.test");
    await page.getByLabel("Role", { exact: true }).selectOption("manager");
    await page.getByRole("button", { name: "Create invite link" }).click();
    await expect(page.getByRole("textbox", { name: "Invite link" })).toHaveCount(0);
  } finally {
    cleanup();
    psql("DELETE FROM auth.users WHERE email = 'qa-nobranch@bridal.test'");
  }
});

test("a resort owner keeps the simpler menu", async ({ page }) => {
  await signIn(page, "owner@resort.test");
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(page.getByLabel("Main navigation").getByRole("link", { name: "Money and reports" })).toBeVisible();
});

test("staff have no money, settings or console", async ({ page }) => {
  await signIn(page, "staff@car.test");
  const nav = page.getByLabel("Main navigation");
  await expect(nav.getByRole("link", { name: "Car models" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Money and reports" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Shop settings" })).toHaveCount(0);
  await page.goto("/dashboard");
  await expect(page.getByText("Money and reports are for owners and managers.")).toBeVisible();
  await page.goto("/zypher");
  await expect(page).toHaveURL(/\/$/);
});

test("Zypher lands in the console and sees every shop", async ({ page }) => {
  await signIn(page, "zypher@overbooked.test");
  await expect(page).toHaveURL(/\/zypher$/);
  await page.getByRole("link", { name: "Shops", exact: true }).click();
  for (const shop of ["Kalyani Bridal", "Raja Groom Wear", "Green Valley Resort", "Kochi Drive Cars", "Munnar Bike Rentals"]) {
    await expect(page.getByRole("link", { name: shop })).toBeVisible();
  }
});

test("bridal: book, hand over and return with a damage charge", async ({ page }) => {
  await signIn(page, "owner@bridal.test");
  await rent(page, "Kanjivaram silk saree");
  // a quiet date far ahead so repeated runs never collide
  const day = new Date(Date.now() + (60 + Math.floor(Math.random() * 300)) * 86_400_000).toISOString().slice(0, 10);
  const end = new Date(Date.parse(day) + 2 * 86_400_000).toISOString().slice(0, 10);
  await setDates(page, day, end);
  await expect(page.getByText("₹2,400").first()).toBeVisible();

  const phone = "98" + String(Date.now()).slice(-8);
  await field(page, "Phone").fill(phone);
  await field(page, "Name").fill("Playwright Bride");
  await field(page, "Advance").fill("1000");
  await page.getByLabel("Advance payment method").selectOption("cash");
  await page.getByRole("button", { name: /^Confirm booking/i }).click();

  await page.getByRole("dialog", { name: "Booking confirmed" }).getByRole("button", { name: "Done" }).click(); // the pop-up, then the list
  await expect(page).toHaveURL(/\/bookings$/, { timeout: 15_000 }); // a confirmed booking goes to the Bookings list
  await page.getByRole("textbox", { name: "Search bookings" }).fill(phone);
  const pickupSection = page.getByRole("region", { name: "Pickups & Returns" });
  const liveSection = page.getByRole("region", { name: "Live Bookings" });
  const bookingLink = { name: new RegExp(phone) };
  await expect(pickupSection.getByRole("link", bookingLink)).toBeVisible();
  await openBooking(page, "Playwright Bride");
  const bookingUrl = page.url();
  await expect(page.getByText("Booked", { exact: true })).toBeVisible();
  const overview = page.getByRole("region", { name: "Booking overview" });
  await expect(overview.getByText("Playwright Bride", { exact: true })).toBeVisible();
  await expect(overview.getByRole("heading", { name: "Awaiting pickup" })).toBeVisible();
  await expect(overview.getByText("Stock hold ends", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Payment summary" }).getByText("Paid toward rental")).toBeVisible();

  await overview.getByRole("button", { name: "Hand over" }).click();
  const pickup = page.getByRole("dialog");
  await pickup.getByRole("radio", { name: "Cash" }).first().click();
  await pickup.getByRole("button", { name: "Hand over" }).click();
  await expect(page.getByText("Out", { exact: true })).toBeVisible();

  await page.goto("/bookings");
  await page.getByRole("textbox", { name: "Search bookings" }).fill(phone);
  await expect(liveSection.getByRole("link", bookingLink)).toBeVisible();
  await expect(pickupSection.getByRole("link", bookingLink)).toHaveCount(0);

  await page.goto(bookingUrl);
  await overview.getByRole("button", { name: "Mark returned" }).click();
  const ret = page.getByRole("dialog");
  await ret.getByRole("button", { name: "All received" }).click(); // clothes: every piece is ticked as it comes back
  await ret.getByRole("radio", { name: "Damaged" }).click();
  await ret.getByRole("button", { name: "Add charge" }).click();
  await ret.getByLabel("Charge amount").fill("500");
  await ret.getByRole("radio", { name: "Cash" }).first().click();
  await ret.getByRole("button", { name: "Mark returned" }).click();

  await expect(page.getByText("Returned", { exact: true })).toBeVisible();
  await expect(overview.getByText("Return recorded", { exact: true })).toBeVisible();
  await expect(overview.getByRole("button", { name: "Mark returned" })).toHaveCount(0);
  await expect(page.getByText("₹2,900").first()).toBeVisible(); // 2,400 + 500 damage
  await expect(page.getByText("Paid", { exact: true }).first()).toBeVisible();

  await page.goto("/bookings");
  await page.getByRole("textbox", { name: "Search bookings" }).fill(phone);
  const completed = page.getByRole("region", { name: "Completed Bookings" });
  await completed.getByRole("button", { name: "Show" }).click();
  await expect(completed.getByRole("link", bookingLink)).toBeVisible();
  await expect(liveSection.getByRole("link", bookingLink)).toHaveCount(0);
});

// a far, random day so repeated runs never collide
const farDay = () => new Date(Date.now() + (60 + Math.floor(Math.random() * 300)) * 86_400_000).toISOString().slice(0, 10);

test("should validate and confirm a rental from one checkout page", async ({ page }) => {
  await signIn(page, "owner@bridal.test");
  await rent(page, "Red bridal lehenga");
  const confirm = page.getByRole("button", { name: /^Confirm booking/i });
  const cart = page.getByRole("region", { name: /Cart items/ });
  const issue = page.getByRole("alert").filter({ hasText: /enter|choose|unavailable/i });
  await expect(page.getByRole("heading", { name: "Checkout", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Checkout progress" })).toHaveCount(0);
  await expect(cart.getByRole("img", { name: /product photo/i })).toBeVisible();
  await expect(page.getByLabel("Pickup date")).toHaveAttribute("required", "");
  await expect(page.getByLabel("Return date")).toHaveAttribute("required", "");
  await expect(field(page, "Name")).toHaveAttribute("required", "");
  await expect(field(page, "Phone")).toHaveAttribute("required", "");
  for (const label of ["ID number", "Email", "Address"]) {
    await expect(page.getByRole("textbox", { name: label, exact: true })).toBeVisible();
  }

  await page.getByLabel("Pickup date").clear();
  await confirm.click();
  await expect(issue).toHaveText("Enter a pickup date.");
  const day = farDay();
  const end = new Date(Date.parse(day) + 2 * 86_400_000).toISOString().slice(0, 10);
  await setDates(page, day, end);
  await expect(page.getByLabel(/^Piece 1 of/)).toHaveValue(/.+/);
  await page.getByRole("button", { name: "One more" }).click();
  await expect(page.getByText("Not available for these dates")).toBeVisible();
  await confirm.click();
  await expect(issue).toContainText("Some cart items are unavailable");
  await page.getByRole("button", { name: "One less" }).click();

  const phone = "98" + String(Date.now()).slice(-8);
  await field(page, "Phone").fill(phone);
  await field(page, "Name").fill("Playwright Cleaning");
  await expect(page.getByText("Cart subtotal", { exact: true })).toBeVisible();
  await confirm.click();
  await expect(issue).toHaveText("Enter the advance paid.");
  const advanceMethod = page.getByLabel("Advance payment method");
  const depositMethod = page.getByLabel("Deposit payment method");
  await field(page, "Security deposit").fill("500");
  await expect(depositMethod).toBeEnabled();
  await depositMethod.selectOption("cash");
  await field(page, "Security deposit").clear();
  await expect(depositMethod).toBeDisabled();
  await expect(depositMethod).toHaveValue("");
  await field(page, "Advance paid").fill("100");
  await expect(advanceMethod).toBeEnabled();
  await confirm.click();
  await expect(issue).toHaveText("Choose how the advance was paid.");
  await advanceMethod.selectOption("cash");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Order summary" })).toBeVisible();
  await confirm.click();
  await page.getByRole("dialog", { name: "Booking confirmed" }).getByRole("button", { name: "Done" }).click();
  await expect(page).toHaveURL(/\/bookings$/, { timeout: 15_000 });
  await openBooking(page, "Playwright Cleaning");
  await expect(page.getByText("BR-001-M-1").first()).toBeVisible();
});

test("should keep cart items and checkout details separate when switching or discarding carts", async ({ page }) => {
  await signIn(page, "owner@bridal.test");
  await rent(page, "Red bridal lehenga");
  await field(page, "Name").fill("Playwright Fitting");
  await field(page, "Maintenance buffer").fill("2");
  await field(page, "Advance paid").fill("100");
  await page.getByRole("button", { name: "Open carts" }).click();
  await page.getByRole("menuitem", { name: "New cart" }).click();
  await expect(page.getByRole("region", { name: "Cart items (0)" })).toBeVisible();
  await expect(field(page, "Name")).toHaveValue("");
  await expect(field(page, "Advance paid")).toHaveValue("");
  await rent(page, "Red bridal lehenga");
  await field(page, "Name").fill("Second fitting");
  await page.reload();
  await expect(field(page, "Name")).toHaveValue("Second fitting");
  await page.getByRole("button", { name: "Open carts" }).click();
  await page.getByRole("menuitem", { name: /Playwright Fitting/ }).click();
  await expect(field(page, "Name")).toHaveValue("Playwright Fitting");
  await expect(field(page, "Maintenance buffer")).toHaveValue("2");
  await expect(field(page, "Advance paid")).toHaveValue("100");
  await page.getByRole("button", { name: "Discard cart", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Discard", exact: true }).click();
  await expect(field(page, "Name")).toHaveValue("Second fitting");
});

test("should open attribute values from the list with one Attributes sidebar entry", async ({ page }) => {
  await signIn(page, "owner@bridal.test");
  const nav = page.getByLabel("Main navigation");
  await nav.getByRole("link", { name: "Attributes", exact: true }).click();
  const label = `Fitting ${Date.now()}`;
  await page.getByRole("button", { name: "Add attribute" }).click();
  const create = page.getByRole("dialog", { name: "New attribute" });
  await create.getByRole("textbox", { name: "Name" }).fill(label);
  await create.getByRole("button", { name: "Save", exact: true }).click();
  const values = page.getByRole("link", { name: `Manage ${label} values`, exact: true });
  await expect(values).toBeVisible();
  await expect(nav.getByRole("link", { name: label, exact: true })).toHaveCount(0);
  await values.click();
  await expect(page).toHaveURL(/\/admin\/attributes\/.+/);
  await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Attributes", exact: true })).toHaveAttribute("aria-current", "page");
  await page.getByRole("main").getByRole("link", { name: "Back to attributes" }).click();
  await expect(page).toHaveURL(/\/admin\/attributes$/);
  await page.getByRole("button", { name: `Archive ${label}`, exact: true }).click();
  await expect(values).toHaveCount(0);
});

test("bridal: scan a tag into the cart, check out, hand over, then scan it back in", async ({ page }) => {
  await signIn(page, "owner@bridal.test");
  await page.goto("/scan");
  const box = page.getByLabel("Scan or type");
  await box.fill("BR-002-GOLD-2");
  await box.press("Enter");
  await page.getByRole("button", { name: "Add this piece to cart" }).click();
  await page.getByRole("link", { name: "Checkout (1)" }).first().click();
  await expect(page).toHaveURL(/\/checkout$/);

  const day = farDay();
  await setDates(page, day, new Date(Date.parse(day) + 86_400_000).toISOString().slice(0, 10));
  await field(page, "Phone").fill("97" + String(Date.now()).slice(-8));
  await field(page, "Name").fill("Scanned Bride");
  await field(page, "Advance paid").fill("0");
  await page.getByRole("button", { name: /^Confirm booking/i }).click();
  await page.getByRole("dialog", { name: "Booking confirmed" }).getByRole("button", { name: "Done" }).click(); // the pop-up, then the list
  await expect(page).toHaveURL(/\/bookings$/, { timeout: 15_000 }); // a confirmed booking goes to the Bookings list
  await openBooking(page, "Scanned Bride");
  await expect(page.getByText("BR-002-GOLD-2").first()).toBeVisible(); // the exact piece that was scanned

  await page.getByRole("button", { name: "Hand over" }).click();
  const pickup = page.getByRole("dialog");
  await pickup.getByRole("radio", { name: "Cash" }).first().click();
  await pickup.getByRole("button", { name: "Hand over" }).click();
  await expect(page.getByText("Out", { exact: true })).toBeVisible();

  // the customer brings it back: scanning a piece that is out opens its return (there is no separate mode)
  await page.goto("/scan");
  await page.getByLabel("Scan or type").fill("BR-002-GOLD-2");
  await page.getByLabel("Scan or type").press("Enter");
  const ret = page.getByRole("dialog");
  await expect(ret.getByRole("button", { name: "Mark returned" })).toBeVisible({ timeout: 15_000 });
  await ret.getByRole("button", { name: "Mark returned" }).click();
  await expect(page.getByText("Returned", { exact: true })).toBeVisible();
});

test("should add multiple product variants from one rental dialog", async ({ page }) => {
  await signIn(page, "owner@bridal.test");
  await page.goto("/catalog/new");
  const productName = `PW Saree ${Date.now()}`;
  await field(page, "Product name").fill(productName);
  await field(page, "Price per day").fill("1500");
  await expect(page.getByRole("button", { name: /^Next(?:$|:)/ })).toHaveCount(1);
  await page.getByRole("button", { name: "Next: Attributes" }).click();
  const colours = page.getByLabel("Colour values");
  await colours.fill("Red");
  await colours.press("Enter");
  await colours.fill("Blue");
  await colours.press("Enter");
  await expect(page.getByText("This makes 2 variations")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Next(?:$|:)/ })).toHaveCount(1);
  await page.getByRole("button", { name: "Next: Variations & Stock" }).click();
  const stock = page.getByLabel("Pieces at MG Road");
  await stock.nth(0).fill("2");
  await stock.nth(1).fill("1");
  const save = page.getByRole("button", { name: "Save product", exact: true });
  await expect(save).toHaveCount(1);
  await save.click();
  await expect(page.getByText("Saved, with 3 new pieces")).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/catalog$/); // back to All Products

  await page.getByRole("textbox", { name: "Search products" }).fill(productName);
  await page.getByRole("heading", { name: productName, exact: true }).click();
  const details = page.getByRole("dialog", { name: productName, exact: true });
  await expect(details.getByRole("tab", { name: "Stock" })).toHaveAttribute("aria-selected", "true");
  await details.getByRole("tab", { name: "Business" }).click();
  await expect(details.getByText("Times rented")).toBeVisible();
  await details.getByRole("tab", { name: /Pieces/ }).click();
  await expect(details.getByText(/MG Road/).first()).toBeVisible();
  await details.getByRole("button", { name: "Rent", exact: true }).click();
  const rent = page.getByRole("dialog", { name: productName, exact: true });
  const red = rent.getByRole("button", { name: "Red", exact: true });
  const blue = rent.getByRole("button", { name: "Blue", exact: true });
  await red.click();
  await rent.getByRole("button", { name: /^Search/ }).click();
  await expect(red).toHaveAttribute("aria-pressed", "true");
  await rent.getByRole("button", { name: /Add .*Red.*MG Road.*to cart/i }).click();
  await blue.click();
  await red.click();
  await expect(rent.getByRole("button", { name: /Add .*Red.*to cart/i })).toHaveCount(0);
  await rent.getByRole("button", { name: /Add .*Blue.*MG Road.*to cart/i }).click();
  await expect(rent.getByRole("link", { name: "Checkout (2)" })).toBeVisible();
});

test("Zypher never enters a shop's screens, and a support login sees only its own shop", async ({ page, context }) => {
  await signIn(page, "zypher@overbooked.test");
  // typing the address of a business screen sends Zypher back to the console
  for (const path of ["/customers", "/finance", "/catalog", "/stock-locations"]) {
    await page.goto(path);
    await page.waitForURL((u) => u.pathname === "/zypher", { timeout: 15_000 });
  }

  // the support login of Kalyani works inside Kalyani like an owner, with Stock Locations, but no console
  await context.clearCookies();
  await signIn(page, "support@bridal.test");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  const nav2 = page.getByLabel("Main navigation");
  await expect(nav2.getByText("Kalyani Bridal")).toBeVisible();
  await expect(nav2.getByText("Zypher support").first()).toBeVisible();
  await expect(nav2.getByRole("link", { name: "Stock Locations", exact: true })).toBeVisible();
  await expect(nav2.getByRole("link", { name: "Branch Management", exact: true })).toHaveCount(0);
  await page.goto("/zypher");
  await expect(page).not.toHaveURL(/\/zypher$/);
});

test("bridal: Edit changes a booking and takes a payment in the same card; the money card has no Received row", async ({ page }) => {
  await signIn(page, "owner@bridal.test");
  await rent(page, "Kanjivaram silk saree");
  const day = farDay();
  await setDates(page, day, new Date(Date.parse(day) + 2 * 86_400_000).toISOString().slice(0, 10));
  const phone = "97" + String(Date.now()).slice(-8);
  await field(page, "Phone").fill(phone);
  await field(page, "Name").fill("Edit Card Bride");
  await field(page, "Advance paid").fill("0");
  await field(page, "Security Deposit").fill("500");
  await page.getByLabel("Deposit payment method").selectOption("cash");
  await page.getByRole("button", { name: /^Confirm booking/i }).click();
  await page.getByRole("dialog", { name: "Booking confirmed" }).getByRole("button", { name: "Done" }).click(); // the pop-up, then the list
  await expect(page).toHaveURL(/\/bookings$/, { timeout: 15_000 }); // a confirmed booking goes to the Bookings list
  await page.getByRole("textbox", { name: "Search bookings" }).fill(phone);
  await page.getByRole("link", { name: new RegExp(phone) }).click();
  await expect(page).toHaveURL(/\/rentals\//);

  // the payment summary shows the deposit once, with how much is held now, and no "Received" row
  await expect(page.getByText("Security deposit", { exact: true })).toBeVisible();
  await expect(page.getByText(/held now/).first()).toBeVisible();
  await expect(page.getByText("Received", { exact: true })).toHaveCount(0);
  // the four actions are on the page, not behind a menu
  for (const name of ["Edit", "WhatsApp the customer", "Print", "Cancel booking"]) {
    await expect(page.getByRole("button", { name, exact: true }).or(page.getByRole("link", { name, exact: true }))).toBeVisible();
  }

  // Edit opens the booking card: take a payment and add a note there
  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page).toHaveURL(/\/book\?edit=/);
  await field(page, "Take a payment now").fill("700");
  await page.getByLabel("Payment method").selectOption("upi");
  await page.getByLabel("Notes").fill("changed from the edit card");
  await page.getByRole("button", { name: "Save change" }).click();
  await expect(page).toHaveURL(/\/rentals\//, { timeout: 15_000 });
  await expect(page.getByText("changed from the edit card")).toBeVisible();
  await expect(page.getByText(/^Payment recorded|Part paid/).first()).toBeVisible();

  await page.getByRole("button", { name: "Cancel booking", exact: true }).click();
  await page.getByRole("button", { name: "Confirm Cancellation & Release Dates" }).click();
  await expect(page.getByText("Cancelled", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Booking overview" }).getByText("Cancellation recorded")).toBeVisible();

  await page.goto("/bookings");
  await page.getByRole("textbox", { name: "Search bookings" }).fill(phone);
  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("cancelled");
  const cancelled = page.getByRole("region", { name: "Cancelled Bookings" });
  await expect(cancelled.getByRole("link", { name: new RegExp(phone) })).toBeVisible();
  await expect(page.getByRole("region", { name: "Pickups & Returns" })).toHaveCount(0);
});
