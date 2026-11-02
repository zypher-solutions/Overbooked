import { createHmac } from "node:crypto";
import { execSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";

// Two-step sign-in against the local database. The demo data has it switched off, so this test switches it on,
// walks a support login through setting up an authenticator app and signing in again with a code, then puts everything back.
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "Overbooked-Demo-2026!";
const psql = (sql: string) => execSync(`docker exec -i supabase_db_overbooked psql -U postgres -v ON_ERROR_STOP=1 -c "${sql}"`, { stdio: "ignore" });

// RFC 6238 one-time code (30 second steps, 6 digits) from a base32 secret
function totp(secret: string, offset = 0) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String(((h[o] & 0x7f) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1_000_000).padStart(6, "0");
}

async function signInPassword(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("manager@overbooked.com").fill(email);
  await page.getByPlaceholder("••••••••").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
}

test.describe.configure({ mode: "serial" });
test.beforeAll(() => { psql("UPDATE platform_settings SET require_mfa = true"); });
test.afterAll(() => {
  psql("UPDATE platform_settings SET require_mfa = false");
  psql("DELETE FROM auth.mfa_factors WHERE user_id IN (SELECT id FROM auth.users WHERE email IN ('support@bridal.test', 'zypher@overbooked.test'))");
});

test("the show-password eye reveals and hides the password", async ({ page }) => {
  await page.goto("/login");
  const pw = page.getByPlaceholder("••••••••");
  await pw.fill("not-a-real-password");
  await expect(pw).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(pw).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(pw).toHaveAttribute("type", "password");
});

test("a Zypher admin with only a password is sent to two-step sign-in and cannot open the console", async ({ page }) => {
  await signInPassword(page, "zypher@overbooked.test");
  await page.waitForURL((u) => u.pathname === "/mfa", { timeout: 30_000 });
  await page.goto("/zypher");
  await page.waitForURL((u) => u.pathname === "/mfa", { timeout: 30_000 });
});

test("a support login sets up the app, then must enter a code every time", async ({ page, context }) => {
  await signInPassword(page, "support@bridal.test");
  await page.waitForURL((u) => u.pathname === "/mfa", { timeout: 30_000 });
  const secret = (await page.getByLabel("Setup key").innerText()).trim();
  expect(secret.length).toBeGreaterThan(15);

  // a wrong code is refused
  await page.getByLabel("6-digit code").fill("000000");
  await page.getByRole("button", { name: /turn on and continue/i }).click();
  await expect(page.getByText(/did not work/i)).toBeVisible();

  await page.getByLabel("6-digit code").fill(totp(secret));
  await page.getByRole("button", { name: /turn on and continue/i }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel("Main navigation").getByText("Kalyani Bridal")).toBeVisible();

  // a new sign-in asks for the code again (no new QR code this time)
  await context.clearCookies();
  await signInPassword(page, "support@bridal.test");
  await page.waitForURL((u) => u.pathname === "/mfa", { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();
  await expect(page.getByLabel("Setup key")).toHaveCount(0);
  // until the code is entered the shop shows nothing: the database gives the login no shop
  await page.goto("/customers");
  await page.waitForURL((u) => u.pathname === "/mfa", { timeout: 30_000 });
  await page.getByLabel("6-digit code").fill(totp(secret));
  await page.getByRole("button", { name: /continue/i }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 30_000 });
});
