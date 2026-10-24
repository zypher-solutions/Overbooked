import { test, expect, type Page } from "@playwright/test";

// Multi-shop: each shop sees only its own data, only Zypher sees the console,
// and an invite link puts a new person in the inviting shop.

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByPlaceholder("manager@overbooked.com").fill(email);
  await page.getByPlaceholder("••••••••").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByText("Rental Management")).toBeVisible({ timeout: 30_000 });
}

const env = (name: string) => process.env[name] ?? "";

test("each shop sees only its own catalog", async ({ page }) => {
  test.skip(!env("TEST_SECOND_OWNER_EMAIL"), "TEST_SECOND_OWNER_* missing in .env.test");
  await signIn(page, env("TEST_SECOND_OWNER_EMAIL"), env("TEST_SECOND_OWNER_PASSWORD"));
  await expect(page.getByRole("heading", { name: "Second Shop" })).toBeVisible();
  await page.getByRole("button", { name: "All Products" }).click();
  await expect(page.getByRole("heading", { name: "Groom Sherwani" })).toBeVisible();
  await expect(page.getByText("Bridal Suit")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Zypher Console" })).toHaveCount(0);
});

test("Zypher sees the console and the shops", async ({ page }) => {
  test.skip(!env("TEST_ADMIN_EMAIL"), "TEST_ADMIN_* missing in .env.test");
  await signIn(page, env("TEST_ADMIN_EMAIL"), env("TEST_ADMIN_PASSWORD"));
  await page.getByRole("button", { name: "Zypher Console" }).click();
  const shops = page.locator("main table");
  await expect(shops.getByText("Demo Rentals")).toBeVisible();
  await expect(shops.getByText("Second Shop")).toBeVisible();
});

test("an invite link puts the new person in the inviting shop", async ({ page, browser }) => {
  test.skip(!env("TEST_OWNER_EMAIL"), "TEST_OWNER_* missing in .env.test");
  const email = `invitee-${Date.now()}@demo.test`;

  await signIn(page, env("TEST_OWNER_EMAIL"), env("TEST_OWNER_PASSWORD"));
  await page.getByRole("button", { name: "Staff Management" }).click();
  await page.getByLabel("Full name").fill("Play Invitee");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Branch", { exact: true }).selectOption({ label: "City Centre" });
  await page.getByRole("button", { name: "Create invite link" }).click();
  const link = await page.locator('textarea[aria-label="Invite link"]').inputValue();
  expect(link).toContain("/welcome?token_hash=");

  // the invitee, in a fresh browser
  const other = await browser.newContext();
  const invitee = await other.newPage();
  await invitee.goto(link);
  await invitee.getByLabel("Password", { exact: true }).fill("Invitee-Local-Test-1");
  await invitee.getByLabel("Confirm password").fill("Invitee-Local-Test-1");
  await invitee.getByRole("button", { name: "Save and continue" }).click();
  await expect(invitee.getByRole("heading", { name: "Demo Rentals" })).toBeVisible({ timeout: 30_000 });
  await expect(invitee.getByText("City Centre").first()).toBeVisible();
  await other.close();
});
