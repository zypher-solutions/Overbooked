import { test, expect } from "@playwright/test";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Full money flow through the database functions, with hand-calculated expected values.
// Creates QA- rows only. Clean up afterwards (scoped to the QA- customer / SKUs).
//
// Hand calculation (1 variation at 1000/day, 2 units, 2 days, qty 2):
//   items            = 2 x 1000 x 2          = 4000
//   discount                                  =  500
//   booking total    = 4000 - 500            = 3500
//   advance 1000, deposit 2000
//   pickup payment   = 3500 - 1000           = 2500   (rental total 3500, advance 3500, paid)
//   return: extra fees 300, taken from deposit 300, refund 2000 - 300 = 1700
//   final rental total = 3500 + 300          = 3800   (advance 3500 + 300 = 3800, paid)
//   ledger: advance_in 1000, deposit_in 2000, payment_in 2500, deposit_retained 300, deposit_refund_out 1700
//   cash in 5500 - refund out 1700 = 3800 = final rental total; deposit held = 2000 - 300 - 1700 = 0

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function login(role: "ADMIN" | "STAFF"): Promise<SupabaseClient> {
  const c = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({
    email: process.env[`TEST_${role}_EMAIL`]!,
    password: process.env[`TEST_${role}_PASSWORD`]!,
  });
  if (error) throw new Error(`${role} login failed: ${error.message}`);
  return c;
}

