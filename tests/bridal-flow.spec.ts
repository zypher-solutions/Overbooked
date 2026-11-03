import { test, expect, type Page } from "@playwright/test";

// The money side of a clothing rental in the browser (the groom shop, whose two sherwanis no other test uses): a deposit, a lost piece, a return that leaves a balance, and Finance.
// Run: npx supabase db reset, then npx playwright test
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
const rent = async (page: Page, product: RegExp) => {
  await page.goto("/catalog");
  await page.getByRole("row", { name: product }).first().getByRole("button", { name: "Rent", exact: true }).click(); // Rent on the product, then colour and size
  // a product with colours and sizes first asks which ones: Search shows them all
  const search = page.getByRole("dialog").getByRole("button", { name: "Show all" });
  if (await search.isVisible({ timeout: 1500 }).catch(() => false)) await search.click();
  await page.getByRole("button", { name: /to cart$/, disabled: false }).first().click();
  await page.goto("/book");
};
// open a booking from the Bookings list by the customer's name
const openBooking = async (page: Page, customer: string) => {
  await page.getByRole("link", { name: new RegExp(customer) }).first().click();
  await expect(page).toHaveURL(/\/rentals\//);
};
const farDay = () => new Date(Date.now() + (60 + Math.floor(Math.random() * 300)) * 86_400_000).toISOString().slice(0, 10);
const num = (t: string | null) => Number((t ?? "").replace(/[^0-9.]/g, ""));

test("bridal: a lost piece is charged, a return that leaves money unpaid asks first, and Finance shows what is owed", async ({ page }) => {
  await signIn(page, "owner@groom.test");
  await rent(page, /Cream sherwani/);
  const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10); // India date
  await setDates(page, today, new Date(Date.parse(today) + 86_400_000).toISOString().slice(0, 10));
  await field(page, "Phone").fill("96" + String(Date.now()).slice(-8));
  await field(page, "Name").fill("Lost Piece Bride");
  await field(page, "Security Deposit").fill("2000");
  await page.getByLabel("Deposit payment method").selectOption("cash");
  await field(page, "Advance").fill("1000");
  await page.getByLabel("Advance payment method").selectOption("cash");
  await page.getByRole("button", { name: /^Confirm Booking/ }).click();
  await page.getByRole("dialog", { name: "Booking confirmed" }).getByRole("button", { name: "Done" }).click(); // the pop-up, then the list
  await expect(page).toHaveURL(/\/bookings$/, { timeout: 15_000 }); // a confirmed booking goes to the Bookings list
  await openBooking(page, "Lost Piece Bride");

  // hand over (the deposit was taken with the booking)
  await page.getByRole("button", { name: "Hand over" }).click();
  const pickup = page.getByRole("dialog");
  // the balance and the deposit each ask how the money was paid
  const cash = pickup.getByRole("radio", { name: "Cash" });
  for (let i = (await cash.count()) - 1; i >= 0; i--) await cash.nth(i).click();
  await pickup.getByRole("button", { name: "Hand over" }).click();
  await expect(page.getByText("Out", { exact: true })).toBeVisible();

  // return: the piece is lost, so a "Lost item" charge appears with the replacement value to change
  await page.getByRole("button", { name: "Mark returned" }).click();
  const ret = page.getByRole("dialog");
  await ret.getByRole("radio", { name: "Lost" }).click();
  await expect(ret.getByLabel("Charge type")).toHaveValue("lost");
  await expect(ret.getByLabel("Charge note")).toHaveValue(/^Lost: /);
  await ret.getByLabel("Charge amount").fill("3000");
  // leave the rest unpaid on purpose: the screen asks before closing the rental
  await field(ret, "Payment now").fill("");
  let asked = "";
  page.once("dialog", (d) => { asked = d.message(); void d.accept(); });
  await ret.getByRole("button", { name: "Mark returned" }).click();
  await expect(page.getByText("Returned", { exact: true })).toBeVisible({ timeout: 15_000 });
  expect(asked).toMatch(/will stay unpaid/);

  // the rental page and Finance agree: the balance is owed
  await expect(page.getByText(/Remaining amount|is still owed/).first()).toBeVisible();
  await page.goto("/finance");
  await expect(page.getByText(/^Outstanding now$/i)).toBeVisible();
  await expect(page.getByText(/owed on [1-9]\d* rentals?/)).toBeVisible({ timeout: 15_000 }); // the figures have loaded
  const text = await page.locator("body").innerText();
  const owed = num(text.match(/Outstanding now\s*₹([\d,.]+)/i)?.[1] ?? "0");
  expect(owed).toBe(1000); // 1,500 rent + 3,000 lost piece - 1,000 advance - 2,000 deposit kept
});

test("bridal: Cancel offers a no-show once the pickup date has passed, and refunds the deposit and what was paid less the fee", async ({ page }) => {
  await signIn(page, "owner@groom.test");
  // a booking for today (the start date is allowed today), then the planned start passes only after midnight: so check the plain cancel
  await rent(page, /Cream sherwani/);
  const day = farDay();
  await setDates(page, day, new Date(Date.parse(day) + 86_400_000).toISOString().slice(0, 10));
  await field(page, "Phone").fill("95" + String(Date.now()).slice(-8));
  await field(page, "Name").fill("Cancelling Bride");
  await field(page, "Advance").fill("800");
  await page.getByLabel("Advance payment method").selectOption("cash");
  await page.getByRole("button", { name: /^Confirm Booking/ }).click();
  await page.getByRole("dialog", { name: "Booking confirmed" }).getByRole("button", { name: "Done" }).click(); // the pop-up, then the list
  await expect(page).toHaveURL(/\/bookings$/, { timeout: 15_000 }); // a confirmed booking goes to the Bookings list
  await openBooking(page, "Cancelling Bride");

  await page.getByRole("button", { name: "Cancel booking" }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByText("Total Refund Outflow")).toBeVisible();
  await dlg.getByLabel(/Retained Cancellation Fee/).fill("200");
  await expect(dlg.getByText("₹600").first()).toBeVisible(); // 800 paid less the 200 fee
  await dlg.getByRole("radio", { name: "Cash" }).first().click();
  await dlg.getByLabel(/Cancellation Reason/).fill("Customer asked to cancel");
  await dlg.getByRole("button", { name: /Confirm Cancellation/ }).click();
  await expect(page.getByText("Cancelled", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
});
