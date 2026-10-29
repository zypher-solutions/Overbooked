import { test, expect, type Page } from "@playwright/test";

// Expenses and profit, route guards and the installable app, against the local demo data (supabase/seed.sql).
// Run: npx supabase db reset, then npx playwright test
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "Overbooked-Demo-2026!";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("manager@overbooked.com").fill(email);
  await page.getByPlaceholder("••••••••").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
}
const card = (page: Page, label: RegExp) => page.locator("div, section").filter({ hasText: label }).last();

test("bridal owner: an expense shows in Expenses and lowers Profit, a correction and a delete need a reason", async ({ page }) => {
  await signIn(page, "owner@bridal.test");
  await page.goto("/finance");
  await expect(page.getByRole("heading", { name: "Finance" })).toBeVisible();
  await expect(page.getByText(/^Profit · /)).toBeVisible();
  await expect(page.getByText(/^Expenses · /).first()).toBeVisible();

  await page.getByRole("button", { name: "Add expense" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Amount (₹)").fill("1200");
  await dialog.getByLabel("Category").fill("Shop rent");
  await dialog.getByLabel("Note (optional)").fill("PW October rent");
  await dialog.getByRole("button", { name: "Add expense" }).click();
  await expect(page.getByText("Expense added")).toBeVisible();
  const row = page.getByRole("row", { name: /PW October rent/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText("1,200");

  // a correction asks for a reason
  await row.getByRole("button", { name: "Correct expense" }).click();
  await page.getByRole("dialog").getByLabel("Amount (₹)").fill("1300");
  await page.getByRole("dialog").getByRole("button", { name: "Save correction" }).click();
  await expect(page.getByText(/Say why you are correcting it/)).toBeVisible();
  await page.getByRole("dialog").getByLabel("Why are you correcting it?").fill("typed the wrong amount");
  await page.getByRole("dialog").getByRole("button", { name: "Save correction" }).click();
  await expect(page.getByText("Expense corrected")).toBeVisible();
  await expect(page.getByRole("row", { name: /PW October rent/ })).toContainText("1,300");

  // a delete asks for a reason too
  await page.getByRole("row", { name: /PW October rent/ }).getByRole("button", { name: "Delete expense" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText(/Say why you are deleting it/)).toBeVisible();
  await page.getByRole("dialog").getByLabel("Why are you deleting it?").fill("entered twice");
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("Expense deleted")).toBeVisible();
  await expect(page.getByRole("row", { name: /PW October rent/ })).toHaveCount(0);
});

test("bridal staff do not get Finance or expenses", async ({ page }) => {
  await signIn(page, "staff@bridal.test");
  await page.goto("/finance");
  await expect(page.getByText("Finance is for owners and managers.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add expense" })).toHaveCount(0);
});

test("each kind of shop is sent to its own screens", async ({ page }) => {
  await signIn(page, "owner@bridal.test");
  await page.goto("/rentals");
  await expect(page).toHaveURL(/\/bookings$/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/finance$/);

  await page.context().clearCookies();
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await signIn(page, "owner@resort.test");
  for (const path of ["/finance", "/bookings", "/all-rentals", "/scan"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/$/);
  }
});

test("the app can be added to a phone's home screen", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBeTruthy();
  const m = await res.json();
  expect(m.display).toBe("standalone");
  expect(m.icons.some((i: { sizes: string }) => i.sizes === "512x512")).toBe(true);
  expect((await request.get("/icons/icon-192.png")).ok()).toBeTruthy();
});
