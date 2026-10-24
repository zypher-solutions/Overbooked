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

test("an owner gets the shop's own wording and every menu", async ({ page }) => {
  await signIn(page, "owner@bridal.test");
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  const nav = page.getByLabel("Main navigation");
  await expect(nav.getByText("Kalyani Bridal")).toBeVisible();
  for (const item of ["New booking", "Bookings", "Customers", "Outfits", "Money and reports", "Branches", "Staff", "Shop settings"]) {
    await expect(nav.getByRole("link", { name: item })).toBeVisible();
  }
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
  await ret.getByRole("radio", { name: "Damaged" }).click();
  await ret.getByRole("button", { name: "Add charge" }).click();
  await ret.getByLabel("Charge amount").fill("500");
  await ret.getByRole("radio", { name: "Cash" }).first().click();
  await ret.getByRole("button", { name: "Mark returned" }).click();

  await expect(page.getByText("Returned", { exact: true })).toBeVisible();
  await expect(page.getByText("₹2,900").first()).toBeVisible(); // 2,400 + 500 damage
  await expect(page.getByText("Paid", { exact: true }).first()).toBeVisible();
});
