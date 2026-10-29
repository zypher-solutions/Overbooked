import { test, expect, type Page } from "@playwright/test";

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
    "Add New Product", "Categories", "CSV Import", "Shop settings"]) {
    await expect(nav.getByRole("link", { name: item, exact: true })).toBeVisible();
  }
  // branches, staff and stock locations are set up by Zypher, not by the shop
  for (const item of ["Branch Management", "Staff Management", "Stock Locations"]) {
    await expect(nav.getByRole("link", { name: item, exact: true })).toHaveCount(0);
  }
  await page.goto("/staff");
  await expect(page.getByText("Staff logins are set up by the Zypher team.")).toBeVisible();
});

test("Zypher opens a bridal shop and gets its admin menu", async ({ page }) => {
  await signIn(page, "zypher@overbooked.test");
  await page.getByRole("link", { name: "Shops", exact: true }).click();
  await page.getByRole("link", { name: "Kalyani Bridal" }).click();
  const open = page.getByRole("button", { name: "Open shop" });
  if (await open.isVisible()) await open.click(); // the demo data may already have it open
  else await page.getByRole("link", { name: "Go to shop" }).click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 15_000 });
  const nav = page.getByLabel("Main navigation");
  for (const item of ["Branch Management", "Staff Management", "Stock Locations"]) {
    await expect(nav.getByRole("link", { name: item, exact: true })).toBeVisible();
  }
  await nav.getByRole("link", { name: "Staff Management", exact: true }).click();
  await expect(page.getByRole("button", { name: /invite/i }).first()).toBeVisible();
  await expect(page.getByText("Staff logins are set up by the Zypher team.")).toHaveCount(0);
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
