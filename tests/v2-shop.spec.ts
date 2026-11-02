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

test("a bridal owner gets the TRENDZ menu", async ({ page }) => {
  await signIn(page, "owner@bridal.test");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  const nav = page.getByLabel("Main navigation");
  await expect(nav.getByText("Kalyani Bridal")).toBeVisible();
  for (const item of ["Dashboard", "Finance", "Bookings", "Inventory Search", "All Rentals", "Calendar", "Customers", "All Products",
    "Add New Product", "Categories", "Extras", "CSV Import", "Shop settings"]) {
    await expect(nav.getByRole("link", { name: item, exact: true })).toBeVisible();
  }
  // branches, staff and stock locations are set up by Zypher, not by the shop
  for (const item of ["Branch Management", "Staff Management", "Stock Locations"]) {
    await expect(nav.getByRole("link", { name: item, exact: true })).toHaveCount(0);
  }
  // All Products has no tabs (as in TRENDZ): Categories and Extras are their own menu items
  await nav.getByRole("link", { name: "All Products", exact: true }).click();
  await expect(page.getByRole("heading", { name: "All Products" })).toBeVisible();
  await expect(page.getByRole("tab")).toBeHidden();
  await nav.getByRole("link", { name: "Extras", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Extras", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /add extra/i })).toBeVisible();
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
  await page.goto("/book");
  // a quiet date far ahead so repeated runs never collide
  const day = new Date(Date.now() + (60 + Math.floor(Math.random() * 300)) * 86_400_000).toISOString().slice(0, 10);
  const end = new Date(Date.parse(day) + 2 * 86_400_000).toISOString().slice(0, 10);
  await field(page, "Pickup").fill(`${day}T10:00`);
  await field(page, "Return").fill(`${end}T18:00`);
  await page.getByRole("button", { name: /Kanjivaram silk saree/ }).click();
  await expect(page.getByText("₹2,400").first()).toBeVisible();

  const phone = "98" + String(Date.now()).slice(-8);
  await field(page, "Phone").fill(phone);
  await field(page, "Name").fill("Playwright Bride");
  await field(page, "Advance").fill("1000");
  await page.getByRole("radio", { name: "Cash" }).first().click();
  await page.getByRole("button", { name: "Confirm booking" }).click();

  await expect(page).toHaveURL(/\/rentals\//, { timeout: 15_000 });
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).first().click(); // the WhatsApp confirmation
  await expect(page.getByText("Booked", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Hand over" }).click();
  const pickup = page.getByRole("dialog");
  await pickup.getByRole("radio", { name: "Cash" }).first().click();
  await pickup.getByRole("button", { name: "Hand over" }).click();
  await expect(page.getByText("Out", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Mark returned" }).click();
  const ret = page.getByRole("dialog");
  await ret.getByRole("button", { name: "All received" }).click(); // clothes: every piece is ticked as it comes back
  await ret.getByRole("radio", { name: "Damaged" }).click();
  await ret.getByRole("button", { name: "Add charge" }).click();
  await ret.getByLabel("Charge amount").fill("500");
  await ret.getByRole("radio", { name: "Cash" }).first().click();
  await ret.getByRole("button", { name: "Mark returned" }).click();

  await expect(page.getByText("Returned", { exact: true })).toBeVisible();
  await expect(page.getByText("₹2,900").first()).toBeVisible(); // 2,400 + 500 damage
  await expect(page.getByText("Paid", { exact: true }).first()).toBeVisible();
});

// a far, random day so repeated runs never collide
const farDay = () => new Date(Date.now() + (60 + Math.floor(Math.random() * 300)) * 86_400_000).toISOString().slice(0, 10);

test("bridal: customer and payment open only when every item is free; the piece and cleaning days are kept", async ({ page }) => {
  await signIn(page, "owner@bridal.test");
  await page.goto("/book");
  await expect(page.getByText("Add the items from the list above first.")).toBeVisible();
  await expect(field(page, "Phone")).toHaveCount(0);

  const day = farDay();
  const end = new Date(Date.parse(day) + 2 * 86_400_000).toISOString().slice(0, 10);
  await field(page, "Pickup").fill(`${day}T10:00`);
  await field(page, "Return").fill(`${end}T18:00`);
  await page.getByRole("button", { name: /Red bridal lehenga/ }).click();
  await expect(page.getByLabel(/^Piece 1 of/)).toHaveValue(/.+/); // the free piece is already chosen
  await expect(field(page, "Phone")).toBeVisible();

  // MG Road has one of these: a second makes the dates unavailable and closes the customer and payment parts
  await page.getByRole("button", { name: "One more" }).click();
  await expect(page.getByText("Some cart items are unavailable for the selected dates.")).toBeVisible();
  await expect(field(page, "Phone")).toHaveCount(0);
  await expect(page.getByText("Payment opens once the dates are set and every item is free.")).toBeVisible();
  await page.getByRole("button", { name: "One less" }).click();
  await expect(field(page, "Phone")).toBeVisible();

  await field(page, "Cleaning days").fill("2");
  await field(page, "Phone").fill("98" + String(Date.now()).slice(-8));
  await field(page, "Name").fill("Playwright Cleaning");
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page).toHaveURL(/\/rentals\//, { timeout: 15_000 });
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).first().click();
  await expect(page.getByText("BR-001-M-1").first()).toBeVisible(); // the piece that was chosen
});

test("bridal: scan a tag into the cart, check out, hand over, then scan it back in", async ({ page }) => {
  await signIn(page, "owner@bridal.test");
  await page.goto("/scan");
  const box = page.getByLabel("Scan or type");
  await box.fill("BR-002-GOLD-2");
  await box.press("Enter");
  await page.getByRole("button", { name: "Add this piece to cart" }).click();
  await page.getByRole("link", { name: "Checkout (1)" }).first().click();
  await expect(page).toHaveURL(/\/book$/);

  const day = farDay();
  await field(page, "Pickup").fill(`${day}T10:00`);
  await field(page, "Return").fill(`${new Date(Date.parse(day) + 86_400_000).toISOString().slice(0, 10)}T18:00`);
  await field(page, "Phone").fill("97" + String(Date.now()).slice(-8));
  await field(page, "Name").fill("Scanned Bride");
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page).toHaveURL(/\/rentals\//, { timeout: 15_000 });
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).first().click();
  await expect(page.getByText("BR-002-GOLD-2").first()).toBeVisible(); // the exact piece that was scanned

  await page.getByRole("button", { name: "Hand over" }).click();
  const pickup = page.getByRole("dialog");
  await pickup.getByRole("radio", { name: "Cash" }).first().click();
  await pickup.getByRole("button", { name: "Hand over" }).click();
  await expect(page.getByText("Out", { exact: true })).toBeVisible();

  // the customer brings it back: scan the tag on "Receive back"
  await page.goto("/scan");
  await page.getByRole("tab", { name: "Receive back" }).click();
  await page.getByLabel("Scan or type").fill("BR-002-GOLD-2");
  await page.getByLabel("Scan or type").press("Enter");
  const ret = page.getByRole("dialog");
  await expect(ret.getByText("Pieces received (1 of 1)")).toBeVisible({ timeout: 15_000 });
  await ret.getByRole("button", { name: "Mark returned" }).click();
  await expect(page.getByText("Returned", { exact: true })).toBeVisible();
});

test("bridal: Add New Product makes every size and colour with its pieces", async ({ page }) => {
  await signIn(page, "owner@bridal.test");
  await page.goto("/catalog/new");
  await field(page, "Product name").fill(`PW Saree ${Date.now()}`);
  await field(page, "Price per day").fill("1500");
  await page.getByRole("button", { name: "Next: Attributes" }).click();
  const colours = page.getByLabel("Colour values");
  await colours.fill("Red");
  await colours.press("Enter");
  await colours.fill("Blue");
  await colours.press("Enter");
  await expect(page.getByText("This makes 2 variations")).toBeVisible();
  await page.getByRole("button", { name: "Next: Variations & Stock" }).click();
  const stock = page.getByLabel("Pieces at MG Road");
  await stock.nth(0).fill("2");
  await stock.nth(1).fill("1");
  await page.getByRole("button", { name: "Save product" }).first().click();
  await expect(page.getByText("Saved, with 3 new pieces")).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/catalog\/[0-9a-f-]{36}$/);
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
