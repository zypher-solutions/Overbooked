import { test, expect } from "@playwright/test";

const roles = ["ADMIN", "OWNER", "MANAGER", "STAFF"] as const;

// After the 2026-10-18 hardening migration: every role can log in and open the main pages
// without any database request being refused.
for (const role of roles) {
  test(`${role}: login and open main pages with no failed database calls`, async ({ page }) => {
    const email = process.env[`TEST_${role}_EMAIL`];
    const password = process.env[`TEST_${role}_PASSWORD`];
    test.skip(!email || !password, `TEST_${role}_* missing in .env.test`);

    const failed: string[] = [];
    page.on("response", (r) => {
      if (r.url().includes("supabase.co") && r.status() >= 400 && !r.url().includes("/auth/")) {
        failed.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
      }
    });

    await page.goto("/login");
    await page.getByPlaceholder("manager@overbooked.com").fill(email!);
    await page.getByPlaceholder("••••••••").fill(password!);
    await page.getByRole("button", { name: /sign in|log in|login/i }).click();
    await expect(page.getByText("Rental Management")).toBeVisible({ timeout: 30_000 });

    for (const name of ["Bookings", "All Rentals", "All Products"]) {
      await page.getByRole("button", { name }).first().click();
      await page.waitForLoadState("networkidle");
    }
    expect(failed, "refused database calls").toEqual([]);
  });
}