const ok = <T>(r: { data: T; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
};

function istDate(plusDays: number) {
  const d = new Date(Date.now() + plusDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
}

test("booking -> pickup with payment -> return -> ledger reconciles", async () => {
  test.skip(!url || !key || !process.env.TEST_ADMIN_EMAIL, "env missing");
  const admin = await login("ADMIN");
  const uid = (await admin.auth.getUser()).data.user!.id;

  // ---- setup (QA- data) ----
  const branch = ok(await admin.from("branches").select("id").limit(1).single(), "branch");
  const cat = ok(await admin.from("categories").insert({ name: "QA-Flow Category", base_sku: "QAF" }).select("id").single(), "category");
  const prod = ok(await admin.from("products").insert({ name: "QA-Flow Suit", sku: "QAF-001", category_id: cat.id }).select("id").single(), "product");
  const vari = ok(await admin.from("product_variations").insert({ product_id: prod.id, name: "QA-Flow Black M", sku: "QAF-001-BLK", daily_rate: 1000 }).select("id").single(), "variation");
  const units = ok(await admin.from("inventory_items").insert([
    { product_id: prod.id, variation_id: vari.id, branch_id: branch.id, item_sku: "QAF-001-BLK-01", status: "available" },
    { product_id: prod.id, variation_id: vari.id, branch_id: branch.id, item_sku: "QAF-001-BLK-02", status: "available" },
  ]).select("id, item_sku").order("item_sku"), "units");
  const cust = ok(await admin.from("customers").insert({ full_name: "QA-Flow Customer", phone: "9999900001" }).select("id").single(), "customer");

  // ---- 1. booking ----
  const pickup = istDate(0), ret = istDate(2);
  const bookingId = ok(await admin.rpc("create_booking_atomic", {
    p_token: null, p_customer_id: cust.id, p_branch_id: branch.id, p_booking_date: pickup,
    p_notes: "QA-flow", p_created_by: uid, p_total: 3500, p_advance: 1000, p_security_deposit: 2000, p_discount: 500,
    p_items: [{
      product_id: prod.id, variation_id: vari.id, product_name: "QA-Flow Suit", sku: "QAF-001-BLK", image_url: null,
      qty: 2, daily_rate: 1000, pickup_date: pickup, return_date: ret, buffer_days: 0, subtotal: 4000,
      inventory_item_ids: units.map((u) => u.id),
    }],
  }), "create booking") as string;

  const booking = ok(await admin.from("bookings").select("total, advance, security_deposit, discount, status").eq("id", bookingId).single(), "read booking");
  expect(Number(booking.total)).toBe(3500);
  expect(Number(booking.advance)).toBe(1000);
  expect(Number(booking.discount)).toBe(500);

  // ---- 2. pickup: exact remaining balance (wrong amount must be refused) ----
  const wrong = await admin.rpc("pickup_booking_atomic", { p_booking_id: bookingId, p_expected_return_date: ret, p_pickup_payment: 2400, p_staff_id: uid, p_payment_method: "upi" });
  expect(wrong.error?.message).toMatch(/remaining balance/);
  const rentalId = ok(await admin.rpc("pickup_booking_atomic", { p_booking_id: bookingId, p_expected_return_date: ret, p_pickup_payment: 2500, p_staff_id: uid, p_payment_method: "upi" }), "pickup") as string;

  const rental = ok(await admin.from("rentals").select("booking_id, total, advance, payment_status, status, security_deposit").eq("id", rentalId).single(), "read rental");
  expect(rental.booking_id).toBe(bookingId); // migration 12 link
  expect(Number(rental.total)).toBe(3500);
  expect(Number(rental.advance)).toBe(3500);
  expect(rental.payment_status).toBe("paid");
  expect(rental.status).toBe("out");

  // ---- 3. return: unit 1 good, unit 2 damaged; 300 fees taken from the 2000 deposit ----
  const ritems = ok(await admin.from("rental_items").select("id").eq("rental_id", rentalId), "rental items");
  const ritemId = ritems[0].id;
  const [u1, u2] = units;
  const ret_res = ok(await admin.rpc("mark_returned_atomic", {
    p_rental_id: rentalId, p_returned_on: new Date().toISOString(), p_condition: "damaged", p_notes: "QA-flow return",
    p_extra_fees: 300, p_extra_fees_reason: "QA-damage", p_deposit_deducted: 300, p_deposit_refund_method: "cash",
    p_settlement_payment: 0, p_payment_method: null,
    p_items: [
      { rental_item_id: ritemId, inventory_item_id: u1.id, condition: "good", return_notes: "" },
      { rental_item_id: ritemId, inventory_item_id: u2.id, condition: "damaged", return_notes: "QA" },
    ],
  }), "return") as { total: number; advance: number; payment_status: string; deposit_refunded: number };
  expect(Number(ret_res.total)).toBe(3800);
  expect(Number(ret_res.advance)).toBe(3800);
  expect(ret_res.payment_status).toBe("paid");
  expect(Number(ret_res.deposit_refunded)).toBe(1700);

  const after = ok(await admin.from("inventory_items").select("item_sku, status").in("id", units.map((u) => u.id)).order("item_sku"), "unit status");
  expect(after.map((u) => u.status)).toEqual(["available", "maintenance"]); // damaged -> maintenance

  // ---- 4. ledger and payments reconcile to the hand calculation ----
  const ledger = ok(await admin.from("ledger_entries").select("kind, amount").or(`booking_id.eq.${bookingId},rental_id.eq.${rentalId}`), "ledger");
  const byKind: Record<string, number> = {};
  for (const l of ledger) byKind[l.kind] = (byKind[l.kind] ?? 0) + Number(l.amount);
  expect(byKind).toEqual({ advance_in: 1000, deposit_in: 2000, payment_in: 2500, deposit_retained: 300, deposit_refund_out: 1700 });
  const cashIn = byKind.advance_in + byKind.deposit_in + byKind.payment_in;
  expect(cashIn - byKind.deposit_refund_out).toBe(3800); // = final rental total
  expect(byKind.deposit_in - byKind.deposit_retained - byKind.deposit_refund_out).toBe(0); // deposit held

  const pays = ok(await admin.from("payments").select("amount").eq("rental_id", rentalId), "payments");
  expect(pays.map((p) => Number(p.amount))).toEqual([2500]);

  // ---- 5. staff must not see the finance ledger or payments ----
  const staff = await login("STAFF");
  const sl = await staff.from("ledger_entries").select("id").eq("rental_id", rentalId);
  const sp = await staff.from("payments").select("id").eq("rental_id", rentalId);
  expect(sl.data ?? []).toEqual([]);
  expect(sp.data ?? []).toEqual([]);
});
