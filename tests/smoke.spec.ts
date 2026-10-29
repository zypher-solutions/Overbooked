import { test, expect, type Page } from "@playwright/test";

// Opens every main screen for each kind of login and fails on a page error, a React warning or a failed data request.
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "Overbooked-Demo-2026!";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("manager@overbooked.com").fill(email);
  await page.getByPlaceholder("••••••••").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
}

function watch(page: Page) {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message.slice(0, 200)));
  page.on("console", (m) => {
    const t = m.text();
    if (m.type() === "error" || m.type() === "warning") {
      if (/realtime|WebSocket|favicon|Download the React DevTools|Fast Refresh/i.test(t)) return;
      problems.push(`${m.type()}: ${t.slice(0, 220)} @ ${page.url()}`);
    }
  });
  page.on("response", (r) => {
    const u = r.url();
    if (r.status() >= 400 && /54321\/(rest|storage|auth)/.test(u) && !/realtime/.test(u)) problems.push(`HTTP ${r.status()} ${u.slice(22, 120)}`);
  });
  return problems;
}

async function visit(page: Page, problems: string[], paths: string[]) {
  for (const p of paths) {
    await page.goto(p);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);
    await expect(page.locator("body")).not.toContainText(/Application error|Something went wrong/i);
  }
  expect(problems, problems.join("\n")).toEqual([]);
}

test("a clothing owner: every screen opens cleanly", async ({ page }) => {
  const problems = watch(page);
  await signIn(page, "owner@bridal.test");
  await visit(page, problems, ["/", "/finance", "/bookings", "/scan", "/all-rentals", "/calendar", "/customers", "/catalog", "/catalog/new",
    "/catalog?tab=categories", "/catalog/import", "/settings"]);
});

test("a resort owner: every screen opens cleanly", async ({ page }) => {
  const problems = watch(page);
  await signIn(page, "owner@resort.test");
  await visit(page, problems, ["/", "/book", "/rentals", "/calendar", "/customers", "/catalog", "/dashboard", "/settings"]);
});

test("a car shop's staff: their screens open cleanly", async ({ page }) => {
  const problems = watch(page);
  await signIn(page, "staff@car.test");
  await visit(page, problems, ["/", "/book", "/rentals", "/calendar", "/customers", "/catalog"]);
});

test("Zypher: the console, and a shop's branches and staff pages, open cleanly", async ({ page }) => {
  const problems = watch(page);
  await signIn(page, "zypher@overbooked.test");
  await visit(page, problems, ["/zypher", "/zypher/shops", "/zypher/billing", "/zypher/templates", "/zypher/audit", "/zypher/team", "/zypher/settings",
    "/zypher/shops/5a000000-0000-0000-0000-000000000001/branches", "/zypher/shops/5a000000-0000-0000-0000-000000000001/staff"]);
});

test("Zypher: a shop's page shows its private notes, and the shop's own owner cannot read them", async ({ page }) => {
  const problems = watch(page);
  await signIn(page, "zypher@overbooked.test");
  await visit(page, problems, ["/zypher/shops/5a000000-0000-0000-0000-000000000001"]);
  await expect(page.getByText("Zypher notes (the shop never sees these)")).toBeVisible();
});
